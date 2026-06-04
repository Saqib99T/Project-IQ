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


class IamTokenError(Exception):
    pass


def _get_iam_cfg():
    from common.config_manager import get_iam_config
    return get_iam_config()


def _get_jwks_client():
    """Return a cached PyJWKClient, refreshing if older than TTL."""
    global _jwks_client, _jwks_loaded_at

    now = time.time()
    with _jwks_lock:
        if _jwks_client is None or (now - _jwks_loaded_at) > _JWKS_TTL:
            try:
                import jwt
                cfg = _get_iam_cfg()
                jwks_url = f"{cfg['keycloak_url']}/realms/{cfg['realm']}/protocol/openid-connect/certs"
                _jwks_client = jwt.PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=_JWKS_TTL)
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
    if not token:
        raise IamTokenError("No token provided")
    try:
        import jwt
        client = _get_jwks_client()
        cfg    = _get_iam_cfg()
        signing_key = client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False},
            issuer=f"{cfg['keycloak_url']}/realms/{cfg['realm']}",
        )
        return claims
    except IamTokenError:
        raise
    except Exception as e:
        raise IamTokenError(f"Invalid token: {e}")


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
    _org_raw = claims.get("organization") or {}
    # Keycloak may return organization as a list [{...}] or a dict {...}
    org = _org_raw[0] if isinstance(_org_raw, list) else _org_raw
    realm_roles = claims.get("realm_access", {}).get("roles", [])

    org_id   = org.get("id", "")
    org_name = org.get("alias", "") or org.get("name", "")

    # Platform config (set after Phase 0)
    try:
        from common.config_manager import get_platform_config
        _platform_org_id = get_platform_config().get("org_id", "")
    except Exception:
        _platform_org_id = ""

    is_super_admin    = "super_admin" in realm_roles
    is_admin          = "Admin"       in client_roles
    is_operator       = "Operator"    in client_roles
    is_member         = "Member"      in client_roles

    # is_platform_admin: 99Tech staff with super_admin OR Admin in the platform org
    is_platform_admin = is_super_admin or (is_admin and org_id == _platform_org_id and bool(_platform_org_id))
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
        "is_member":          is_member,
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

_admin_tok: dict = {'token': None, 'exp': 0.0}
_admin_tok_lock  = threading.Lock()

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
        cfg = _get_iam_cfg()
        resp = _req.post(
            f"{cfg['keycloak_url']}/realms/{cfg['realm']}/protocol/openid-connect/token",
            data={
                'grant_type':    'client_credentials',
                'client_id':     cfg['backend_client_id'],
                'client_secret': cfg['backend_client_secret'],
            },
            timeout=10,
        )
        resp.raise_for_status()
        tok = resp.json()
        _admin_tok['token'] = tok['access_token']
        _admin_tok['exp']   = now + tok.get('expires_in', 300)
        return _admin_tok['token']


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
    except IamTokenError:
        # Fallback: query users with organization attribute
        return _iam_admin('GET', '/users', params={
            'q': f'org:{org_id}', 'max': max_users,
        }) or []


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

    roles = roles or ['Member']

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
