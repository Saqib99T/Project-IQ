# Gorgias vs. Project IQ — Detailed Feature Comparison

**Prepared:** 2026-07-31 (updated with Helpdesk product analysis)
**Sources:**
- [gorgias.com/ai-agent](https://www.gorgias.com/ai-agent) — main product page (dual agent modes, onboard/automate/analyze/optimize lifecycle, tech stack, integrations)
- [gorgias.com/ai-agent/support-skills](https://www.gorgias.com/ai-agent/support-skills) — skill framework (Triage/Empathize/Resolve/Retain)
- [docs.gorgias.com — How Gorgias's AI Agent works](https://docs.gorgias.com/en-US/how-gorgiass-ai-agent-works-1997817) — internal decision workflow, guardrails, escalation triggers
- [gorgias.com/products/helpdesk](https://www.gorgias.com/products/helpdesk) — core ticketing/helpdesk product (Views, Macros, Rules, multi-brand, permissions, SLA)
- Web search across third-party reviews for channel/pricing/permissions/multi-brand details (myaskai.com, gorgias.com/pricing, eesel.ai, gorgias.com/product/rules) — used only for corroboration/gap-filling, not as primary feature sources
- Project IQ: current repo state (chatbot + ITSM service + portal/admin), [docs/Backup/FEATURES.md](Backup/FEATURES.md), [docs/itsm-design/](itsm-design/)

This doc covers Gorgias as two products, since that's how Gorgias itself sells it: **Part A** is the AI Agent (the LLM layer), **Part B** is the Helpdesk (the underlying ticketing platform the AI Agent sits on top of). Project IQ is architecturally closer to Part B (it's a full ITSM ticketing platform) with a Rasa-based bot layered on top (roughly Part A's role) — so splitting the comparison this way is more apples-to-apples than treating Gorgias as one monolithic product.

**Legend:**
- **Match** — how close Project IQ's current capability is to Gorgias's, on that specific feature (rough %, not precise). `N/A` = not a meaningful comparison (different domain, or one side clearly has no equivalent concept).
- **Effort to Close Gap** — `Easy` (days, config/reporting work) · `Medium` (1–4 weeks, new code but fits existing architecture) · `Hard` (new subsystem/architecture shift) · `N/A` (already at parity/exceeds, or not applicable).

---

# Part A: AI Agent

## 1. Conversational AI Core & Reasoning Engine

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Underlying model | LLM (OpenAI partnership) + proprietary ecommerce prompt engineering | Rasa NLU (DIET classifier) + rule/policy engine, no generative LLM in the reply path | ~30% | Hard | Fundamentally different paradigm — classify-and-template vs. generate. Closing this means adding an LLM layer, not tuning the existing model |
| Chaining/orchestration for complex queries | Yes — model can chain reasoning steps across knowledge + actions | `ActionHandleMultiIntent` queues and sequences multiple actions from one message | ~50% | Medium | Project IQ handles multi-intent sequencing procedurally; Gorgias does it via LLM planning. Rasa's approach is more rigid but already covers the common cases |
| "Am I ready to reply yet?" iterative task loop | Yes — keeps performing parallel tasks until request is fully satisfied | No equivalent — actions either complete or fall back/escalate in one pass | ~15% | Hard | Needs an orchestration/planning layer on top of the action server |
| Grounding / anti-hallucination check (second-model confidence gate before sending) | Yes — dedicated QA pass on generated replies | N/A — no generative text to hallucinate; template responses are inherently "grounded" by construction | N/A | N/A | Different risk profile: Project IQ can't hallucinate free text, but also can't phrase novel answers |
| Confidence-threshold gating on classification | Implied as part of QA pass | Yes — `FallbackClassifier` threshold routes low-confidence input to fallback/clarification | ~70% | Easy | Conceptually the same gating pattern, just applied to intent confidence rather than generated-response confidence |

## 2. Engagement / Agent Modes

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Support Agent mode (post-purchase / reactive support) | Yes — order tracking, returns, FAQ, subscriptions, refunds | Yes — ticket lifecycle (create/status/update/verify resolution), KB Q&A | ~85% | Easy–Medium | Direct conceptual match once "order" is swapped for "ticket" |
| Shopping Assistant mode (pre-purchase / proactive sales) | Yes — product discovery, recommendations, upsells/discounts from live inventory | No equivalent | N/A | N/A | No "pre-purchase" concept in an internal helpdesk |
| Proactive self-service before commitment | Upsell/discount surfaced proactively during browsing | KB deflection (`ActionSearchKbBeforeTicket`) surfaces a likely answer before a ticket is created | ~60% (as a *pattern*, not the same goal) | N/A | Loosely analogous mechanism (proactive suggestion before the "default" action), different intent (self-serve vs. sell) |

## 3. Automation & Actions

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| End-to-end conversation automation rate | ~60% of conversations resolved with no human | Not currently measured as a headline % (data exists, not surfaced) | ~20% (measurement gap, not necessarily capability gap) | Easy | Compute from existing `feedback`/`actions` tables |
| Executing actions in connected systems (refunds, subscription edits, shipping updates) | Yes, via 100+ app integrations | Yes, via custom actions against the ITSM backend API (ticket CRUD, status/priority changes) | ~70% | Easy–Medium | Same mechanism (action server calling backend APIs); breadth of *which* actions exist depends on backend endpoints built out |
| Conditional/SOP-driven logic ("Guidance documents") | Yes — brand-authored conditional rules interpreted by the LLM | Yes — `RulePolicy` encodes hard business logic (e.g. "always confirm before submitting") | ~65% | Medium | Rasa rules are more rigid (must be authored per-case) vs. Gorgias's LLM interpreting free-form guidance text |
| File/attachment handling in automated flow | Not detailed | Yes — `action_upload_file`, drag-and-drop attachments | Comparable | N/A | No indication Gorgias's page differentiates here |

## 4. Personalization & Data Access

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Real-time backend data lookups | Order history, inventory, customer tags from Shopify | Ticket/asset/user data via ITSM API, scoped by IAM identity | ~75% | Easy | Same mechanism, different data domain |
| Customer-tag-based personalization | Yes — real-time tag application in replies | Not tag-based; role/department context via IAM instead | ~40% | Medium | Would need a tagging layer on user/ticket records surfaced into reply logic |
| Shopping-history-context in replies | Yes | N/A (no purchase history concept) | N/A | N/A | Domain mismatch |

## 5. Channels

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Web chat widget | Yes (embedded/helpdesk) | Yes — embeddable chat widget | 100% | N/A | Parity |
| Native mobile app | Not mentioned | Yes — Expo app (iOS/Android) | Exceeds | N/A | Project IQ advantage |
| Email | Yes | No | 0% | Medium | Needs inbound email ingestion/threading into existing conversation model |
| SMS | Yes (add-on pricing) | No (explicitly deferred pending demand) | 0% | Medium | Needs SMS gateway integration |
| Voice (phone) | Yes (newest, least-proven surface per third-party reviews) | Experimental TTS/STT inside the web widget only — no phone/telephony channel | ~10% | Hard | Real inbound telephony is a distinct subsystem; note even Gorgias's own voice channel is described as its least mature |
| Vision / image understanding | Yes, but documented as email-only, not chat | No AI-driven image understanding (file upload exists, but not analyzed) | ~5% | Hard | Would need an image-understanding model in the pipeline |
| Slack / Teams / WhatsApp | Not mentioned | Deferred pending demand (design exists, reusable-core planned) | N/A | Medium (already scoped) | Not a Gorgias feature either, so not a gap — but flagged since it's a known backlog item |

## 6. Knowledge Base, Training & Onboarding

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Connect knowledge sources (help center, store data, docs) | Yes — help center, Shopify, third-party apps, uploaded docs | Yes — ITSM KB sync (auto-refresh), local JSON fallback | ~75% | Easy | Comparable breadth of sources; Gorgias adds live commerce-platform data which has no ITSM equivalent needed |
| Hybrid retrieval (semantic + keyword) | Implied ("interprets knowledge") but not detailed as hybrid | Yes — explicit 60/40 weighted semantic+keyword scoring | ~85% (Project IQ is more explicit here) | N/A | Project IQ's retrieval method is actually better-documented/tunable |
| KB health/gap identification | Covered under "Analyze phase" (gap identification) | Yes — dedicated KB health/gaps dashboard | Comparable | N/A | Parity |
| Brand-voice / SOP authoring during onboarding | Yes — "deep SOP and brand voice customization" | Partial — Rasa domain/rules/stories authored via AI Studio, but no "brand voice" text-tone layer | ~40% | Hard | Structural rule authoring exists; tone-layer authoring does not (ties back to §1's LLM gap) |

## 7. Guardrails, Trust & Security

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Inbound request security screening (malicious activity, phishing, spam, prompt-injection-style detection) | Yes — explicit first step in the decision workflow | Not found — no dedicated inbound content-moderation/security-screening layer identified in the codebase | ~10% | Medium | Rasa's fixed intent set naturally limits attack surface vs. an open LLM, but there's no explicit screening step to point to |
| Topic exclusion / mandatory-handoff rules | Yes — topics can be marked excluded or handoff-only | Partial — `check_user_login` auth guardrails restrict protected actions; no general-purpose "excluded topic" config surfaced in admin UI | ~40% | Medium | Would need an admin-configurable exclusion-topic list feeding the routing rules |
| Zero data retention / no third-party LLM training on customer data | Yes (stated policy) | Exceeds by construction — no data ever leaves the self-hosted stack, no third-party LLM in the loop at all | Exceeds | N/A | Self-hosting is inherently stronger here than "we promise not to train on your data" |
| Secret management | Not detailed | Infisical-managed secrets, environment isolation (dev/prod) | Likely exceeds (documented) | N/A | Explicit and auditable in Project IQ |
| PII encryption | "Industry-leading protection" (unspecified) | Not confirmed as field-level encryption at rest — grep found no dedicated PII-encryption module | Unknown/~30% | Medium | Would need to confirm/implement at-rest encryption for sensitive fields specifically (beyond transport TLS + secret management) |

## 8. Human Escalation & Handoff

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Escalation on low confidence / can't-ground / excluded topic / safety fail | Yes — four explicit triggers | Yes — fallback classifier + KB-not-helpful escalation + auth guardrails cover equivalent triggers (no explicit "safety fail" trigger) | ~70% | Easy–Medium | Mechanism exists; the "security/safety fail" trigger specifically maps back to the §7 gap |
| Real-time handoff to a human agent | Yes — permission/urgency-based routing | Yes — socket-relay handoff, identity-pinned sessions, routing-rules UI | Exceeds | N/A | Project IQ's live-relay handoff is more concretely described than what Gorgias's page details |
| Operator co-pilot (assisted replies for the human agent) | "Suggested replies and tagging" (assistive features, per third-party review) | Bot-reply draft + canned responses/macros for the operator console | Comparable | N/A | Parity — both give the human agent a head start rather than a blank box |

## 9. QA, Explainability & Debugging

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| "View reasoning behind every AI response" (per-conversation explainability for CX teams) | Yes | Partial — Conversation Inspector gives turn-by-turn replay, slot state, and flow tracing, but it's an admin/dev tool, not a lightweight per-message "why did it say this" view for CX staff | ~50% | Medium | The underlying data (why a rule/fallback fired) already exists; needs a simpler surfaced view for non-technical reviewers |
| Live NLU/response testing sandbox | Not detailed publicly | Yes — Interactive Chat Tester with live NLU confidence/entity view | Comparable or exceeds | N/A | Project IQ's studio tooling is more developer-facing and transparent overall |
| Rule/story/domain validation tooling | Not detailed publicly | Yes — Intent/Domain/Rule validators with impact analysis | Exceeds | N/A | Project IQ advantage (self-hosted stack requires this, Gorgias hides it) |

## 10. Continuous Optimization / Feedback Loop

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Instant behavior update from a single thumbs-up/down | Yes — "instant behavior updates via feedback" | No — feedback (1–5 star rating) is stored for analytics but doesn't instantly alter bot behavior; behavior changes require retraining | ~20% | Hard | Real-time online-learning from feedback is a different architecture than batch retrain of a Rasa model |
| Auto-QA process for response refinement | Yes | No automated refinement loop — training/versioning is manual (one-click, but human-triggered) | ~15% | Hard | Would need an automated pipeline that consumes feedback and retrains/adjusts without a human pulling the trigger |
| Model version history + rollback | Not detailed | Yes — explicit version control with rollback | Exceeds | N/A | Project IQ advantage |

## 11. Analytics & Reporting

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Per-intent performance monitoring | Yes | Yes — intent distribution analytics | Comparable | N/A | Parity |
| Sentiment tracking | Yes | Yes — sentiment analysis on feedback | Comparable | N/A | Parity |
| Resolution rate / success metrics | Yes | Yes — ticket resolution rate tracked from feedback | Comparable | N/A | Parity |
| Conversion-rate analytics | Yes (ecommerce-specific) | N/A | N/A | N/A | Domain mismatch |
| Published headline automation/cost metrics (60% automation, <1 min resolution, 50% cost cut) | Yes — marketed prominently | No headline metric published; raw data exists | ~20% | Easy | Reporting/marketing task, not new instrumentation |
| Deep filtering + export (date/app/status, full-text search, CSV export) | Not detailed at this granularity | Yes — extensive filter set + export for compliance | Exceeds | N/A | Project IQ advantage |

## 12. Admin & Customization (of the platform itself)

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| No-code widget theming | Not detailed | Yes — theme builder, dark-mode generator, 8 presets | Exceeds | N/A | Project IQ advantage |
| Full NLU/dialogue authoring (intents, stories, rules, domain, forms) | Hidden behind managed product | Yes — complete AI Studio suite with visual flow builder | Exceeds | N/A | Self-hosted stack requires (and provides) this; Gorgias is a black box by design |
| Hot-swappable config (URLs/keys) without restart | Not detailed | Yes — Config Manager | Exceeds | N/A | Project IQ advantage |

## 13. Integrations

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Breadth of third-party integrations | 100+ ecommerce tools (Shopify, BigCommerce, Magento, WooCommerce, Loop Returns, Yotpo, Recharge, Klaviyo, Attentive, Triple Whale, etc.) | Own ITSM backend + IAM/Keycloak; no ecommerce-adjacent integrations needed | N/A | N/A | Different integration surface entirely — not a fair one-to-one gap |
| Identity/SSO integration | Not the focus of their integrations | Keycloak-based enterprise SSO, webhook-based tenant provisioning | Exceeds (for its domain) | N/A | Project IQ's integration depth is in enterprise identity, not commerce apps |

## 14. Multi-tenancy & Identity

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Multi-tenant model | Per-store SaaS account | Full multi-tenant IAM SSO, webhook tenant provisioning, RBAC, product-scoped sessions | Exceeds | N/A | Enterprise-grade vs. per-store SaaS — different tiers of tenancy sophistication |

---

## Category-Level Rollup

| # | Category | Overall Match | Overall Effort to Close | Verdict |
|---|---|---|---|---|
| 1 | Conversational AI Core & Reasoning | ~35% | Hard | Biggest structural gap — needs an LLM layer |
| 2 | Engagement / Agent Modes | ~70% (support only) | N/A for sales mode | Support mode solid; no sales-mode equivalent needed |
| 3 | Automation & Actions | ~65% | Easy–Medium | Mechanism exists; needs more actions + a published metric |
| 4 | Personalization & Data Access | ~60% | Easy–Medium | Solid foundation, tags/history layer would help |
| 5 | Channels | ~35% | Medium–Hard | Web+mobile strong; email/SMS/voice/vision are gaps |
| 6 | Knowledge, Training & Onboarding | ~70% | Easy–Hard (varies) | Retrieval strong; brand-voice authoring is the weak spot |
| 7 | Guardrails, Trust & Security | ~40% (but exceeds on data retention) | Medium | Security-screening and exclusion-topic config are the real gaps |
| 8 | Human Escalation & Handoff | Exceeds | N/A | Project IQ strength |
| 9 | QA, Explainability & Debugging | ~65% (exceeds for devs, lags for CX-facing explainability) | Medium | Strong dev tooling; needs a simpler CX-facing "why" view |
| 10 | Continuous Optimization / Feedback Loop | ~20% | Hard | Biggest process gap — no auto-retrain/instant-update loop |
| 11 | Analytics & Reporting | Exceeds (granularity), lags (headline metrics) | Easy | Just needs a marketing-style rollup metric |
| 12 | Admin & Customization | Exceeds | N/A | Project IQ strength |
| 13 | Integrations | N/A (different surface) | N/A | Not comparable |
| 14 | Multi-tenancy & Identity | Exceeds | N/A | Project IQ strength |

## Bottom Line

Breaking this down further confirms the same two structural gaps as before, now with more precision:

1. **No generative LLM in the reply/reasoning path** (Category 1, 6, 10) — this is what actually drives Gorgias's tone/empathy, iterative task-planning, brand-voice authoring, and instant-feedback optimization loop. It's one root cause showing up in three categories, and it's the highest-leverage (and hardest) thing to close.
2. **Channel and trust/security surface area** (Category 5, 7) — email/SMS/voice/vision channels, plus an explicit inbound security-screening step and admin-configurable topic exclusions, are concrete, scoped gaps that don't require an architecture change (except voice/vision, which do).

Everywhere the comparison is about **platform depth and control** rather than generative AI (handoff, admin/studio tooling, analytics granularity, multi-tenancy, explainability for developers), Project IQ already matches or exceeds Gorgias — which tracks with it being a self-owned, self-hosted stack instead of a managed SaaS product.

---

# Part B: Helpdesk — Core Ticketing Platform

This is Gorgias's base product (the AI Agent in Part A is an add-on layer on top of it). Project IQ's ITSM service is itself a full ticketing platform, so this section is closer to a like-for-like comparison than Part A was.

## 15. Centralized Inbox / Omnichannel Ticketing

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Unified ticket view across all channels | Yes — "one inbox for every conversation" across email/chat/SMS/voice/social | Yes — centralized ticket queue in the ITSM portal/admin across app/department scope | ~50% | Medium | Aggregation mechanics are equivalent; the limiting factor is channel breadth (web+mobile only today), which is the same gap already tracked in Part A §5 |

## 16. Views (Custom Saved Queues)

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Custom ticket queues by brand/channel/agent, saved and reusable | Yes — "Views" | Partial — admin analytics already supports filtering by date range/App ID/status/full-text; no confirmed "save this filter as a reusable named view" layer | ~50% | Easy–Medium | The filtering engine already exists; a saved-view/preset UI on top of it is a thin feature, not new infrastructure |

## 17. Macros (Canned Responses)

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Pre-made response snippets, inserted via shortcut/button to speed up agent replies | Yes — "Macros" | Yes — canned responses/macros already built into the operator co-pilot console | ~90% | N/A | Direct existing match — this was already built for the human-handoff operator experience |

## 18. Rules Engine (Automation, Auto-tag, Auto-reply, Sentiment/Value Triggers)

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| No-code rules: auto-tag, auto-reply, auto-view-assignment triggered by message text, sentiment, or even purchase amount | Yes — "Rules" | Partial — routing rules (handoff routing UI) and SLA auto-escalation rules cover condition-triggered actions; no confirmed generalized no-code auto-tag/auto-reply/sentiment-value rule builder for tickets specifically | ~45% | Medium | The trigger-and-act pattern already exists in two places (routing, SLA escalation); generalizing it into one configurable ticket-rules engine with sentiment/value conditions is new admin-surface work, not new architecture |

## 19. Multi-Brand Support

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Separate macros/rules/views per brand within one account, switchable by agents | Yes | Partial-to-strong — multi-tenant IAM with product-scoped sessions gives full data isolation per tenant/department (the historical IT-vs-HR entity-context pattern is conceptually the same idea) | ~70% | Easy–Medium | Project IQ's isolation model is architecturally stronger (separate IAM-scoped tenants/products vs. one account juggling brands), but formalizing per-brand macro/rule *sets* specifically would need a thin config layer |

## 20. Team Collaboration, Roles & Permissions

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Tiered roles (Admin/Team Lead/Agent) controlling access to billing, users, integrations, rules, ticket data | Yes | Yes — Keycloak-based IAM RBAC (org_admin = tenant admin, operator→agent role mapping) | Exceeds | N/A | Enterprise SSO/IAM-backed RBAC is more rigorous than Gorgias's helpdesk-internal role tiers |
| Internal notes on tickets | Yes | Yes — standard ITSM ticket commenting/internal-note capability | Comparable | N/A | Parity — a baseline ITSM feature |

## 21. SLA & Performance Analytics (Helpdesk-level)

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| SLA tracking, response-time analytics dashboard | Yes | Yes — but Project IQ's is a dedicated SLA/SLO module (auto-escalation, alert inbox, on-call/SRE scheduling), not just a dashboard | Exceeds | N/A | Already a documented Project IQ strength (Part A §8 territory) |

## 22. Reported Efficiency Metrics

| Feature | Gorgias | Project IQ | Match | Effort | Why |
|---|---|---|---|---|---|
| Published benchmarks (43% faster first response, ~30% labor cost reduction) | Yes — marketed prominently | No — raw data (resolution rate, feedback ratings) exists but no headline efficiency metric is computed/published | ~20% | Easy | Same measurement gap as Part A §11 — a reporting task, not a missing capability |

---

## Part B Rollup

| # | Category | Overall Match | Overall Effort to Close | Verdict |
|---|---|---|---|---|
| 15 | Centralized Inbox / Omnichannel | ~50% | Medium | Ticketing mechanics fine; channel breadth is the gap (shared with Part A §5) |
| 16 | Views (Saved Queues) | ~50% | Easy–Medium | Filtering exists; saved/named views don't yet |
| 17 | Macros | ~90% | N/A | Already built |
| 18 | Rules Engine | ~45% | Medium | Point solutions exist (routing, SLA); no unified no-code rules builder |
| 19 | Multi-Brand Support | ~70% | Easy–Medium | Stronger isolation model, needs a config layer for per-brand macro/rule sets |
| 20 | Team Collaboration & Permissions | Exceeds | N/A | Project IQ strength |
| 21 | SLA & Performance Analytics | Exceeds | N/A | Project IQ strength |
| 22 | Reported Efficiency Metrics | ~20% | Easy | Reporting/marketing gap only |

## Part B Bottom Line

Project IQ already covers most of what Gorgias's *base* Helpdesk product does — which makes sense, since Project IQ was built ITSM-native (ticketing, SLA, RBAC are the core product, not an add-on), whereas Gorgias's Helpdesk is comparatively lighter-weight ecommerce-support tooling that its AI Agent sits on top of. The two real gaps are: (1) a **unified no-code rules engine** for ticket-level automation (auto-tag/auto-reply/sentiment-or-value triggers) — Project IQ has the equivalent logic scattered across routing rules and SLA escalation rather than one configurable builder, and (2) **saved/named Views** as a thin layer over the filtering that already exists. Both are Easy–Medium admin-surface work, not architecture changes — a very different risk profile than Part A's LLM-dependent gaps.

---

# Overall Bottom Line (Both Parts)

Put together, the two parts tell a consistent story: **the ticketing/ITSM foundation (Part B) is where Project IQ is strongest relative to Gorgias — often exceeding it — while the AI layer on top (Part A) is where the gaps concentrate**, specifically around generative-LLM-dependent behavior (tone, iterative reasoning, brand-voice authoring, instant feedback-driven optimization) and channel/security surface area (email/SMS/voice/vision, inbound content screening). If prioritizing where to invest, the highest-leverage move is still the LLM-generation layer from Part A, since it would also strengthen several Part B gaps in passing (a rules engine driven by an LLM interpreting plain-language guidance, for instance, is a more natural fit than hand-authoring rule conditions one at a time).
