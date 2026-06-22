"""Rate limiting: key func, exemptions, and that limits actually return 429.

Uses a throwaway Flask app + in-memory storage so it's fast and isolated.
"""
import pytest
from flask import Flask, jsonify

from web.api import rate_limiting


@pytest.fixture
def app():
    app = Flask(__name__)

    @app.route("/api/status")
    def status():
        return jsonify(ok=True)

    @app.route("/limited")
    def limited():
        return jsonify(ok=True)

    @app.errorhandler(429)
    def _429(e):
        return jsonify(error="rate_limited"), 429

    # 3 requests/minute so the test can trip it quickly (in-memory store).
    rate_limiting.make_limiter(app, "3 per minute")
    return app


def test_under_limit_ok(app):
    c = app.test_client()
    for _ in range(3):
        assert c.get("/limited").status_code == 200


def test_over_limit_returns_429(app):
    c = app.test_client()
    for _ in range(3):
        c.get("/limited")
    r = c.get("/limited")
    assert r.status_code == 429
    assert r.get_json()["error"] == "rate_limited"


def test_health_status_is_exempt(app):
    c = app.test_client()
    # Far beyond the 3/min limit — exempt path must never be limited.
    codes = {c.get("/api/status").status_code for _ in range(10)}
    assert codes == {200}


def test_options_preflight_is_exempt(app):
    c = app.test_client()
    for _ in range(10):
        # OPTIONS preflight must not be counted/limited (would break CORS).
        assert c.options("/limited").status_code != 429


def test_client_ip_prefers_x_forwarded_for(app):
    with app.test_request_context("/", headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.1"}):
        assert rate_limiting.client_ip() == "203.0.113.7"


def test_client_ip_falls_back_to_remote_addr(app):
    with app.test_request_context("/", environ_overrides={"REMOTE_ADDR": "198.51.100.9"}):
        assert rate_limiting.client_ip() == "198.51.100.9"


def test_per_ip_isolation(app):
    """Different client IPs get independent budgets."""
    c = app.test_client()
    h1 = {"X-Forwarded-For": "1.1.1.1"}
    h2 = {"X-Forwarded-For": "2.2.2.2"}
    for _ in range(3):
        c.get("/limited", headers=h1)
    assert c.get("/limited", headers=h1).status_code == 429   # IP1 exhausted
    assert c.get("/limited", headers=h2).status_code == 200   # IP2 unaffected
