"""
Common / Platform / IAM — Keycloak claim extraction, role & tenant resolution
(the heart of multi-tenant authorization) and every config-loader contract.

Run:  python -m pytest tests/test_common.py -v
"""
from common import iam_service, config_manager


def _claims(realm=None, clients=None, org_id="", organization=None, sub="u1",
            given_name=None, family_name=None, name=None, apps=None):
    c = {
        "sub": sub,
        "preferred_username": "alice",
        "email": "alice@example.com",
        "realm_access": {"roles": realm or []},
        "resource_access": clients or {},
    }
    if org_id:        c["org_id"] = org_id
    if organization is not None: c["organization"] = organization
    if given_name is not None:   c["given_name"] = given_name
    if family_name is not None:  c["family_name"] = family_name
    if name is not None:         c["name"] = name
    if apps is not None:         c["apps"] = apps
    return c


# ── Role flags ───────────────────────────────────────────────────────────────
def test_super_admin_is_admin_and_platform_admin():
    u = iam_service.extract_iam_user(_claims(realm=["super_admin"]))
    assert u["is_super_admin"] and u["is_admin"] and u["is_platform_admin"]


def test_client_admin_role_is_admin():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["Admin"]}}))
    assert u["is_admin"] is True


def test_user_role_grants_chatbot_access():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["User"]}}))
    assert u["is_user"] is True
    assert u["is_platform_admin"] is False


def test_bot_role_case_insensitive():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["bot"]}}))
    assert u["is_bot"] is True


def test_user_role_from_realm_role():
    u = iam_service.extract_iam_user(_claims(realm=["user"]))
    assert u["is_user"] is True


def test_operator_role_detected():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["Operator"]}}))
    assert u["is_operator"] is True


def test_guest_has_no_role_flags():
    u = iam_service.extract_iam_user(_claims())
    assert not u["is_admin"] and not u["is_operator"] and not u["is_user"] and not u["is_bot"]
    assert not u["is_super_admin"] and not u["is_platform_admin"]


def test_product_operator_role_maps_to_support():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["AccountWise-Operator"]}}))
    assert "accountwise-support" in u["product_roles"]


def test_plain_operator_role_not_a_product_role():
    u = iam_service.extract_iam_user(_claims(clients={"project-iq": {"roles": ["Operator"]}}))
    assert u["product_roles"] == []


# ── Identity fields ──────────────────────────────────────────────────────────
def test_name_falls_back_to_given_family():
    u = iam_service.extract_iam_user(_claims(given_name="Alice", family_name="Doe"))
    assert u["name"] == "Alice Doe"


def test_explicit_name_preferred():
    u = iam_service.extract_iam_user(_claims(name="Alice D", given_name="Alice", family_name="Doe"))
    assert u["name"] == "Alice D"


def test_username_and_email_mapped():
    u = iam_service.extract_iam_user(_claims())
    assert u["username"] == "alice"
    assert u["email"] == "alice@example.com"


# ── Apps derivation ──────────────────────────────────────────────────────────
def test_apps_from_explicit_claim():
    u = iam_service.extract_iam_user(_claims(apps=["greenloop", "stockwise"]))
    assert u["apps"] == ["greenloop", "stockwise"]


def test_apps_derived_from_resource_access_excluding_system_clients():
    u = iam_service.extract_iam_user(_claims(clients={
        "greenloop": {"roles": ["User"]},
        "account": {"roles": ["view-profile"]},  # system client — excluded
    }))
    assert "greenloop" in u["apps"]
    assert "account" not in u["apps"]


# ── Org resolution across Keycloak claim shapes ──────────────────────────────
def test_org_from_flat_claim():
    u = iam_service.extract_iam_user(_claims(org_id="O-flat"))
    assert u["org_id"] == "O-flat"


def test_org_from_list_shape():
    u = iam_service.extract_iam_user(_claims(organization=[{"id": "O1", "alias": "Blue"}]))
    assert u["org_id"] == "O1"
    assert u["org_name"] == "Blue"


def test_org_from_flat_object_shape():
    u = iam_service.extract_iam_user(_claims(organization={"id": "O2", "alias": "Green"}))
    assert u["org_id"] == "O2"


def test_org_from_keyed_by_alias_shape():
    u = iam_service.extract_iam_user(_claims(organization={"Acme": {"id": "O3"}}))
    assert u["org_id"] == "O3"
    assert u["org_name"] == "Acme"


# ── Tenant-vs-platform admin distinction (multi-tenancy isolation) ───────────
def test_customer_org_admin_is_tenant_admin_not_platform_admin(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLATFORM-ORG"})
    u = iam_service.extract_iam_user(_claims(realm=["org_admin"], org_id="CUSTOMER-ORG"))
    assert u["is_org_admin"] is True
    assert u["is_platform_admin"] is False
    assert u["is_client_admin"] is True


def test_platform_org_admin_is_platform_admin(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLATFORM-ORG"})
    u = iam_service.extract_iam_user(_claims(realm=["org_admin"], org_id="PLATFORM-ORG"))
    assert u["is_platform_admin"] is True
    assert u["is_client_admin"] is False


def test_channel_platform_for_platform_org(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLATFORM-ORG"})
    u = iam_service.extract_iam_user(_claims(org_id="PLATFORM-ORG"))
    assert u["channel"] == "platform"


def test_channel_internal_for_customer_org(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLATFORM-ORG"})
    u = iam_service.extract_iam_user(_claims(org_id="CUSTOMER-ORG"))
    assert u["channel"] == "internal"


# ── Config loaders — contract (keys & types via local fallbacks) ─────────────
def test_get_all_config_returns_dict():
    assert isinstance(config_manager.get_all_config(), dict)


def test_get_db_config_shape():
    cfg = config_manager.get_db_config()
    assert {"host", "port", "database", "user", "password"} <= set(cfg)
    assert isinstance(cfg["port"], int)


def test_get_rasa_config_shape():
    cfg = config_manager.get_rasa_config()
    assert "api_url" in cfg and "action_url" in cfg


def test_get_kb_config_types():
    cfg = config_manager.get_kb_config()
    assert isinstance(cfg["enabled"], bool)
    assert isinstance(cfg["max_results"], int)
    assert isinstance(cfg["semantic_weight"], float)


def test_get_widget_config_shape():
    cfg = config_manager.get_widget_config()
    assert "title" in cfg and "subtitle" in cfg


def test_get_platform_config_is_dict():
    assert isinstance(config_manager.get_platform_config(), dict)


def test_get_itsm_config_has_service_url():
    assert "service_url" in config_manager.get_itsm_config()


def test_get_handoff_config_has_jwt_secret():
    assert "operator_jwt_secret" in config_manager.get_handoff_config()


def test_get_profile_returns_string():
    assert isinstance(config_manager.get_profile(), str)
