"""Tests for common/db/_whatsapp_links.py — mocked DB connection, no live
Postgres needed (mirrors tests/test_amazon_notifications.py's _log_event
pattern: patch common.db._whatsapp_links._get_connection/_release_connection).
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from common.db._whatsapp_links import confirm_link, get_confirmed_link, initiate_link


def _mock_conn(fetchone_return=None):
    conn = MagicMock()
    cursor = conn.cursor.return_value
    cursor.fetchone.return_value = fetchone_return
    return conn, cursor


def test_initiate_link_new_number_succeeds():
    conn, cursor = _mock_conn(fetchone_return=None)
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = initiate_link("org-1", "sub-1", "923214421327", "123456")
    assert ok is True
    conn.commit.assert_called_once()


def test_initiate_link_refuses_number_confirmed_to_different_account():
    conn, cursor = _mock_conn(fetchone_return={"iam_sub": "sub-OTHER", "status": "confirmed"})
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = initiate_link("org-1", "sub-1", "923214421327", "123456")
    assert ok is False
    conn.commit.assert_not_called()


def test_initiate_link_allows_relinking_own_confirmed_number():
    conn, cursor = _mock_conn(fetchone_return={"iam_sub": "sub-1", "status": "confirmed"})
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = initiate_link("org-1", "sub-1", "923214421327", "654321")
    assert ok is True


def test_confirm_link_correct_code_succeeds():
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    conn, cursor = _mock_conn(fetchone_return={
        "iam_sub": "sub-1", "verification_code": "123456", "code_expires_at": future,
    })
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = confirm_link("sub-1", "923214421327", "123456")
    assert ok is True
    conn.commit.assert_called_once()


def test_confirm_link_wrong_code_fails():
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    conn, cursor = _mock_conn(fetchone_return={
        "iam_sub": "sub-1", "verification_code": "123456", "code_expires_at": future,
    })
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = confirm_link("sub-1", "923214421327", "000000")
    assert ok is False


def test_confirm_link_expired_code_fails():
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    conn, cursor = _mock_conn(fetchone_return={
        "iam_sub": "sub-1", "verification_code": "123456", "code_expires_at": past,
    })
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = confirm_link("sub-1", "923214421327", "123456")
    assert ok is False


def test_confirm_link_wrong_owner_fails():
    future = datetime.now(timezone.utc) + timedelta(minutes=5)
    conn, cursor = _mock_conn(fetchone_return={
        "iam_sub": "sub-OTHER", "verification_code": "123456", "code_expires_at": future,
    })
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = confirm_link("sub-1", "923214421327", "123456")
    assert ok is False


def test_confirm_link_no_pending_row_fails():
    conn, cursor = _mock_conn(fetchone_return=None)
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        ok = confirm_link("sub-1", "923214421327", "123456")
    assert ok is False


def test_get_confirmed_link_returns_row():
    row = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    conn, cursor = _mock_conn(fetchone_return=row)
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        result = get_confirmed_link("923214421327")
    assert result["iam_sub"] == "sub-1"


def test_get_confirmed_link_none_when_not_found():
    conn, cursor = _mock_conn(fetchone_return=None)
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        result = get_confirmed_link("923214421327")
    assert result is None


def test_get_confirmed_link_swallows_db_errors():
    """Bridge.py must never crash a whole message over a DB hiccup here."""
    conn = MagicMock()
    conn.cursor.side_effect = Exception("db down")
    with patch("common.db._whatsapp_links._get_connection", return_value=conn), \
         patch("common.db._whatsapp_links._release_connection"):
        result = get_confirmed_link("923214421327")
    assert result is None
