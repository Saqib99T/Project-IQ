"""Language detection (common.lang_detect) + bot response catalog
(action_server.actions._i18n) for the multilingual (1b) work."""
import pytest

from common.lang_detect import detect_lang, DEFAULT_LANG, SUPPORTED


# ── Detection ────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,expected", [
    ("I need help with my password", "en"),
    ("Ich brauche Hilfe mit meinem Passwort", "de"),
    ("Wie kann ich mein Konto zurücksetzen?", "de"),
    ("Bonjour, j'ai besoin d'aide", "fr"),
    ("Comment puis-je réinitialiser mon mot de passe", "fr"),
    ("Hola, necesito ayuda por favor", "es"),
    ("¿Cómo puedo restablecer mi contraseña?", "es"),
    ("مرحبا أحتاج مساعدة", "ar"),
    ("merci", "fr"),
    ("gracias", "es"),
    ("danke", "de"),
])
def test_detect_lang(text, expected):
    assert detect_lang(text) == expected


@pytest.mark.parametrize("text", ["", "   ", "12345", "!!!", None])
def test_detect_lang_defaults_to_en_without_signal(text):
    assert detect_lang(text) == "en"


def test_detect_lang_always_supported():
    for t in ["hello", "qwerty zxcvb", "随机文本", "123 456"]:
        assert detect_lang(t) in SUPPORTED


# ── Catalog ──────────────────────────────────────────────────────────────────
def test_catalog_every_key_has_all_languages():
    from action_server.actions._i18n import _CATALOG
    for key, variants in _CATALOG.items():
        for lang in SUPPORTED:
            assert variants.get(lang), f"{key} missing translation for {lang}"


def test_t_falls_back_to_english_for_unknown_lang():
    from action_server.actions._i18n import t
    assert t("btn_login", "xx") == t("btn_login", "en")


def test_t_returns_key_for_unknown_key():
    from action_server.actions._i18n import t
    assert t("nonexistent_key", "en") == "nonexistent_key"


def test_t_default_lang_is_english():
    from action_server.actions._i18n import t
    assert t("kb_no_answer") == t("kb_no_answer", DEFAULT_LANG)


def test_rtl_only_arabic():
    from action_server.actions._i18n import is_rtl
    assert is_rtl("ar") is True
    assert all(not is_rtl(l) for l in ("en", "de", "fr", "es"))


# ── resolve_lang / lang_events (slot persistence) ─────────────────────────────
class _FakeTracker:
    def __init__(self, text, slot=None):
        self.latest_message = {"text": text, "metadata": {}}
        self.sender_id = "iam-test"
        self._slot = slot

    def get_slot(self, name):
        return self._slot if name == "user_lang" else None


def test_lang_events_noop_for_english():
    from action_server.actions._i18n import lang_events
    assert lang_events(_FakeTracker("I need help")) == []


def test_lang_events_persists_non_default():
    from action_server.actions._i18n import lang_events
    ev = lang_events(_FakeTracker("Hola, necesito ayuda"))
    assert len(ev) == 1 and ev[0]["value"] == "es"


def test_lang_events_noop_when_slot_already_matches():
    from action_server.actions._i18n import lang_events
    assert lang_events(_FakeTracker("Hola, necesito ayuda", slot="es")) == []


def test_resolve_lang_keeps_slot_on_ambiguous_followup():
    from action_server.actions._i18n import resolve_lang
    # Short ambiguous message but slot already set to Spanish → stays Spanish.
    assert resolve_lang(_FakeTracker("ok", slot="es")) == "es"


def test_resolve_lang_follows_language_switch():
    from action_server.actions._i18n import resolve_lang
    # User was Spanish but now clearly writes German → follow the switch.
    assert resolve_lang(_FakeTracker("Ich brauche Hilfe bitte", slot="es")) == "de"
