"""
IAM Service — Keycloak JWT validation.

Fetches JWKS from the Keycloak realm and validates Bearer tokens.
The JWKS is cached for 10 minutes so every request is sub-ms.

Usage:
    from common.iam_service import verify_iam_token, IamTokenError

    try:
        claims = verify_iam_token(bearer_token)
        # claims['sub']   — Keycloak user UUID
        # claims['name']  — full name
        # claims['email'] — email
        # claims['apps']  — list of app client IDs the user has a role in
        # claims['realm_access']['roles'] — realm-level roles
    except IamTokenError as e:
        return jsonify({'error': str(e)}), 401
"""
import os
import time
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Thread-safe JWKS cache
_jwks_lock = threading.Lock()
_jwks_client = None
_jwks_loaded_at: float = 0.0
_JWKS_TTL = 600  # 10 minutes
_JWKS_FETCH_TIMEOUT = 3  # seconds. PyJWKClient defaults to 30s — if the IAM
# host is briefly unreachable, that 30s lands on every single authenticated
# request's response time (chat messages, ticket actions, ...), since a
# failed fetch isn't cached and so gets retried in full on the very next call.

# Short backoff after a failed fetch: skip re-attempting the network call
# entirely for this long, so an unreachable IAM host degrades to a fast,
# consistent failure instead of a slow one repeated on every request. Still
# retries automatically once the backoff elapses, so recovery is automatic.
_JWKS_FAILURE_BACKOFF = 30  # seconds
_jwks_last_failure: float = 0.0
_jwks_last_error: str = ''


class IamTokenError(Exception):
    pass


def _get_iam_cfg():
    from common.config_manager import get_iam_config
    return get_iam_config()


_JWKS_FALLBACK_FILE = os.path.join(os.path.dirname(__file__), 'jwks_fallback.json')


def _load_jwks_fallback():
    """A last-known-good snapshot of IAM's signing keys, bundled with the
    app. Realm signing keys rotate rarely (a deliberate admin action), so a
    stale-but-valid snapshot is far more useful than an outright auth outage
    when this host can reach IAM through neither the proxy nor directly.
    Refresh the file whenever keys actually rotate; until then it's a safety
    net, not a soft dependency — the network paths are always tried first.
    """
    import json
    with open(_JWKS_FALLBACK_FILE, encoding='utf-8') as f:
        return json.load(f)


def _make_jwks_client(jwks_url: str, proxy: str):
    """Build the PyJWKClient. Each fetch tries, in order: the configured
    proxy (a reverse-tunnel SOCKS endpoint, for hosts that can't reach IAM
    directly) if set, then a direct connection, then the bundled fallback
    snapshot. PyJWKClient.fetch_data() has no proxy support built in at all,
    so this overrides just that one method rather than monkey-patching the
    socket layer process-wide.
    """
    import jwt

    class _ResilientPyJWKClient(jwt.PyJWKClient):
        def fetch_data(self):
            import requests
            errors = []
            if proxy:
                try:
                    resp = requests.get(
                        self.uri, headers=self.headers, timeout=self.timeout,
                        proxies={'https': proxy, 'http': proxy},
                    )
                    resp.raise_for_status()
                    return self._cache_and_return(resp.json())
                except Exception as e:
                    errors.append(f'proxy: {e}')
            try:
                resp = requests.get(self.uri, headers=self.headers, timeout=self.timeout)
                resp.raise_for_status()
                return self._cache_and_return(resp.json())
            except Exception as e:
                errors.append(f'direct: {e}')
            try:
                jwk_set = _load_jwks_fallback()
                logger.warning(f"[IAM] JWKS live fetch failed ({'; '.join(errors)}) — using bundled fallback snapshot")
                return self._cache_and_return(jwk_set)
            except Exception as e:
                errors.append(f'fallback file: {e}')
            raise jwt.exceptions.PyJWKClientConnectionError(
                f'Fail to fetch data from the url, err: "{"; ".join(errors)}"'
            )

        def _cache_and_return(self, jwk_set):
            if self.jwk_set_cache is not None:
                self.jwk_set_cache.put(jwk_set)
            return jwk_set

    return _ResilientPyJWKClient(
        jwks_url, cache_jwk_set=True, lifespan=_JWKS_TTL,
        timeout=_JWKS_FETCH_TIMEOUT,
    )


def _iam_proxies() -> Optional[dict]:
    """SOCKS proxy for every outbound IAM call, when this host can't reach
    IAM directly. Reuses IAM_JWKS_PROXY (same env var _make_jwks_client
    already reads above) — despite the name, it's not JWKS-specific; every
    other IAM call site below routes through it too when set. Returns None
    (no proxy) when unset, so this is a no-op wherever IAM is reachable
    directly (e.g. local dev).
    """
    proxy = os.environ.get('IAM_JWKS_PROXY', '')
    return {'http': proxy, 'https': proxy} if proxy else None


def _get_jwks_client():
    """Return a cached PyJWKClient, refreshing if older than TTL."""
    global _jwks_client, _jwks_loaded_at
    import os

    now = time.time()
    with _jwks_lock:
        if _jwks_client is None or (now - _jwks_loaded_at) > _JWKS_TTL:
            try:
                cfg = _get_iam_cfg()
                jwks_url = f"{cfg['keycloak_url']}/realms/{cfg['realm']}/protocol/openid-connect/certs"
                _jwks_client = _make_jwks_client(jwks_url, os.environ.get('IAM_JWKS_PROXY', ''))
                _jwks_loaded_at = now
                logger.info(f"[IAM] JWKS client initialised — {jwks_url}")
            except Exception as e:
                logger.error(f"[IAM] Failed to initialise JWKS client: {e}")
                raise IamTokenError(f"IAM service unavailable: {e}")
        return _jwks_client


def verify_iam_token(token: str) -> dict:
    """
    Validate a Keycloak Bearer JWT.
    Returns decoded claims dict on success.
    Raises IamTokenError on failure.
    """
    global _jwks_last_failure, _jwks_last_error
    if not token:
        raise IamTokenError("No token provided")

    now = time.time()
    if _jwks_last_failure and (now - _jwks_last_failure) < _JWKS_FAILURE_BACKOFF:
        raise IamTokenError(f"IAM JWKS temporarily unavailable: {_jwks_last_error}")

    import jwt
    client = _get_jwks_client()
    cfg    = _get_iam_cfg()

    try:
        # This is the network-shaped step — an unreachable IAM host times out
        # here (fetching the key set), not in jwt.decode() below. Keep it in
        # its own try so only *this* failure trips the backoff.
        signing_key = client.get_signing_key_from_jwt(token)
    except Exception as e:
        _jwks_last_failure = time.time()
        _jwks_last_error = str(e)
        raise IamTokenError(f"Invalid token: {e}")

    try:
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
            issuer=f"{cfg['keycloak_url']}/realms/{cfg['realm']}",
            # PyJWT defaults to zero tolerance on iat/exp/nbf; a few seconds of
            # clock drift between this host and the IAM server otherwise makes
            # every freshly-minted token look "not yet valid".
            leeway=10,
        )
    except Exception as e:
        # A bad/expired/malformed token is a fact about this one request, not
        # evidence the IAM host is unreachable — must not trip the backoff,
        # or one guest's garbage token would reject every other user's valid
        # one for the next 30s.
        raise IamTokenError(f"Invalid token: {e}")

    _jwks_last_failure = 0.0
    return claims


def extract_iam_user(claims: dict) -> dict:
    """
    Pull the fields our app cares about from raw Keycloak claims.
    Returns a normalised dict safe to store in g.iam_user.
    """
    resource_access = claims.get("resource_access", {})
    cfg = _get_iam_cfg()
    client_roles = resource_access.get(cfg.get("client_id", "project-iq"), {}).get("roles", [])
    apps = claims.get("apps") or [
        cid for cid, v in resource_access.items()
        if isinstance(v, dict) and v.get("roles")
        and cid not in ("account", "account-console", "broker", "security-admin-console")
    ]
    realm_roles = claims.get("realm_access", {}).get("roles", [])

    # Resolve org id/name across the shapes Keycloak/IAM may emit:
    #   1. flat claim:            org_id = "<uuid>"
    #   2. list of objects:       organization = [{"id": "<uuid>", "alias": "..."}]
    #   3. flat object:           organization = {"id": "<uuid>", "alias": "..."}
    #   4. Keycloak keyed-by-alias organization = {"<alias>": {"id": "<uuid>", ...}}
    # (matches itsm-service's resolution so the two services agree on org_id.)
    org_id   = claims.get("org_id", "") or ""
    org_name = ""
    _org_raw = claims.get("organization") or {}
    if isinstance(_org_raw, list):
        org = _org_raw[0] if _org_raw else {}
        org_id   = org_id or org.get("id", "")
        org_name = org.get("alias", "") or org.get("name", "")
    elif isinstance(_org_raw, dict) and _org_raw:
        if "id" in _org_raw:                                   # shape 3
            org_id   = org_id or _org_raw.get("id", "")
            org_name = _org_raw.get("alias", "") or _org_raw.get("name", "")
        else:                                                  # shape 4 (keyed by alias)
            _alias, _val = next(iter(_org_raw.items()))
            org_name = _alias
            if isinstance(_val, dict):
                org_id = org_id or _val.get("id", "")

    # Platform config (set after Phase 0)
    try:
        from common.config_manager import get_platform_config
        _platform_org_id = get_platform_config().get("org_id", "")
    except Exception:
        _platform_org_id = ""

    is_super_admin    = "super_admin" in realm_roles
    is_org_admin      = "org_admin"   in realm_roles
    _client_admin     = "Admin"       in client_roles
    # org_admin and super_admin are treated as full admins (alongside the
    # client "Admin" role).
    is_admin          = _client_admin or is_org_admin or is_super_admin
    is_operator       = "Operator"    in client_roles
    # Member / User / Bot grant chatbot access. These low-privilege access
    # roles may be assigned as a realm role OR on any client (not just
    # project-iq), and casing varies between environments — so match
    # case-insensitively across every role the token carries, rather than
    # requiring an exact-case "Bot" on the project-iq client.
    _access_role_names = {r.lower() for r in realm_roles}
    for _cid, _v in resource_access.items():
        if isinstance(_v, dict):
            _access_role_names.update(r.lower() for r in _v.get("roles", []))
    # User and Bot project-iq roles get full chatbot access.
    is_user           = "user"   in _access_role_names
    is_bot            = "bot"     in _access_role_names

    # is_platform_admin: 99Tech staff — super_admin anywhere, or admin/org_admin
    # within the platform org. (A customer-org admin/org_admin is a tenant admin,
    # NOT a cross-tenant platform admin.)
    is_platform_admin = is_super_admin or (
        (_client_admin or is_org_admin) and org_id == _platform_org_id and bool(_platform_org_id)
    )
    is_client_admin   = is_admin and not is_platform_admin

    # Product-specific operator roles e.g. "AccountWise-Operator" → "accountwise-support"
    product_roles = [
        r.lower().replace("-operator", "-support")
        for r in client_roles
        if r.endswith("-Operator") and r != "Operator"
    ]

    # Channel: platform operators/admins belong to the platform org
    # Their escalations come from client orgs via channel='platform'
    channel = "platform" if (org_id == _platform_org_id and bool(_platform_org_id)) else "internal"

    return {
        "sub":          claims.get("sub", ""),
        "username":     claims.get("preferred_username", ""),
        "email":        claims.get("email", ""),
        "name":         claims.get("name") or f"{claims.get('given_name','')} {claims.get('family_name','')}".strip(),
        "given_name":   claims.get("given_name", ""),
        "family_name":  claims.get("family_name", ""),
        "apps":         apps,
        "realm_roles":  realm_roles,
        "client_roles": client_roles,
        # Role flags
        "is_admin":           is_admin,
        "is_operator":        is_operator,
        "is_user":            is_user,
        "is_bot":             is_bot,
        "is_super_admin":     is_super_admin,
        "is_org_admin":       "org_admin" in realm_roles,
        "is_platform_admin":  is_platform_admin,
        "is_client_admin":    is_client_admin,
        # Org context
        "org_id":             org_id,
        "org_name":           org_name,
        "organization_id":    org_id,    # backward compat
        "organization_alias": org_name,  # backward compat
        # Product scope (empty list = operator handles all products)
        "product_roles":      product_roles,
        # Channel this user belongs to
        "channel":            channel,
        "exp":                claims.get("exp", 0),
    }


def get_iam_user_from_request(request) -> Optional[dict]:
    """
    Extract and validate IAM token from Flask request.
    Returns normalised user dict or None if no Bearer token present.
    Raises IamTokenError if token is present but invalid.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    claims = verify_iam_token(auth[7:])
    return extract_iam_user(claims)


# ── Keycloak Admin REST API ───────────────────────────────────────────────────
# Requires a service account (client_credentials) with manage-users realm role.
# Credentials: backend_client_id / backend_client_secret in app.config [IAM].

_admin_tok: dict = {'token': None, 'exp': 0.0, 'last_fail': 0.0}
_admin_tok_lock  = threading.Lock()

# Once the token endpoint has just failed (e.g. IAM unreachable from this
# network), skip straight to failing instead of blocking every caller for a
# fresh 10s timeout — a burst of calls (one per org on the admin dashboard)
# would otherwise serialize into a many-times-10s page load. Matches the
# JWKS client's own graceful-degradation pattern above.
_ADMIN_TOK_FAIL_BACKOFF_S = 30

# Cached client UUID for project-iq client (looked up once per process)
_client_uuid_cache: dict = {}
_client_uuid_lock = threading.Lock()


def _get_admin_token() -> str:
    """Return a cached service-account access token."""
    import requests as _req
    now = time.time()
    with _admin_tok_lock:
        if _admin_tok['token'] and now < _admin_tok['exp'] - 30:
            return _admin_tok['token']
        if now < _admin_tok['last_fail'] + _ADMIN_TOK_FAIL_BACKOFF_S:
            raise ConnectionError(
                "IAM token endpoint recently failed — skipping retry during backoff window"
            )
        cfg = _get_iam_cfg()
        try:
            resp = _req.post(
                f"{cfg['keycloak_url']}/realms/{cfg['realm']}/protocol/openid-connect/token",
                data={
                    'grant_type':    'client_credentials',
                    'client_id':     cfg['backend_client_id'],
                    'client_secret': cfg['backend_client_secret'],
                },
                timeout=10,
                proxies=_iam_proxies(),
            )
            resp.raise_for_status()
        except Exception:
            _admin_tok['last_fail'] = now
            raise
        tok = resp.json()
        _admin_tok['token'] = tok['access_token']
        _admin_tok['exp']   = now + tok.get('expires_in', 300)
        return _admin_tok['token']


# ── KB bot / service-account token ────────────────────────────────────────────
# Lets background processes (e.g. KBCacheManager's refresh thread, which has
# no logged-in user to forward a JWT from) call itsm-service as a tenant user.
#
# Requires a dedicated Keycloak client (client_credentials grant) whose
# service-account user has IAM role "bot" — itsm-service maps that to the
# tenant role "service_account" (see app/auth/dependencies.py
# _IAM_TO_TENANT_ROLE) and resolves the tenant from the token's org_id claim.
# Configure via KB_BOT_CLIENT_ID / KB_BOT_CLIENT_SECRET (see get_kb_bot_config).

_kb_bot_tok: dict = {'token': None, 'exp': 0.0}
_kb_bot_tok_lock  = threading.Lock()


def get_kb_bot_token() -> Optional[str]:
    """Return a cached itsm-service access token for the KB bot service account.

    Returns None (never raises) when the bot client isn't configured or the
    token request fails — callers should treat that as "itsm-service KB
    sourcing unavailable" and fall back gracefully.
    """
    import requests as _req
    from common.config_manager import get_kb_bot_config

    bot_cfg = get_kb_bot_config()
    if not bot_cfg.get('client_id') or not bot_cfg.get('client_secret'):
        return None

    now = time.time()
    with _kb_bot_tok_lock:
        if _kb_bot_tok['token'] and now < _kb_bot_tok['exp'] - 30:
            return _kb_bot_tok['token']
        try:
            cfg = _get_iam_cfg()
            resp = _req.post(
                f"{cfg['keycloak_url']}/realms/{cfg['realm']}/protocol/openid-connect/token",
                data={
                    'grant_type':    'client_credentials',
                    'client_id':     bot_cfg['client_id'],
                    'client_secret': bot_cfg['client_secret'],
                },
                timeout=10,
                proxies=_iam_proxies(),
            )
            resp.raise_for_status()
            tok = resp.json()
            _kb_bot_tok['token'] = tok['access_token']
            _kb_bot_tok['exp']   = now + tok.get('expires_in', 300)
            return _kb_bot_tok['token']
        except Exception as e:
            logger.warning(f"KB bot token request failed: {e}")
            return None


def get_kb_bot_org_id() -> Optional[str]:
    """The fixed org_id claim baked into the KB bot service-account's own
    Keycloak profile — decoded from a token we just minted ourselves via a
    trusted client_credentials grant, so this reads the claim WITHOUT
    signature verification (there's nothing to gain verifying a token this
    process itself just obtained straight from the token endpoint).

    Exists so extensions/whatsapp/bridge.py can safely decide whether it's
    safe to forward this token for a given WhatsApp-linked user: only when
    their linked org_id matches this one exactly — see
    docs/plans/WHATSAPP_INTEGRATION_PLAN.md's 2026-08-27 note on why
    forwarding this token for an org it does NOT represent would resolve
    the wrong tenant in itsm-service. Returns None if the bot isn't
    configured or the token can't be decoded — callers must treat that as
    "no match", never as a wildcard match."""
    import jwt

    token = get_kb_bot_token()
    if not token:
        return None
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except Exception as e:
        logger.warning(f"KB bot token could not be decoded to read its org_id claim: {e}")
        return None
    return claims.get("org_id")


def _iam_admin(method: str, path: str, json=None, params=None, expected_status=None):
    """Make an authenticated Keycloak Admin REST API call."""
    import requests as _req
    cfg  = _get_iam_cfg()
    url  = f"{cfg['keycloak_url']}/admin/realms/{cfg['realm']}{path}"
    resp = _req.request(
        method, url,
        headers={'Authorization': f'Bearer {_get_admin_token()}'},
        json=json,
        params=params,
        timeout=15,
        proxies=_iam_proxies(),
    )
    if expected_status and resp.status_code not in (expected_status
        if isinstance(expected_status, (list, tuple)) else [expected_status]):
        raise IamTokenError(f"Admin API {method} {path} → {resp.status_code}: {resp.text[:400]}")
    resp.raise_for_status()
    if resp.content:
        return resp.json()
    return None


def _get_client_uuid(client_id: str) -> str:
    """Return the Keycloak internal UUID for a client (cached per process)."""
    with _client_uuid_lock:
        if client_id in _client_uuid_cache:
            return _client_uuid_cache[client_id]
    clients = _iam_admin('GET', '/clients', params={'clientId': client_id}) or []
    if not clients:
        raise IamTokenError(f"Client '{client_id}' not found in Keycloak")
    uuid = clients[0]['id']
    with _client_uuid_lock:
        _client_uuid_cache[client_id] = uuid
    return uuid


def _get_client_roles_map(client_uuid: str) -> dict:
    """Return {role_name: {id, name, ...}} for all roles on a client."""
    roles = _iam_admin('GET', f'/clients/{client_uuid}/roles') or []
    return {r['name']: r for r in roles}


def iam_list_org_users(org_id: str, max_users: int = 200) -> list:
    """
    List all members of a Keycloak organization.
    Falls back to a search-by-attribute if the Organizations API is unavailable.
    """
    try:
        members = _iam_admin('GET', f'/organizations/{org_id}/members',
                             params={'max': max_users}) or []
        return members
    except Exception:
        # Fallback: query users with the organization attribute
        try:
            return _iam_admin('GET', '/users', params={
                'q': f'org:{org_id}', 'max': max_users,
            }) or []
        except Exception as e:
            # Both paths failed — almost always because the IAM service account
            # (backend client) lacks permission to read org members. Surface an
            # actionable message instead of a 500.
            raise IamTokenError(
                "Cannot list organization members. Grant the IAM backend client the "
                "'realm-management: view-users' role in Keycloak (and 'manage-users' "
                "to invite/manage members)."
            ) from e


# ── Org subscribed products (for the chatbot product picker) ──────────────────
# Maps the org's ACTIVE subscriptions (subscription.applicationId == the IAM app
# record id) to app names via the application catalog (cached). Uses the backend
# service account against the 99 IAM custom API (api_url + /v1/...).
_app_name_cache: dict = {'map': None, 'exp': 0.0}


def _app_id_name_map() -> dict:
    """Return {application_id: app_name} for all registered apps (cached 10 min)."""
    import requests as _req
    now = time.time()
    if _app_name_cache['map'] is not None and now < _app_name_cache['exp']:
        return _app_name_cache['map']
    cfg = _get_iam_cfg()
    api = (cfg.get('api_url') or '').rstrip('/')
    r = _req.get(f"{api}/v1/application",
                 headers={'Authorization': f'Bearer {_get_admin_token()}'}, timeout=12,
                 proxies=_iam_proxies())
    r.raise_for_status()
    j = r.json()
    data = j.get('data', j) if isinstance(j, dict) else j
    apps = data.get('list') if isinstance(data, dict) and 'list' in data else data
    m = {a.get('id'): (a.get('name') or a.get('clientId'))
         for a in (apps or []) if isinstance(a, dict) and a.get('id')}
    _app_name_cache['map'] = m
    _app_name_cache['exp'] = now + 600
    return m


def iam_list_org_subscribed_products(org_id: str) -> list:
    """Return the org's ACTIVE subscribed product names (for the product picker).

    Uses the backend service account against the 99 IAM custom API:
      GET /v1/organization/{org}/subscription  -> active subscriptions
      GET /v1/application                       -> applicationId -> name map
    Returns a de-duplicated list of app names (e.g. ['project-iq','stock-wise',...]).
    """
    import requests as _req
    if not org_id:
        return []
    cfg = _get_iam_cfg()
    api = (cfg.get('api_url') or '').rstrip('/')
    try:
        r = _req.get(f"{api}/v1/organization/{org_id}/subscription",
                     headers={'Authorization': f'Bearer {_get_admin_token()}'}, timeout=12,
                     proxies=_iam_proxies())
        r.raise_for_status()
        j = r.json()
        data = j.get('data', j) if isinstance(j, dict) else j
        subs = data.get('list') if isinstance(data, dict) and 'list' in data else data
        names = _app_id_name_map()
        out = []
        for s in (subs or []):
            if not isinstance(s, dict) or str(s.get('status', '')).lower() != 'active':
                continue
            nm = names.get(s.get('applicationId'))
            if nm and nm not in out:
                out.append(nm)
        return out
    except Exception as e:
        logger.warning("[IAM] org subscribed products failed for %s: %r", org_id, e)
        return []


def iam_get_user(sub: str) -> dict:
    """Get a Keycloak user by UUID (sub)."""
    return _iam_admin('GET', f'/users/{sub}') or {}


def iam_get_user_client_roles(sub: str, client_id: str = None) -> list:
    """Return list of client role names the user currently holds."""
    cfg  = _get_iam_cfg()
    cid  = client_id or cfg.get('client_id', 'project-iq')
    uuid = _get_client_uuid(cid)
    roles = _iam_admin('GET', f'/users/{sub}/role-mappings/clients/{uuid}') or []
    return [r['name'] for r in roles]


def iam_set_client_roles(sub: str, desired_roles: list, client_id: str = None) -> None:
    """
    Replace the caller's client roles with `desired_roles`.
    Removes roles not in the desired list; adds roles that are missing.
    """
    cfg       = _get_iam_cfg()
    cid       = client_id or cfg.get('client_id', 'project-iq')
    uuid      = _get_client_uuid(cid)
    role_map  = _get_client_roles_map(uuid)
    current   = set(iam_get_user_client_roles(sub, cid))
    desired   = set(desired_roles)

    to_add    = desired - current
    to_remove = current - desired

    if to_add:
        _iam_admin('POST', f'/users/{sub}/role-mappings/clients/{uuid}',
                   json=[role_map[r] for r in to_add if r in role_map])
    if to_remove:
        _iam_admin('DELETE', f'/users/{sub}/role-mappings/clients/{uuid}',
                   json=[role_map[r] for r in to_remove if r in role_map])


def iam_invite_user(email: str, first_name: str, last_name: str,
                    org_id: str, roles: list = None) -> str:
    """
    Create a Keycloak user, assign to org, set client roles,
    and send a verification + set-password email.
    Returns the new user's Keycloak UUID.
    """
    import requests as _req

    roles = roles or ['User']

    # 1. Create user (enabled, email not yet verified)
    user_payload = {
        'username':      email,
        'email':         email,
        'firstName':     first_name,
        'lastName':      last_name,
        'enabled':       True,
        'emailVerified': False,
    }
    cfg  = _get_iam_cfg()
    url  = f"{cfg['keycloak_url']}/admin/realms/{cfg['realm']}/users"
    resp = _req.post(
        url,
        headers={'Authorization': f'Bearer {_get_admin_token()}'},
        json=user_payload,
        timeout=15,
        proxies=_iam_proxies(),
    )
    if resp.status_code == 409:
        raise IamTokenError(f"User with email {email!r} already exists")
    resp.raise_for_status()

    # Location header → new user UUID
    location = resp.headers.get('Location', '')
    sub = location.rstrip('/').split('/')[-1]
    if not sub:
        raise IamTokenError("Keycloak did not return user location after create")

    try:
        # 2. Add to organisation
        if org_id:
            _iam_admin('PUT', f'/organizations/{org_id}/members/{sub}')
    except Exception as e:
        logger.warning(f"[IAM invite] org enroll failed (non-fatal): {e}")

    try:
        # 3. Assign client roles
        if roles:
            iam_set_client_roles(sub, roles)
    except Exception as e:
        logger.warning(f"[IAM invite] role assignment failed (non-fatal): {e}")

    # 4. Send verify + set-password email
    _iam_admin('PUT', f'/users/{sub}/execute-actions-email',
               json=['VERIFY_EMAIL', 'UPDATE_PASSWORD'],
               params={'client_id': cfg.get('client_id', 'project-iq')})

    return sub


def iam_delete_user(sub: str) -> None:
    """Permanently delete a user from Keycloak."""
    _iam_admin('DELETE', f'/users/{sub}')
