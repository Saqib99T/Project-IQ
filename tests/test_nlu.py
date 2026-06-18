"""
NLU / Conversation design — data-integrity tests over the training data, the
domain, the dialogue policies and the pipeline config. These catch broken or
undeclared intents, malformed responses and missing stories/rules before a
model is ever trained.

Run:  python -m pytest tests/test_nlu.py -v
"""
import os
import yaml
import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return yaml.safe_load(f)


def _nlu_items():
    return [i for i in _load("core/data/nlu.yml").get("nlu", []) if isinstance(i, dict)]


def _nlu_intents():
    return [i["intent"] for i in _nlu_items() if "intent" in i]


def _domain():
    return _load("core/domain.yml")


def _domain_intent_names():
    names = set()
    for i in _domain().get("intents", []):
        names.add(i if isinstance(i, str) else next(iter(i.keys())))
    return names


# ── Training data ────────────────────────────────────────────────────────────
def test_nlu_parses_and_defines_many_intents():
    assert len(set(_nlu_intents())) >= 30


def test_core_conversation_intents_present():
    intents = set(_nlu_intents())
    required = ["greet", "help", "create_ticket", "list_tickets", "check_status",
                "update_ticket", "view_comments", "list_attachments", "ask_knowledge",
                "request_human_agent", "confirm_gdpr_consent", "deny_gdpr_consent",
                "affirm", "deny", "goodbye"]
    missing = [r for r in required if r not in intents]
    assert not missing, f"missing core intents: {missing}"


def test_every_intent_block_has_examples():
    empty = [i["intent"] for i in _nlu_items()
             if "intent" in i and not (i.get("examples") or "").strip()]
    assert not empty, f"intents with no training examples: {empty}"


def test_rating_intents_cover_one_to_five():
    intents = set(_nlu_intents())
    for n in range(1, 6):
        assert f"rating_{n}" in intents


# ── Domain consistency ───────────────────────────────────────────────────────
def test_every_trained_intent_declared_in_domain():
    undeclared = sorted(set(_nlu_intents()) - _domain_intent_names())
    assert not undeclared, f"intents trained but not declared in domain.yml: {undeclared}"


def test_domain_defines_responses():
    responses = _domain().get("responses")
    assert isinstance(responses, dict) and responses


def test_all_responses_use_utter_prefix():
    bad = [k for k in _domain().get("responses", {}) if not k.startswith("utter_")]
    assert not bad, f"responses not prefixed utter_: {bad}"


def test_every_response_has_content():
    empty = []
    for name, variations in _domain().get("responses", {}).items():
        if not variations:
            empty.append(name)
            continue
        first = variations[0]
        if not (first.get("text") or first.get("buttons") or first.get("custom") or first.get("image")):
            empty.append(name)
    assert not empty, f"responses with no text/buttons/custom: {empty}"


def test_domain_declares_actions_or_forms():
    d = _domain()
    assert d.get("actions") or d.get("forms")


def test_domain_defines_slots():
    assert isinstance(_domain().get("slots", {}), dict) and _domain().get("slots")


def test_domain_intents_have_no_duplicates():
    names = []
    for i in _domain().get("intents", []):
        names.append(i if isinstance(i, str) else next(iter(i.keys())))
    dupes = {n for n in names if names.count(n) > 1}
    assert not dupes, f"duplicate intents declared in domain.yml: {dupes}"


def test_form_required_slots_exist_in_slots():
    d = _domain()
    slots = set((d.get("slots") or {}).keys())
    for form_name, form_def in (d.get("forms") or {}).items():
        required = (form_def or {}).get("required_slots") or []
        missing = [s for s in required if s not in slots]
        assert not missing, f"form {form_name} references undefined slots: {missing}"


# ── Dialogue management ──────────────────────────────────────────────────────
def test_stories_present():
    assert len(_load("core/data/stories.yml").get("stories", [])) >= 1


def test_rules_present():
    assert len(_load("core/data/rules.yml").get("rules", [])) >= 1


# ── Pipeline & policies (config.yml) ─────────────────────────────────────────
def test_config_language_is_english():
    assert _load("core/config.yml").get("language") == "en"


def test_pipeline_has_classifier_and_fallback():
    names = {c.get("name") for c in _load("core/config.yml").get("pipeline", [])}
    assert "DIETClassifier" in names
    assert "FallbackClassifier" in names
    assert "WhitespaceTokenizer" in names


def test_policies_include_rule_and_ted():
    names = {p.get("name") for p in _load("core/config.yml").get("policies", [])}
    assert "RulePolicy" in names
    assert "TEDPolicy" in names
    assert "MemoizationPolicy" in names
