"""Tests for extensions/whatsapp/routes.py's account-link endpoints
(/portal/whatsapp/link/*). Bare Flask app + the whatsapp blueprint, IAM
verification mocked at get_iam_user_from_request (what require_iam_token
actually calls) rather than touching real Keycloak — mirrors the DB-mocking
approach in tests/test_whatsapp_links_db.py. No live account, no DB.
"""
from unittest.mock import patch

import pytest
from flask import Flask

_FAKE_USER = {
    "sub": "sub-1", "email": "saqib@example.com", "name": "Saqib",
    "org_id": "org-1", "is_platform_admin": False,
}


@pytest.fixture
def client():
    from extensions.whatsapp import routes as whatsapp_routes

    whatsapp_routes._link_initiate_limiter._d.clear()
    app = Flask(__name__)
    app.register_blueprint(whatsapp_routes.bp)
    with app.test_client() as c:
        yield c
    whatsapp_routes._link_initiate_limiter._d.clear()


def _auth():
    return {"Authorization": "Bearer fake-jwt"}


# ------------------------------------------------------------------
# initiate
# ------------------------------------------------------------------

def test_initiate_requires_auth(client):
    resp = client.post("/portal/whatsapp/link/initiate", json={"wa_id": "923214421327"})
    assert resp.status_code == 401


def test_initiate_rejects_bad_wa_id(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER):
        resp = client.post("/portal/whatsapp/link/initiate", json={"wa_id": "abc"}, headers=_auth())
    assert resp.status_code == 400


def test_initiate_sends_code_and_returns_success(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.initiate_link", return_value=True) as mock_initiate, \
         patch("extensions.whatsapp.service.whatsapp_service.send_text", return_value=True) as mock_send:
        resp = client.post(
            "/portal/whatsapp/link/initiate", json={"wa_id": "+92 321-4421327"}, headers=_auth(),
        )
    assert resp.status_code == 200
    assert resp.get_json() == {"sent": True}
    # wa_id normalized to plain digits before hitting the DB helper / send
    mock_initiate.assert_called_once()
    assert mock_initiate.call_args[0][2] == "923214421327"
    mock_send.assert_called_once()
    assert mock_send.call_args[0][0] == "923214421327"


def test_initiate_conflict_when_number_belongs_to_someone_else(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.initiate_link", return_value=False):
        resp = client.post(
            "/portal/whatsapp/link/initiate", json={"wa_id": "923214421327"}, headers=_auth(),
        )
    assert resp.status_code == 409


def test_initiate_502_when_send_fails(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.initiate_link", return_value=True), \
         patch("extensions.whatsapp.service.whatsapp_service.send_text", return_value=False):
        resp = client.post(
            "/portal/whatsapp/link/initiate", json={"wa_id": "923214421327"}, headers=_auth(),
        )
    assert resp.status_code == 502


def test_initiate_rate_limited_on_sixth_attempt(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.initiate_link", return_value=True), \
         patch("extensions.whatsapp.service.whatsapp_service.send_text", return_value=True):
        for _ in range(5):
            resp = client.post(
                "/portal/whatsapp/link/initiate", json={"wa_id": "923214421327"}, headers=_auth(),
            )
            assert resp.status_code == 200
        sixth = client.post(
            "/portal/whatsapp/link/initiate", json={"wa_id": "923214421327"}, headers=_auth(),
        )
    assert sixth.status_code == 429


# ------------------------------------------------------------------
# confirm
# ------------------------------------------------------------------

def test_confirm_requires_auth(client):
    resp = client.post("/portal/whatsapp/link/confirm", json={"wa_id": "923214421327", "code": "123456"})
    assert resp.status_code == 401


def test_confirm_success(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.confirm_link", return_value=True):
        resp = client.post(
            "/portal/whatsapp/link/confirm", json={"wa_id": "923214421327", "code": "123456"}, headers=_auth(),
        )
    assert resp.status_code == 200
    assert resp.get_json() == {"confirmed": True}


def test_confirm_bad_code(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.confirm_link", return_value=False):
        resp = client.post(
            "/portal/whatsapp/link/confirm", json={"wa_id": "923214421327", "code": "000000"}, headers=_auth(),
        )
    assert resp.status_code == 400


# ------------------------------------------------------------------
# status / remove
# ------------------------------------------------------------------

def test_status_returns_current_link(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.get_link_status_for_user",
               return_value={"wa_id": "923214421327", "status": "confirmed"}):
        resp = client.get("/portal/whatsapp/link/status", headers=_auth())
    assert resp.status_code == 200
    assert resp.get_json()["link"]["status"] == "confirmed"


def test_remove_link(client):
    with patch("common.iam_service.get_iam_user_from_request", return_value=_FAKE_USER), \
         patch("extensions.whatsapp.routes.unlink", return_value=True) as mock_unlink:
        resp = client.delete("/portal/whatsapp/link", headers=_auth())
    assert resp.status_code == 200
    assert resp.get_json() == {"success": True}
    mock_unlink.assert_called_once_with("sub-1")
