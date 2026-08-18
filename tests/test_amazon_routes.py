"""
Tests for extensions/amazon/routes.py's amazon_callback() OAuth state-TTL
check (docs/AMAZON_INTEGRATION_PLAN.md buildable-slice §B) — the state token
was previously checked for existence/single-use but never age, so an old,
leaked-but-unconsumed state stayed valid indefinitely.

Uses a minimal Flask app with just the amazon blueprint registered, following
tests/test_rate_limiting.py's pattern (no live DB/Rasa/Keycloak needed).
"""
import time

import pytest
from flask import Flask


@pytest.fixture
def client():
    from extensions.amazon import routes as amazon_routes

    amazon_routes._oauth_state_store.clear()
    app = Flask(__name__)
    app.register_blueprint(amazon_routes.bp)
    with app.test_client() as c:
        yield c
    amazon_routes._oauth_state_store.clear()


def test_unknown_state_redirects_invalid_state(client):
    resp = client.get("/admin/amazon/callback?state=does-not-exist&spapi_oauth_code=x")
    assert resp.status_code == 302
    assert "amazon_error=invalid_state" in resp.headers["Location"]


def test_expired_state_redirects_invalid_state(client):
    from extensions.amazon import routes as amazon_routes

    amazon_routes._oauth_state_store["stale-state"] = {
        "org_id": "org-1",
        "created_at": time.time() - (amazon_routes._OAUTH_STATE_TTL_SECONDS + 1),
    }

    resp = client.get("/admin/amazon/callback?state=stale-state&spapi_oauth_code=x")

    assert resp.status_code == 302
    assert "amazon_error=invalid_state" in resp.headers["Location"]
    # Expired state must still be consumed (popped), not left for a retry.
    assert "stale-state" not in amazon_routes._oauth_state_store


def test_fresh_state_missing_code_redirects_missing_code(client):
    from extensions.amazon import routes as amazon_routes

    amazon_routes._oauth_state_store["fresh-state"] = {
        "org_id": "org-1", "created_at": time.time(),
    }

    resp = client.get("/admin/amazon/callback?state=fresh-state")

    assert resp.status_code == 302
    assert "amazon_error=missing_code" in resp.headers["Location"]
