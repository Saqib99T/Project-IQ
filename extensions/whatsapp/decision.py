"""The ambient decision engine — whether the bot should speak in a group
conversation it wasn't directly addressed in. This is the one piece of the
whole WhatsApp integration with no API equivalent to lean on
(docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md §4.2): Meta hands you every
message, it does not tell you which ones are worth a reply.

Two independent knobs, both required for a group message to get a reply:

1. `should_respond()` — is this the kind of moment to speak at all, given the
   group's proactivity dial? An explicit @-mention always wins regardless of
   the dial (baseline requirement FR3). Everything else is gated by
   proactivity level + a per-group cooldown, so a "light/full_proactive"
   group doesn't get a bot reply to every single message.
2. `_is_in_scope()` — the topic fence (FR11). Separate from (1) on purpose:
   Meta's Jan-2026 policy bans general-purpose AI chatbots on the Business
   API ("can answer any question on any topic"), so even a mention-triggered
   reply should stay inside a defined business purpose, not just an
   unprompted one.

*** Both the mention-detection payload shape and the "is this worth
answering" scoring are placeholders pending Phase 0 confirmation (group plan
§2.1) and real usage data (group plan §8 Phase 2's "log every skip/speak
decision for review" requirement) — see the docstrings below. Ship this at
the most conservative proactivity level (mention_only) until that review has
happened, per the group plan's §9 decision #2. ***
"""
import re
import time
from typing import Optional

from web.api.rate_limiting import MemoryStore

# Placeholder scope fence (FR11) — keeps an unscoped "opine on anything" bot
# from being what actually ships. Intentionally narrow and easy to extend;
# swap for a real KB-topic-confidence check once Phase 2 has usage data to
# tune against, rather than a hardcoded keyword list.
_TOPIC_KEYWORDS = (
    "ticket", "issue", "bug", "error", "incident", "outage", "sla", "deploy",
    "release", "status", "kb", "knowledge base", "help", "support", "task",
    "project", "blocked", "broken", "down", "fix", "urgent",
)

# One process-local cooldown tracker per group id: "don't speak again for N
# minutes unless mentioned" (FR8). MemoryStore is the same dependency-free
# fixed-window primitive already used for Shopify's write-rate-limit and the
# Flask app's own per-IP limiter (web/api/rate_limiting.py) — reused here
# rather than adding a second copy for a per-group key instead of per-IP.
_cooldown_store = MemoryStore()


def _is_in_scope(text: str) -> bool:
    lowered = (text or "").lower()
    return any(keyword in lowered for keyword in _TOPIC_KEYWORDS)


def is_mentioned(message_text: str, mentions: Optional[list], bot_wa_id: str, bot_handle: str = "ProjectIQ") -> bool:
    """True if this message @-mentions the bot.

    Meta's group message webhook is EXPECTED to carry a structured mentions
    list (mirroring how mentions work in other messaging platforms), but the
    exact field name/shape was not available in the docs fetched while
    writing this (group plan §2.1) — confirm against a real payload in Phase
    0b before trusting `mentions` over the text fallback below. Until then,
    this checks both: a structured mentions list if the caller extracted one,
    and a case-insensitive substring match on the configured handle name as a
    fallback that works regardless of payload shape.
    """
    if mentions and bot_wa_id in mentions:
        return True
    return bool(re.search(rf"@{re.escape(bot_handle)}\b", message_text or "", re.IGNORECASE))


def should_respond(
    group_id: str, message_text: str, mentioned: bool, proactivity_level: str,
) -> tuple:
    """Returns (should_respond: bool, reason: str) for one inbound group
    message. `reason` is logged, not shown to users — this decision needs a
    trail to review before turning proactivity up (group plan §8 Phase 2)."""
    if mentioned:
        return True, "mentioned"

    if proactivity_level in ("silent", "mention_only", None, ""):
        return False, f"proactivity_level={proactivity_level!r} — mention-only or silent"

    if not _is_in_scope(message_text):
        return False, "out of topic scope (FR11 fence)"

    cooldown_key = f"whatsapp_group_proactive:{group_id}"
    # Reuses the rate-limiter as a cooldown gate: "at most 1 proactive
    # message per window" rather than its usual "at most N per window".
    allowed, retry_after = _cooldown_store.hit(cooldown_key, 1, 600)
    if not allowed:
        return False, f"cooldown active, {retry_after}s remaining"

    if proactivity_level == "light_proactive":
        # Placeholder: a real confidence score (KB match strength, NLU
        # intent confidence) belongs here once Phase 2 wires the actual
        # brain into this decision instead of a keyword heuristic. For now,
        # being in-scope + off cooldown is the bar.
        return True, "light_proactive + in scope + off cooldown"

    if proactivity_level == "full_proactive":
        return True, "full_proactive + in scope + off cooldown"

    return False, f"unrecognized proactivity_level={proactivity_level!r}"
