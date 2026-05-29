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
        # Project IQ client roles (resource_access["project-iq"].roles)
        "is_admin":       "Admin"    in client_roles,
        "is_operator":    "Operator" in client_roles,
        "is_member":      "Member"   in client_roles,
        # Realm-level roles
        "is_super_admin": "super_admin" in realm_roles,
        "is_org_admin":   "org_admin"   in realm_roles,
        "organization_id":    org.get("id", ""),
        "organization_alias": org.get("alias", ""),
        "exp":          claims.get("exp", 0),
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
