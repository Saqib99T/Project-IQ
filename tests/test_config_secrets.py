"""Secrets are read from PIQ_<SECTION>_<OPTION> env vars (overriding app.config).

Locks in the security change that moved secrets out of the tracked config files
and into the environment (common/config_manager._env_secret).
"""
from common import config_manager


def test_env_secret_prefers_env_over_file(monkeypatch):
    monkeypatch.setenv("PIQ_FOO_BAR", "from-env")
    assert config_manager._env_secret("foo", "bar", "from-file") == "from-env"


def test_env_secret_falls_back_to_file_when_unset(monkeypatch):
    monkeypatch.delenv("PIQ_FOO_BAR", raising=False)
    assert config_manager._env_secret("foo", "bar", "from-file") == "from-file"


def test_env_secret_empty_env_uses_file(monkeypatch):
    # An empty env var must not blank out the secret — fall back to the file.
    monkeypatch.setenv("PIQ_FOO_BAR", "")
    assert config_manager._env_secret("foo", "bar", "from-file") == "from-file"


def test_section_and_option_uppercased(monkeypatch):
    monkeypatch.setenv("PIQ_HANDOFF_OPERATOR_JWT_SECRET", "rotated-secret")
    # lower-case section/option in the call still resolves the upper-case env var
    assert config_manager._env_secret("HANDOFF", "operator_jwt_secret", "x") == "rotated-secret"


def test_override_flows_through_handoff_getter(monkeypatch):
    monkeypatch.setenv("PIQ_HANDOFF_OPERATOR_JWT_SECRET", "sentinel-jwt")
    assert config_manager.get_handoff_config()["operator_jwt_secret"] == "sentinel-jwt"


def test_override_flows_through_iam_getter(monkeypatch):
    monkeypatch.setenv("PIQ_IAM_BACKEND_CLIENT_SECRET", "sentinel-iam")
    assert config_manager.get_iam_config()["backend_client_secret"] == "sentinel-iam"


def test_override_flows_through_db_getter(monkeypatch):
    monkeypatch.setenv("PIQ_DATABASE_DB_PASSWORD", "sentinel-db")
    assert config_manager.get_db_config()["password"] == "sentinel-db"
