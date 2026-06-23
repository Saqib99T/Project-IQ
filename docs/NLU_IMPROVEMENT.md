# NLU & Conversation Coverage — what changed and how to keep improving

This is the runbook for the bot's NLU (intent classification + retrieval) and
dialogue data. It records the 2026-06 overhaul and the standing process so
coverage keeps improving instead of regressing.

## What was changed (2026-06, commit history on V3-improve)

**Pipeline (`core/config.yml`)**
- Added a **word-level `CountVectorsFeaturizer`** alongside the char-`wb` one
  (only char n-grams existed → weak paraphrase generalisation).
- **DIET + ResponseSelector epochs 20 → 100** (default; 20 was badly
  under-trained) + `constrain_similarities: true`.
- **`FallbackClassifier` threshold 0.15 → 0.5** so genuinely-uncertain input is
  routed to `action_embedding_fallback` (a "did you mean" recovery) instead of
  being silently mis-classified.

**Coverage — smalltalk + service FAQ (`chitchat/*`, `faq/*`)**
- `ResponseSelector` was configured but **unused** (no retrieval intents). Added
  `chitchat/*` (how_are_you, who_are_you, are_you_a_bot, what_can_you_do, thanks,
  joke, who_made_you) and `faq/*` (what_is_this, support_hours, languages,
  data_privacy) retrieval intents + `utter_chitchat`/`utter_faq` responses +
  `respond_*` rules. This is where casual conversation now lives instead of
  falling into `out_of_scope` / mis-routing.

**Data quality (the real driver of the old ~68% accuracy)**
- Removed **81 garbage auto-augmented `create_ticket` examples** ("torment / nauseate
  / harass new ticket" …). `create_ticket` 422 → 340.
- Resolved **34 cross-intent label conflicts** (same phrase labeled with 2+
  intents). Guiding rule: **button/payload-driven intents** (`rating_1..5`,
  `kb_not_helpful`, `*_gdpr_consent`, `confirm_handoff`) must NOT carry free-text
  that collides with core intents (`deny`/`affirm`/`stop`); each phrase kept in
  exactly one home.
- Merged a duplicate `login` intent; balanced thinned `rating_*` + gdpr intents.

**Guards (so it doesn't regress)**
- `tests/test_nlu.py::test_no_cross_intent_example_conflicts` — fails CI if any
  phrase is ever labeled with two intents again.
- `rasa data validate` step added to `.github/workflows/tests.yml` (gates on
  schema errors / undefined intents-actions / missing responses).

## Deferred — dialogue (Tier 3), needs a flow-owner decision

`rasa data validate` still reports **story-structure conflicts after
`create_ticket`**. Root cause: two ticket-creation mechanisms are modelled in
`core/data/stories.yml`:
- the **live web-form path** — `create_ticket → action_search_kb_before_ticket →
  (kb_not_helpful) → utter_ticket_form → submit_ticket_form →
  action_create_ticket_from_form` (the widget posts `/submit_ticket_form`), and
- the **legacy Rasa form-loop path** — `… → ticket_form` / `active_loop:
  ticket_form` (still referenced by form rules + used by `login_form`).

Stories mixing the two contradict each other (and the rules) after
`create_ticket`. Resolving this safely requires confirming **which form path is
canonical at runtime** before deleting/rewriting stories — doing it blind risks
breaking ticket creation (the bot's core function). **Action:** the flow owner
should confirm the web form is the sole path, then the `active_loop: ticket_form`
ticket-creation stories can be removed (the form rules already cover the loop),
clearing the conflicts. The exact-duplicate story was already removed.

A real **two-stage clarification** (ask to rephrase → then offer options/human)
could also replace the single-shot `action_embedding_fallback`; the raised
fallback threshold already activates the existing recovery far more often.

## The standing loop — conversation-driven improvement

Don't guess at examples; mine real failures. Two sources already exist:

1. **KB gaps** — unanswered queries are logged to `kb_search_gaps`
   (`common/db/_kb_gaps.py`) and exposed at **`GET /admin/kb/gaps?days=N`** (also
   surfaced in the admin KB page). These are real user phrasings the bot
   couldn't answer → candidate `ask_knowledge` / new-intent examples, or KB
   content gaps.
2. **Conversation trace** — the Diagnostics → Trace tab reconstructs a turn by
   `request_id`, including the predicted intent + confidence. Low-confidence /
   mis-predicted turns are labelling candidates.

**Weekly loop:**
1. Pull recent `kb_gaps` + low-confidence turns from the trace store.
2. Label each: existing intent (add as example), new intent, or genuine
   out-of-scope (add to `out_of_scope`).
3. Add the examples to `core/data/nlu.yml` — one phrase, one intent.
4. `cd core && rasa data validate` (must report **0** conflicts).
5. `rasa train`, then **measure**: `rasa test nlu --cross-validation --folds 3`
   → check the per-intent F1 in `results/intent_report.json` and the confusion
   matrix; fix the *actual* colliding pairs rather than guessing.
6. Redeploy the model **and rebuild the `action_embedding_fallback` index**
   (it reads `nlu.yml`).

## Useful commands

```bash
cd core
rasa data validate --config config.yml --domain domain.yml --data data   # integrity
rasa train --config config.yml --domain domain.yml --data data            # build model
rasa test nlu --cross-validation --folds 3 --config config.yml --nlu data # F1 + matrix
```

> Note: Rasa 3.6 requires `packaging==20.9` (pinned in `requirements.txt`). If the
> CLI errors with `cannot import name 'LegacyVersion'`, the venv's `packaging`
> drifted — reinstall the pin.
