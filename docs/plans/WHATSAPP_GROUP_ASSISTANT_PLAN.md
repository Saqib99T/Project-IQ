# WhatsApp Group Assistant — Deep Analysis, Requirements & Plan

Status: **Phase 0a implementation landed on `V3-WhatsApp`** (`extensions/whatsapp/`) — self-contained extension code + fixture/unit tests, zero dependency on a verified business account, per §8's Phase 0a. Still blocked on real Meta credentials for anything beyond that (Phase 0b onward). Living document — will be revised as decisions are made and the Phase 0b spike retires open unknowns.
Last updated: 2026-08-24.

Related but distinct from [`docs/plans/WHATSAPP_INTEGRATION_PLAN.md`](./WHATSAPP_INTEGRATION_PLAN.md), which covers a customer messaging the business 1:1 for support. That doc predates the fact below and assumes WhatsApp is 1:1-only for a business account — it isn't anymore. This doc covers a different shape entirely: a small multi-party group where ProjectIQ is a participant, not a support desk. They'll likely share some plumbing (the `extensions/` framework, the action-server "brain") but have different identity models, different trigger models, and different risk profiles. Read both if building either.

---

## 0. The use case, as given

- A WhatsApp group is created with a few real people (real phone numbers).
- ProjectIQ is added to that group as a chatbot participant.
- ProjectIQ sees the entire conversation, not just messages addressed to it.
- It replies when explicitly @-mentioned.
- It may also reply unprompted, when it judges the moment appropriate ("any appropriate time it feels it should give its opinion").

This is a baseline. §3.2 proposes additions grounded in what already exists in this codebase and in where the market is moving; §9 asks for your call on scope.

---

## 1. The fact that reshapes this analysis: WhatsApp groups now have an official API

As of 2026, Meta shipped a **WhatsApp Groups API** on the Cloud API / Business Platform. This did not exist when the sibling 1:1 plan or the original June 2026 "inbound channels deferred" decision record ([[project_channels_deferred]]) were written — both assumed group participation was only reachable through unofficial automation. That assumption is now out of date, and it changes the recommendation substantially.

**What the official route actually gives you:**

| | Detail |
|---|---|
| Eligibility | Requires an **Official Business Account (OBA)** on the Cloud API with `whatsapp_business_messaging` approved. Not available on the consumer WhatsApp Business app, and numbers in "Multi-solution Conversations" are explicitly excluded. |
| Participant cap | **8 participants total**, and the business number occupies one slot — so **7 real humans** per group. A business number can run up to 10,000 groups, but only **one Cloud API business per group**. |
| Joining | **No bulk-add endpoint.** The only path in: generate an invite link via the API → send it to each contact (typically as a 1:1 template message) → they tap to request → you approve via `POST /<GROUP_ID>/join_requests`. One person at a time, no CSV import. |
| Messaging | Same `POST /messages` endpoint as 1:1, with `recipient_type: "group"` and `to` set to the group ID. Text, media, and template messages (text- and media-based) are supported. |
| Webhooks | Four dedicated fields, each needing its own subscription: `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update` — plus the existing message-delivery webhooks for actual message content. |
| Pin/admin | Group admin can pin up to 3 messages (1–30 days each, oldest auto-unpins); can remove participants via `DELETE /<GROUP_ID>/participants`. |
| Not supported | Voice/video calling, disappearing messages, view-once media, message edit/delete, interactive/commerce messages — none of these work in groups even though they work 1:1. |
| Pricing | Same per-message billing as 1:1 — **no group discount**, and this lands right as Meta's broader Oct-2026 pricing change (already flagged in the sibling plan) removes free in-window service replies. |

This is a materially good fit for the stated use case — "a few real numbers" sits comfortably inside the 7-human cap, and the manual invite/approve flow is a non-issue at that scale (it would be a real problem at 50+ people, which is worth flagging now in case the group is expected to grow — see §7).

**The unofficial route (Baileys, whatsapp-web.js, WAHA, Evolution API, etc.) — actively recommend against it, now that it's unnecessary:**

- These automate a personal/Business-app WhatsApp Web session rather than calling an approved API — that's a Terms of Service violation, and Meta's detection (device fingerprinting, behavioral analysis, unanswered-message counting added in 2026) typically catches it in **2–8 weeks**. One 2026 study of 600+ SMB accounts found **68% experienced at least one ban within 12 months**.
- Meta introduced a policy on **January 15, 2026** explicitly **banning general-purpose AI chatbots** ("can answer any question on any topic") from the Business API — relevant to this project either way (see §3.2 FR11), but doubly so if attempted through an unofficial client, which has zero policy standing to begin with.
- There's an active security angle too: a popular "anti-ban" npm package for Baileys (56,000 downloads) was confirmed in April 2026 to be exfiltrating WhatsApp session credentials.

Given the official Groups API now covers the actual requirement, there's no remaining reason to take on that risk. Treat the unofficial route as closed unless something below turns out to be a hard blocker.

---

## 1.1 Account prerequisites — two tiers, and the second one is the real gate

**Tier 1 — basic WhatsApp Business Account (Cloud API)**, needed regardless of which WhatsApp plan (this one or the sibling 1:1 plan) ships first: a verified Meta Business Manager/Business Portfolio, completed Business Verification (legal documents matching the registered business name/address), a phone number dedicated to WhatsApp Business (must not currently be active on the regular or Business app), a two-step verification PIN on that number (mandatory, cannot be disabled via the API afterward), a Cloud API app (or BSP subscription — Twilio/360dialog/Wati, same tradeoff as the sibling plan's §5), a display name submitted and approved (its own separate review, can be rejected independent of business verification), and a system user/token with `whatsapp_business_management` + `whatsapp_business_messaging` scopes.

**Tier 2 — Official Business Account (OBA)**, specifically required for the Groups API this plan depends on: everything in Tier 1, plus —
- registered on the WhatsApp Business Platform for **30+ days** before applying;
- Business Verification and display-name approval already **completed**, not just submitted;
- WhatsApp Business Messaging Policy compliance;
- as of 2026, the application must be **submitted through a BSP** (Wati/360dialog/similar), not filed direct with Meta;
- **"notability"** — WhatsApp requires the business be a recognizable, "often searched for" entity, evidenced in practice by roughly **3–5 pieces of genuine, unpaid media coverage** using the exact registered business name. Self-issued press releases, sponsored content, and paid placements don't count.
- Timeline: **2–6 weeks**, and meeting every criterion above doesn't guarantee approval.

**This is a real risk, not a formality — folded into §7.** Notability isn't a form to fill out, it's press coverage the business either already has or doesn't. Worth an honest check now — has 99 Technologies been covered by outlets it doesn't control? — before Phase 0 is scoped around an OBA approval that may not be attainable on the first attempt, or at all.

**No sandbox currently exists.** Checked the repo — no `extensions/whatsapp/` code, no WABA config or credentials anywhere. Starting from zero. Also, critically: **Meta's Groups API sandbox does not waive the OBA gate** — there's no test mode for groups specifically, unlike the free test-number sandbox for basic 1:1 Cloud API mechanics (webhook/send round-trips, no business verification needed). This splits Phase 0 into two sub-steps — see §8. Third-party vendors advertising an OBA-free "Groups API sandbox" (e.g. Whapi.Cloud) are almost certainly wrapping the same unofficial WhatsApp-Web-automation route already ruled out above (ban risk, ToS violation) — not a real shortcut.

---

## 2. What's *not* yet confirmed — retire these before committing to Phase 1 scope

The fetched Meta documentation didn't include the full "Group Management Reference," so the following are open, not assumed:

1. **The exact webhook payload shape for an @-mention inside a group text message.** Whether the message payload carries a `mentions` array (as some other messaging platforms do) or the bot has to string-match its own display name/number in `text.body` itself. This is load-bearing for FR3/FR4 — confirm with a real sandbox message before designing the mention-detection code.
2. **OBA approval timeline for 99 Technologies' number** — Official Business Account status is a prerequisite gate, separate from and likely slower than ordinary Cloud API onboarding.
3. **Whether groups have their own 24-hour-style session/response-window semantics**, or inherit the 1:1 rule as-is — the sibling plan's §2.3/§4 pricing analysis assumed 1:1; groups may differ.
4. **Whether "one Cloud API business per group" ever bites** — irrelevant for a single tenant's single group, but worth a sentence if this pattern is expected to multiply across tenants later.

Phase 0 (§8) exists specifically to close these before Phase 1 scope is locked.

---

## 3. Requirements

### 3.1 Functional — baseline (as given)

- **FR1**: A WhatsApp group holds a small number of real participants (≤7, per the API's cap) plus the ProjectIQ business number.
- **FR2**: ProjectIQ receives and retains every message in the group, not just ones addressed to it.
- **FR3**: An explicit @-mention of ProjectIQ always produces a reply in-thread.
- **FR4**: ProjectIQ may also reply unprompted when it judges the moment appropriate. This is the one requirement with no WhatsApp-native equivalent — it has to be built as a decision layer on top of raw message ingestion (see §4.2), not something the API gives you.

### 3.2 Functional — recommended additions

These aren't in the original ask but follow from either what this codebase already has or from where comparable products are heading (§6):

- **FR5**: Unify into the existing conversation/message data model — `channel = 'whatsapp_group'`, each message tagged with the sending participant's phone number — one history, same principle already applied to every other channel in this codebase.
- **FR6**: Known-participant identity mapping. Because group membership here is small and admin-curated by construction (the API's own cap + invite/approve flow), map each phone number to an internal identity once at group setup. This is much simpler than the open, anonymous-customer identity problem the 1:1 plan has to solve (§2.2 there) — don't import that machinery here, it's solving a harder problem than this one has.
- **FR7**: Tool-use inside the group — since it's watching real project/support conversation, let it act, not just answer: KB search, ticket status lookup, ticket creation ("open a ticket for this"), SLA/project status pulls. Reuse the existing action-server brain; this should not need a second AI system.
- **FR8**: Tenant-configurable proactivity level (silent / @mention-only / light-proactive / full-proactive) plus a per-group cooldown, so it can't spam a small group of real people who see every single message it sends. This is the single biggest UX and cost risk in the whole feature (§7) and should be a first-class control, not an afterthought.
- **FR9**: Escalation parity with the existing handoff concept ([[project_handoff_socket_relay]]) — if the bot can't help, it should say so and flag it, rather than guess. There's no separate "operator console" here; the escalation target is just the humans already in the group, or an operator watching a parallel queue.
- **FR10**: Self-disclosure + opt-out. WhatsApp's Business Messaging Policy requires disclosing automated participants and giving an opt-out path — not optional, and worth building into the group's welcome/behavior from day one rather than retrofitting.
- **FR11**: Topic/scope fencing. The bot's remit needs to be describable as a defined business purpose (project status, IT/ticket support, KB Q&A) rather than "comment on anything it observes" — both because that's the literal thing Meta's January 2026 policy bans on the Business API, and because an unscoped opinion-generating bot in a live human group is a bad idea on UX grounds regardless of policy.

### 3.3 Non-functional

- **Cost**: every send is billed per message, group or not, and every proactive/unprompted reply is a discretionary cost the bot is choosing to incur — FR8 is a cost control as much as a UX one, more so once the Oct-2026 pricing change removes free in-window replies (per the sibling plan's §4).
- **Latency**: this group has real people mid-conversation; a slow reply reads as broken, not thoughtful — this is a live-chat UX bar, not a support-ticket UX bar.
- **Spam ceiling**: unlike 1:1 support, "talks too much" is the primary failure mode to design against here, ahead of "doesn't know enough."
- **Compliance**: disclosure/opt-out (FR10) and the general-purpose-chatbot restriction (FR11) are both real policy surfaces with WhatsApp, not just internal taste calls.
- **Auditability**: full transcript retention, already this codebase's norm, doubles here as the training/evaluation data for tuning the proactivity decision engine.

---

## 4. Solution architecture

### 4.1 Where this plugs into what already exists

- The `extensions/` plugin framework (hosting Shopify/Amazon under `ExtensionKind.COMMERCE`, Teams under `ExtensionKind.DESTINATION` — confirmed current values in `extensions/base.py`, no `CHANNEL` kind exists yet) is structurally the right home, per the same reasoning the sibling plan already worked out for 1:1 WhatsApp. This use case is neither pure outbound push (`DESTINATION`) nor a transactional lookup (`COMMERCE`) — it's inbound-observe + inbound-mention + outbound-reply, which is the concrete second consumer that makes the `ExtensionKind.CHANNEL` question (flagged as cosmetic in the sibling plan) worth actually deciding now.
- Inbound path: `extensions/whatsapp/group_routes.py` — signature-verified webhook receiver for both message content and the four group metadata events, same verify-then-process shape already used for Shopify/Amazon.
- The existing `bp_chat`/`socketio_events` pipeline is built around one human ↔ one bot session. A group is a shared multi-party session — closer in shape to the operator-console "room" concept already built for handoff ([[project_handoff_socket_relay]]) than to the 1:1 widget session. Expect a new "room" abstraction: one conversation record keyed by the WhatsApp group ID, N participant identities, one shared message history, one bot voice.

### 4.2 The decision engine — the genuinely new piece

Nothing in the codebase today decides *whether* to speak; everything today decides *how* to answer once addressed. Per inbound group message:

1. **Always-respond path** — message contains an @-mention of the bot's contact → straight to the existing action-server/NLU brain, reply in-thread. (Blocked on confirming the mention payload shape, §2.1.)
2. **Ambient-judgment path** — every other message → a lightweight relevance pass (cheap classifier or small LLM call) over a rolling window of the last ~5–10 messages, deciding: *silent* / *worth a KB-grounded answer* / *worth flagging*. Only messages clearing a confidence bar get a full bot turn.
3. **Guardrails wrapping both paths** — per-group cooldown (don't speak again for N minutes unless mentioned), the tenant proactivity dial (FR8), and the topic fence (FR11) enforced as a hard classifier/system-prompt constraint, not a soft suggestion.

This mirrors where Slack/Teams "AI teammate" products are heading (§6): none of them reply to every message either — the judgment layer *is* the product, not a side detail.

### 4.3 Identity model

- Participants are a small, admin-curated set by construction (the API's cap + invite/approve flow) → map phone → internal identity once at setup, stored on the group record. This sidesteps the open-identity problem the 1:1 plan has to solve for anonymous customers.
- The bot's presence is just the one verified WhatsApp Business number tied to the tenant — there's no separate "add the bot" step; the business number *is* the group's participant slot from creation.

### 4.4 Data model

- Extend `conversations`/`messages` with `channel = 'whatsapp_group'`, an `external_group_id`, and a participant phone→identity map — extend whatever table already backs [[project_product_scoped_sessions]]'s identity model rather than inventing a parallel one.

---

## 5. Operational setup flow (no bulk-add exists — see §1)

1. Meta Business Manager + Tier 1 setup, then the 30-day wait and OBA application (Tier 2, §1.1) — external, lead time, and the one step in this whole plan whose outcome isn't fully in 99T's control (notability).
2. Create the group via the API (business number is auto-included).
3. Generate an invite link, send it to each of the "few real numbers" individually.
4. Approve each join request via `POST /<GROUP_ID>/join_requests`.
5. Admin maps each joined number to an internal identity (FR6).
6. Subscribe to all four group webhook fields.

---

## 6. Market context — what's trending here right now

- The broad 2026 direction is proactive, not reactive: AI agents are shifting from answer-when-asked to autonomous participants embedded across enterprise tools, with Slack/Teams AI "teammates" now owning whole workflows (triage, summarizing, drafting, pushing updates) inside the channel rather than waiting to be asked.
- WhatsApp specifically is being treated as a serious commercial channel — one industry report cites AI agents on WhatsApp driving conversion rates up to 21x higher than slow-to-respond alternatives — which is the commercial case *for* FR4's proactive behavior.
- But the regulatory trend is cutting the other way for exactly this shape of feature: Meta's January 2026 policy explicitly targets "general-purpose AI assistants that can answer any question on any topic" on the Business API. A bot that "gives its opinion" on whatever it observes, unscoped, is the closest thing to that description this project could plausibly ship — which is why FR11 (topic fencing) is framed as a hard requirement above, not a nice-to-have.

The net read: build the proactive/ambient piece — it's clearly where the market is — but scope it to a named business purpose (project status, IT/ticket support, KB Q&A) from day one, both to stay inside Meta's policy and because an unscoped "opinion" bot in a live human group is a bad experience even where it's allowed.

---

## 7. Risks

- **OBA "notability" bar (§1.1) may not be attainable** — this is the single biggest unresolved risk in the whole plan, ahead of everything below. Unlike the other prerequisites (documents, phone number, PINs), notability depends on unpaid third-party press coverage that either exists or doesn't; there's no amount of engineering effort that substitutes for it. Confirm this before sequencing anything else in Phase 0.
- **8-participant cap** is fine for "a few real numbers" today; it's a hard ceiling the moment this group is expected to grow past 7 humans. Worth confirming expected size now.
- **No bulk-add / manual invite-approve flow** doesn't scale past a handful of people — fine at this scale, a real limitation if this pattern needs to self-serve later.
- **Per-message billing + the Oct-2026 pricing change** (sibling plan §4) means a chatty bot has a real, recurring, per-word-of-enthusiasm cost — reinforces FR8 as a cost control, not just a UX one.
- **Meta's Jan-2026 general-purpose-chatbot policy** is a genuine compliance risk for the literal "give its opinion on anything it's watching" framing in the base ask — FR11's topic fence needs to be enforced, not aspirational.
- **Unconfirmed mention-detection payload shape** (§2.1) — the first thing that could quietly break the whole @-mention path; retire in Phase 0 before writing detection code against an assumption.
- **One Cloud API business per group** — a non-issue for one tenant's one group; flag if this pattern is expected to multiply across tenants.

---

## 8. Phased plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **0a — Cloud API mechanics spike** | Two sub-steps, both with **zero dependency on a verified business account**: (i) fixture-based tests against `extensions/whatsapp/routes.py` with synthetic webhook payloads — no Meta account at all, same pattern as `tests/test_amazon_routes.py` (bare Flask app + blueprint, no live DB/Rasa); (ii) once that's solid, Meta's free test WABA + test number (auto-created when the WhatsApp product is added to any free personal Meta Developer app — no business verification, up to 5 OTP-verified test recipients, 24h temp token) to prove the real round-trip. | Basic inbound/outbound plumbing proven offline, then against a real (unverified) test number — both ahead of and independent of OBA approval. Can start today. |
| **0b — Groups API confirm** | Meta's Groups API sandbox still gates on OBA (§1.1) — there's no waived test mode for groups specifically. This step is blocked on OBA approval landing, not just "spin up a sandbox group" as originally scoped. Once OBA clears: confirm mention payload shape, group-vs-1:1 windowing rules, live webhook shapes. | A live group (business number + 2 real numbers) on an approved OBA, one confirmed real @-mention payload sample. |
| **1 — Observe + @mention respond** | `group_routes.py` webhook receiver; ingest into the unified conversation model (`whatsapp_group`, FR5); always-respond-on-mention wired into the existing action-server brain (KB search, ticket status — reuse, no new brain); known-participant identity mapping (FR6); mandatory disclosure/opt-out (FR10). | Baseline requirement (FR1–FR3) working end to end for a real small group. |
| **2 — Proactive judgment layer** | The ambient-relevance classifier (§4.2 step 2), per-group cooldown + tenant proactivity dial (FR8), topic-fence enforcement (FR11). This is the phase that actually delivers FR4. | Every speak/skip decision logged for review; ships at the most conservative proactivity setting first, dialed up manually only after review. |
| **3 — Tool-use in-group** | Ticket creation from a group message, SLA/project status pulls, escalation-equivalent flagging (FR7, FR9). | Bot can *act*, not just answer, inside the group. |
| **4 — Hardening** | Rate-limit/abuse scoping matching the existing WhatsApp risk note ([[project_channels_deferred]]); precision review of proactive replies (did people actually want them?); a cost dashboard tied to Meta's per-message billing. | Feature is safe to leave running unattended. |

---

## 9. Decisions needed from you

1. **Who are the "few real numbers"** — internal team, external stakeholders, or a mix? This changes the identity-mapping approach (FR6) and the disclosure requirement (FR10).
2. **Proactivity default** — start Phase 2 at @mention-only and dial up manually, or ship a "light-proactive" default from day one? Given the stacked cost/spam/compliance risk in §7, the recommendation is the former.
3. **`ExtensionKind.CHANNEL` vs. reusing an existing kind** — same cosmetic question flagged in the sibling plan, now with a second concrete consumer.
4. **OK to start the Phase 0 spike** (sandbox group, no production numbers, no real customers) before committing to full Phase 1 scope?

---

## 10. Sources

- [Official Business Accounts — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts/)
- [Official Business Account (OBA) or blue badge — 360dialog docs](https://docs.360dialog.com/docs/waba-management/official-business-account)
- [WhatsApp API Prerequisites: Phone, Documents, and Verification — Wati](https://www.wati.io/en/blog/whatsapp-api-prerequisites/)
- [Business phone numbers — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers)
- [Groups API — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups)
- [Group messaging — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/)
- [WhatsApp Group API 2026: Limits, Endpoints & Alternatives — Unipile](https://www.unipile.com/whatsapp-group-api/)
- [WhatsApp Groups API: The 2026 Business Guide — imBee](https://www.imbee.io/resource/whatsapp-groups-api-business-guide-2026)
- [WhatsApp Bot Banned in 2026? 12 Fixes from 50+ Cases — Achiya](https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/)
- [Why Cheap WhatsApp Bots Get Your Number Banned — SporeSec](https://sporesec.com/en/blog/whatsapp-unofficial-api-ban-risk)
- [Meta Blocks Third-Party AI Chatbots on WhatsApp in 2026 — Chatboq](https://chatboq.com/blogs/third-party-ai-chatbots-ban)
- [WhatsApp Automation Ban Risk — Kraya AI](https://blog.kraya-ai.com/whatsapp-automation-ban-risk)
- [AI Agents for WhatsApp & Social Media Automation in 2026 — Anvenssa](https://www.anvenssa.com/blog/ai-agents-for-whatsapp-social-media-automation-in-2026/)
- [The 8 Best Slack AI Integration Tools in 2026 — ClearFeed](https://clearfeed.ai/blogs/slack-ai-integration-tools)
- Prior decision record: `docs/Backup/P3_IMPLEMENTATION_PLANS.md` §"Decision record — #4 inbound channels"
- Sibling plan: `docs/plans/WHATSAPP_INTEGRATION_PLAN.md`

---

## Changelog

- 2026-08-24 — Phase 0a implemented on `V3-WhatsApp`: `extensions/whatsapp/` (extension.py, routes.py, service.py, decision.py, identity.py, bridge.py, store.py), `ExtensionKind.CHANNEL` added, `[WHATSAPP]` config section (disabled by default), fixture/unit tests (`tests/test_whatsapp_routes.py`, `tests/test_whatsapp_decision.py`, 25 tests, zero live-account dependency). Covers baseline FR1–FR3/FR5/FR6/FR8/FR10/FR11 and an initial (heuristic, not yet KB/LLM-backed) version of FR4's proactive decision engine. Does NOT cover FR7 (tool-use), FR9 (escalation), real group-management calls (create/invite/approve — written but unconfirmed), or the 24h-window/template branch — those, plus confirming the mention-payload and group-id extraction shapes this build guesses at (§2.1), wait on Phase 0b's real Meta credentials.
- 2026-08-21 — Initial version: use case analysis, Groups API research, requirements (FR1–FR11), architecture, phased plan, open decisions.
- 2026-08-21 — Added §1.1 account prerequisites (Tier 1 WABA vs Tier 2 OBA); flagged OBA's "notability" (unpaid media coverage) requirement as the top risk, ahead of everything else in §7 — it's the one gate not fully in 99T's control.
- 2026-08-21 — Confirmed no sandbox exists yet (repo has zero WhatsApp scaffolding). Corrected Phase 0: Meta's Groups API sandbox does not waive the OBA gate, so it splits into 0a (Cloud API mechanics, OBA-independent) and 0b (actual group testing, blocked on OBA). Flagged third-party "OBA-free Groups API sandbox" vendors as the unofficial-automation route in disguise, not a real shortcut.
- 2026-08-22 — Confirmed Phase 0a needs zero verified-business dependency: fixture-based tests against the extension's routes (no Meta account, mirrors `tests/test_amazon_routes.py`'s pattern) can start immediately, followed by Meta's free unverified test-WABA/test-number for a real round-trip. Only Phase 0b (anything group-specific) stays gated on OBA.
