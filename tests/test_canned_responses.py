"""Canned-responses input validation (pure; no DB)."""
import pytest
from common.db import _canned


def test_valid_input_normalized():
    out = _canned.clean_canned_input(
        {"title": "  Greeting ", "body": " Hello! ", "shortcut": "/hi", "app_id": "it"})
    assert out == {"title": "Greeting", "body": "Hello!", "shortcut": "hi", "app_id": "it"}


def test_title_and_body_required():
    for bad in ({"title": "", "body": "x"}, {"title": "x", "body": ""}, {}):
        with pytest.raises(ValueError):
            _canned.clean_canned_input(bad)


def test_title_too_long_rejected():
    with pytest.raises(ValueError):
        _canned.clean_canned_input({"title": "x" * 200, "body": "ok"})


def test_body_too_long_rejected():
    with pytest.raises(ValueError):
        _canned.clean_canned_input({"title": "ok", "body": "y" * 5000})


def test_optional_fields_default_to_none():
    out = _canned.clean_canned_input({"title": "t", "body": "b"})
    assert out["shortcut"] is None and out["app_id"] is None


def test_scope_clause_blocks_cross_tenant():
    # write scope must require org match (or both NULL) — guards tenant isolation
    assert "org_id = %s" in _canned._SCOPE and "IS NULL AND %s IS NULL" in _canned._SCOPE
