"""
IAM Management API client.

Uses client-credentials (service account) to make server-side calls to
https://api.dev.iam.99technologies.com on behalf of the backend.

All calls that act on a specific user's behalf (entitlement snapshot/check)
pass the user's own Bearer token instead of the service account token.
"""
import logging
import threading
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_SERVICE_TOKEN_LOCK = threading.Lock()
_service_token: Optional[str] = None
_service_token_exp: float = 0.0


def _get_cfg():
    from common.config_manager import get_iam_config
    return get_iam_config()


# ── Service-account token ─────────────────────────────────────────────────────

def _get_service_token() -> str:
    """Return a valid client-credentials access token, refreshing when needed."""
    global _service_token, _service_token_exp
    with _SERVICE_TOKEN_LOCK:
        if _service_token and time.time() < _service_token_exp - 30:
            return _service_token

        cfg = _get_cfg()
        token_url = (
            f"{cfg['keycloak_url']}/realms/{cfg['realm']}"
            f"/protocol/openid-connect/token"
        )
        resp = requests.post(
            token_url,
            data={
                "grant_type":    "client_credentials",
                "client_id":     cfg["backend_client_id"],
                "client_secret": cfg["backend_client_secret"],
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        _service_token     = data["access_token"]
        _service_token_exp = time.time() + data.get("expires_in", 300)
        return _service_token


def _svc_headers() -> dict:
    return {"Authorization": f"Bearer {_get_service_token()}",
            "Content-Type": "application/json"}


def _user_headers(user_token: str) -> dict:
    return {"Authorization": f"Bearer {user_token}",
            "Content-Type": "application/json"}


def _api_url() -> str:
    return _get_cfg()["api_url"].rstrip("/")


# ── Organizations ─────────────────────────────────────────────────────────────

def list_organizations(page: int = 1, page_size: int = 100) -> list:
    """List all organizations (platform admin only)."""
    try:
        resp = requests.get(
            f"{_api_url()}/v1/organization",
            headers=_svc_headers(),
            params={"page": page, "page_size": page_size},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", []) if isinstance(data.get("data"), list) else []
    except Exception as e:
        logger.error(f"[IAM API] list_organizations error: {e}")
        return []


def get_organization(org_id: str) -> Optional[dict]:
    """Get a single organization by ID."""
    try:
        resp = requests.get(
            f"{_api_url()}/v1/organization/{org_id}",
            headers=_svc_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("data")
    except Exception as e:
        logger.error(f"[IAM API] get_organization({org_id}) error: {e}")
        return None


# ── Users ─────────────────────────────────────────────────────────────────────

def list_org_users(org_id: str, page: int = 1, page_size: int = 100) -> list:
    """List all users belonging to an organization."""
    try:
        resp = requests.get(
            f"{_api_url()}/v1/user",
            headers=_svc_headers(),
            params={"organizationId": org_id, "page": page, "page_size": page_size},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", []) if isinstance(data.get("data"), list) else []
    except Exception as e:
        logger.error(f"[IAM API] list_org_users({org_id}) error: {e}")
        return []


def invite_user(
    org_id: str,
    email: str,
    first_name: str = "",
    last_name: str = "",
    role_ids: Optional[list] = None,
    facility_ids: Optional[list] = None,
) -> Optional[dict]:
    """Invite a user to an organization via IAM email invitation."""
    try:
        payload = {
            "organizationId": org_id,
            "email":          email,
            "firstName":      first_name,
            "lastName":       last_name,
        }
        if role_ids:
            payload["roleIds"] = role_ids
        if facility_ids:
            payload["facilityIds"] = facility_ids

        resp = requests.post(
            f"{_api_url()}/v1/invitation",
            headers=_svc_headers(),
            json=payload,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("data")
    except Exception as e:
        logger.error(f"[IAM API] invite_user({email}) error: {e}")
        return None


def update_user(user_id: str, **fields) -> Optional[dict]:
    """Partial update of a user (firstName, lastName, roles, etc.)."""
    try:
        resp = requests.patch(
            f"{_api_url()}/v1/user",
            headers=_svc_headers(),
            json={"id": user_id, **fields},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("data")
    except Exception as e:
        logger.error(f"[IAM API] update_user({user_id}) error: {e}")
        return None


# ── Entitlements ──────────────────────────────────────────────────────────────

def get_entitlement_snapshot(user_token: str, app_client_id: str = "project-iq") -> list:
    """
    Return the list of feature keys the caller's org is entitled to.
    Called with the USER's token (not service account).
    """
    try:
        resp = requests.get(
            f"{_api_url()}/v1/entitlement/snapshot",
            headers=_user_headers(user_token),
            params={"appClientId": app_client_id},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        # Expected: { features: ["accountwise-support", ...] }
        return data.get("features", []) if isinstance(data, dict) else []
    except Exception as e:
        logger.warning(f"[IAM API] get_entitlement_snapshot error: {e}")
        return []


def check_entitlement(user_token: str, feature: str, app_client_id: str = "project-iq") -> bool:
    """
    Check if the caller's org can use a specific feature.
    Called with the USER's token (not service account).
    Returns True if allowed, False otherwise (fail-open on error).
    """
    try:
        resp = requests.post(
            f"{_api_url()}/v1/entitlement/check",
            headers=_user_headers(user_token),
            json={"appClientId": app_client_id, "feature": feature, "qty": 1},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
        return bool(data.get("allowed", False))
    except Exception as e:
        logger.warning(f"[IAM API] check_entitlement({feature}) error: {e}")
        return True  # fail-open — don't block users on IAM outage


# ── Subscriptions ─────────────────────────────────────────────────────────────

def set_subscription(org_id: str, plan_key: str, app_id: str = "project-iq") -> bool:
    """Set or replace an org's subscription plan on project-iq."""
    try:
        resp = requests.put(
            f"{_api_url()}/v1/organization/{org_id}/subscription/{app_id}",
            headers=_svc_headers(),
            json={"planKey": plan_key},
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"[IAM API] set_subscription({org_id}, {plan_key}) error: {e}")
        return False


def list_subscriptions(org_id: str) -> list:
    """List subscriptions for an organization."""
    try:
        resp = requests.get(
            f"{_api_url()}/v1/organization/{org_id}/subscription",
            headers=_svc_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", []) if isinstance(data.get("data"), list) else []
    except Exception as e:
        logger.error(f"[IAM API] list_subscriptions({org_id}) error: {e}")
        return []
