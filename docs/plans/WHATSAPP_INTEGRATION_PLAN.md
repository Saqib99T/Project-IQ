# WhatsApp Integration — Strategy & Architecture Plan

Status: **planning only — no implementation**
Supersedes/updates: the 2026-06-23 "inbound channels deferred" decision record in `docs/Backup/P3_IMPLEMENTATION_PLANS.md` §"Decision record — #4 inbound channels" — same core findings, re-grounded against the `extensions/` framework that didn't exist yet when that decision was written.

---

## 0. What This Actually Is

Today, customers reach the bot two ways: the embedded web widget, or the standalone `/bot` page — both go through IAM SSO and a custom Flask + Socket.IO pipeline (`bp_chat`, `socketio_events`), not Rasa's own channel connectors. WhatsApp integration means: a customer messages your business's WhatsApp number, that message reaches this same bot (KB search, ticket status, order status if Shopify/Amazon is connected), the bot replies back into WhatsApp, and if the conversation needs a human, it hands off to the same operator console already in use today — the operator doesn't know or care the customer is on WhatsApp instead of the widget.

The hard part was already identified correctly in June and still holds: **every existing identity, session, and reply-routing assumption in this codebase is IAM-SSO-shaped**, and a WhatsApp user has no IAM identity at all — just a phone number. That gap, not the WhatsApp API itself, is most of the actual engineering work.

---

## 1. What It Will Do (user-facing scope)

- A customer sends a WhatsApp message to your business number.
- The bot responds with the same capabilities it has on the web widget: knowledge-base search, FAQ answers, ticket status lookups (once identity is resolved — see §3), order status (if the tenant has Shopify/Amazon connected).
- If the bot can't help, the conversation hands off to a human operator, who replies from the same operator console used for widget chats today — replies get routed back out to WhatsApp instead of a browser socket.
- Conversation history lands in the same `conversations`/`messages` tables as every other channel, just tagged with `channel = 'whatsapp'` — one unified history, not a second system.
- **Not in scope for a first version**: proactive/business-initiated outreach (e.g., "your ticket was updated" pushed unprompted) — that requires pre-approved message templates and is a distinct, later capability, not the base "customer messages in, bot replies" flow.

---

## 2. How It Will Work — Architecture

### 2.1 Inbound path

Meta's WhatsApp Cloud API delivers every inbound message as an HTTPS POST webhook to a URL you register (same shape as Shopify/Amazon's webhook receivers already built in this codebase). The payload's `messages[]` array carries `from` (the sender's phone number, E.164 without `+`), `text.body` (the message content), and `id` (a unique message id) — enough to build a reply.

This becomes `extensions/whatsapp/routes.py`, mirroring the pattern already established for Shopify/Amazon: signature-verified inbound webhook (Meta signs payloads with `X-Hub-Signature-256`, HMAC-SHA256 over the app secret — same verify-then-process shape as Shopify's webhook HMAC check), then bridges the message into the existing `bp_chat`/Socket.IO pipeline as if it arrived from the widget, just tagged with a WhatsApp-specific sender identity (§2.2) instead of an IAM one.

### 2.2 The identity gap (the real design problem)

No IAM SSO exists for a WhatsApp user — just a phone number. Per the June decision's reusable-core design, this needs a **guest channel-session identity**: `ch-whatsapp-{wa_id}-{tenant}` in place of today's `iam-{sub}-{product}-{epoch}`. Two capability tiers, recommended to ship in that order:

1. **Guest/KB-only mode (Phase 1)** — the WhatsApp user can search the KB, ask FAQs, and create a ticket as a guest (name + phone number captured in the conversation, no account link) — exactly what an unauthenticated widget visitor can already do today via "Continue as guest." No new auth model needed, just a new sender-identity shape recognized by the existing code paths that already handle guest sessions.
2. **Account-linking (Phase 3, later)** — to unlock account-scoped actions (their own ticket history, order status tied to their account) the phone number needs to be matched to a real identity. Two realistic approaches: (a) match against a known contact phone number already on file in itsm-service/Shopify/Amazon customer records (passive, no extra step for the user, but only works if that phone number is already known and correctly recorded), or (b) an explicit verification step (e.g., a one-time code sent to their IAM-registered email, or a magic link) before account actions unlock. This is a real security decision, not a rubber stamp — recommend treating it as its own design pass once Phase 1 is proven, not bundled into the initial build.

### 2.3 Outbound path — and the 24-hour rule

Sending a WhatsApp message is `POST /{phone_number_id}/messages` with `messaging_product: "whatsapp"`, `to: <phone>`, and a `type`-specific body. Two very different cases:

- **Inside the 24-hour customer service window** (opened by the customer's last inbound message): free-form text, images, quick-reply buttons — no restriction, this covers the large majority of bot replies and live operator handoff conversations, since those happen right after the customer messages in.
- **Outside the window**: Meta requires a **pre-approved message template** — free-form text is rejected outright. Template submission takes up to 24 hours for Meta's review and can be rejected. This only matters for: a slow-to-respond operator picking up a handoff hours later, or any future proactive-notification feature (explicitly out of scope for v1, §1).

This is exactly the "per-channel outbound reply routing" gap the June decision flagged — today, handoff replies only ever target a widget socket. WhatsApp needs a second outbound path (the send-message API call) wired into the same dispatch point, with a within-window/outside-window branch.

### 2.4 Where this fits the `extensions/` framework

The `extensions/` plugin architecture (built after the June decision, now hosting Shopify/Amazon under `ExtensionKind.COMMERCE`) is structurally a good fit here too — WhatsApp needs both an inbound webhook (like Shopify's order-event webhook) and outbound API calls (like Shopify's GraphQL calls), the same bidirectional shape `COMMERCE` extensions already have. Two options: reuse `COMMERCE` as-is (it's not semantically about commerce, but the mechanics — manifest, `routes.py` for the webhook, `service.py` for the send-API client — transfer directly), or add a new `ExtensionKind.CHANNEL` for clarity. Small decision, doesn't change the actual design — flagged for §6.

---

## 3. External Prerequisites (mirrors the Shopify/Amazon-style checklist)

1. **Meta Business Manager account** — business verification typically takes 1-3 business days. Start this immediately given the lead time, same reasoning as Amazon's Public Developer application.
2. **A phone number dedicated to WhatsApp Business** — must not already be linked to a personal WhatsApp or WhatsApp Business app account. Decide this number before anything else, since changing it later means re-verifying.
3. **Cloud API app registered in Meta for Developers**, OR **a BSP (Business Solution Provider) subscription** (Twilio, 360dialog, etc.) — see §5 for the tradeoff.
4. **At least one approved message template**, needed the moment any reply happens outside the 24-hour window (§2.3) — submit early, since approval can take up to 24h and templates can be rejected on first submission.

---

## 4. Pricing — a change landing right as this would go live

Current model (since November 2024): **service conversations are free and unlimited** — a reply within the 24-hour customer-service window costs nothing, only business-initiated template messages outside the window are billed per-message.

**This changes 2026-10-01**: Meta moves to billing **every business message**, including service replies and utility messages sent *within* the 24-hour window — not just template messages. Today is 2026-08-13, so any integration built and shipped now would be live for roughly seven weeks under the current free-service-reply model before this shift lands. Worth factoring into the cost estimate and timeline rather than assuming today's free-reply economics hold — budget for the new model as the baseline, not the exception.

---

## 5. Cloud API (direct) vs BSP — a real decision, not a formality

| | Direct Cloud API | BSP (Twilio, 360dialog, etc.) |
|---|---|---|
| Engineering effort | Build webhook verification, template management, token refresh, contact handling yourself (all inside `extensions/whatsapp/`) | Managed — BSP handles the Meta relationship, you integrate against their (usually simpler) API |
| Cost | No extra platform fee, just Meta's per-message pricing | Meta's per-message pricing + BSP's own fee (commonly $10-$100/month plus markup) |
| Fit with this codebase | Matches exactly how Shopify/Amazon were built (own OAuth, own webhook verification, own send calls) — consistent pattern, no new integration paradigm | A different integration shape than everything else in `extensions/` — one more vendor relationship, one more credential set, one more API surface to learn |

Recommendation if forced to choose: **direct Cloud API**, for consistency with the Shopify/Amazon pattern already proven in this codebase — but this is genuinely a tradeoff (BSP trades engineering time for a monthly fee and faster initial setup), worth a real decision rather than defaulting silently.

---

## 6. Phased Roadmap

| Phase | Scope | Notes |
|---|---|---|
| **0 — Business verification** | Meta Business Manager verification, dedicate a phone number, register the Cloud API app (or pick a BSP) | Start immediately — 1-3 day external lead time, same category of risk as Amazon's Public Developer application. |
| **1 — Inbound + guest KB bot** | `extensions/whatsapp/` (routes.py webhook receiver, service.py send client), guest channel-identity (`ch-whatsapp-{wa_id}-{tenant}`), bridge into the existing chat pipeline — KB search + guest ticket creation only, no account actions | The reusable core the June decision called for — this is genuinely reusable for Slack/Teams later if greenlit, not WhatsApp-specific plumbing. |
| **2 — Outbound + handoff** | Send-message API wiring with the within/outside-24h-window branch (§2.3), extend the handoff relay to target WhatsApp sends alongside the widget socket | Needs at least one approved template (§3.4) before this phase can be considered done. |
| **3 — Account-linking (optional)** | Phone-number-to-identity matching or explicit verification (§2.2) to unlock account-scoped ticket/order actions | Its own security design pass — don't bundle into Phase 1/2. |

---

## 7. Risks

- **Template approval is external and can be rejected** — draft templates early, expect iteration, don't assume first-submission approval.
- **Phone number "cleanliness" requirement** — a number already tied to a personal WhatsApp account can't be reused; confirm this before any other setup work.
- **Guest-mode abuse surface** — a phone number is far easier to spoof/rotate than an IAM login; guest-mode ticket creation and KB access should get the same rate-limiting scrutiny already applied elsewhere (`web/api/rate_limiting.py`), scoped per WhatsApp number, not assumed safe by default.
- **The October 2026 pricing shift** (§4) lands roughly 7 weeks after today — budget the new per-message-in-window model, not the current free one.
- **Cloud API vs BSP is a real tradeoff** (§5), not a default — deciding late after building against one model is expensive to reverse.

---

## 8. Decisions Needed From You

1. **Cloud API (direct) vs BSP** (§5) — consistency with the existing integration pattern vs. managed/faster setup.
2. **Which phone number** to dedicate, and confirm it isn't already linked to a personal WhatsApp account (§3.2).
3. **Guest-mode scope for Phase 1** — is KB search + guest ticket creation enough for a first version, or is account-linking (Phase 3) actually required before this is useful for your use case?
4. **`ExtensionKind.CHANNEL` vs reusing `COMMERCE`** (§2.4) — cosmetic naming decision, doesn't change the build.

---

## 9. References

- [WhatsApp Business Platform — 24-hour customer care window](https://www.enchant.com/whatsapp-business-platform-24-hour-rule)
- [WhatsApp Cloud API — webhook payload structure](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components)
- [WhatsApp Cloud API — sending messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/)
- [WhatsApp Business API pricing changes 2026](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- Prior decision record: `docs/Backup/P3_IMPLEMENTATION_PLANS.md` §"Decision record — #4 inbound channels"
