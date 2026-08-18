# Amazon (Selling Partner API) Integration — Strategy & Architecture Plan

Status: **planning only — no implementation**
Companion to: `docs/SHOPIFY_INTEGRATION_PLAN.md` (same feature scope — order status, refund, cancel, shipping-address update — different platform, materially different constraints)

---

## 0. Executive Summary

The ask: build the same customer-support-agent capability set already shipped for Shopify (order lookup, refund, cancel, shipping-address update, confirmation guardrails, audit trail), but for Amazon sellers, and make both platforms coexist behind a per-tenant on/off configuration rather than assuming every tenant is a Shopify merchant.

The research finding that should set expectations up front: **Amazon's Selling Partner API (SP-API) is architecturally quite different from Shopify's Admin GraphQL API, in ways that directly affect scope, timeline, and which features are even possible via API at all** (§1-§2). Where the Shopify build's hard problems were *runtime quirks discovered through live testing* (idempotency keys, kind-vocabulary mismatches, full-replace semantics — all solvable in days), several of Amazon's hard problems are *structural and external* — an app-approval process with real lead time, and an Orders API that is read-mostly by design, with writes routed through an asynchronous feed-submission model instead of direct mutations. This plan is written to surface those differences early rather than discover them mid-build.

This plan also defines the **multi-provider configuration layer** (§4) the user asked for explicitly: a per-tenant setting for which commerce platform(s) are active, and a shared abstraction so the bot's `check_order_status`/`request_refund`/etc. intents dispatch to whichever provider(s) a given tenant has enabled, instead of being hardwired to Shopify.

---

## 1. Why Amazon Is a Structurally Different Integration, Not "Shopify With Different Field Names"

| Dimension | Shopify (as built) | Amazon SP-API | Why it matters |
|---|---|---|---|
| **Auth mechanism** | Standard OAuth 2.0 authorization-code grant, `expiring=1` offline tokens, refresh_token rotation | OAuth-like "Login with Amazon" (LWA) — **as of Oct 2023, AWS IAM role assumption + SigV4 request signing is no longer required**; a plain LWA bearer access token is enough per request | Simpler than legacy assumptions might suggest — this is genuinely comparable in complexity to the Shopify OAuth flow already built, once this is confirmed against a real sandbox. |
| **Multi-tenant app approval** | "Custom app," unlisted, no formal review needed for a dev store; only *Protected Customer Data* field-group approvals were required, and those were self-service in the Partner Dashboard | Two separate registration paths exist, easy to conflate: registering via **Seller Central → Develop Apps** requires the registrant to *be* a Professional Seller ($39.99/mo) — that's the wrong path for us. Registering via the **Solution Provider Portal** (the correct path for a third-party ISV building for *other* sellers) requires **no Professional Seller account at all**, and a **sandbox app** can be created there immediately — real LWA credentials, no seller authorization needed — while the fuller **Public Developer** application (Amazon-reviewed, required before real sellers can install the app, plus a mandatory **Selling Partner Appstore** listing) proceeds in parallel | Corrected from an earlier draft of this plan: no Professional Seller cost or blocker for *us* to register and start sandbox validation. The Public Developer review (needed before other sellers can connect) is still a real external process with unknown lead time — start it immediately, in parallel with engineering, so it doesn't become the critical path. |
| **Order writes (cancel/refund)** | Direct, synchronous GraphQL mutations: `orderCancel`, `refundCreate` | The Orders API v0 is **read-mostly**: `getOrders`, `getOrder`, `getOrderItems`, `getOrderAddress`, `getOrderBuyerInfo`, and one write op, `updateShipmentStatus`. **There is no direct `cancelOrder` or `refundOrder` endpoint.** Cancellation/refund-adjustment actions are instead submitted as asynchronous **feed documents** via the Feeds API (submit → Amazon processes → poll for a result), not an instant request/response call. | This is the single biggest scope difference. A "confirm, then execute" Rasa flow that expects an immediate success/failure (as built for Shopify) needs to become "confirm, submit, then poll/notify" for Amazon — a different UX shape, not just a different API call. |
| **FBA vs FBM fulfillment split** | N/A — Shopify doesn't have this distinction; the merchant always controls fulfillment | **Fulfilled-by-Amazon (FBA)** orders are largely out of the seller's direct operational control once they reach an Amazon fulfillment center — cancellation may only be honored if the order is still in `Pending` status, and Amazon's own FC process governs after that. **Fulfilled-by-Merchant (FBM)** orders behave more like Shopify's model, since the seller's own systems (or, here, our integration) drive fulfillment directly. | The plan must scope FBM as the primary supported case and treat FBA cancel/refund as best-effort/status-only until validated against a real seller sandbox account of both types. |
| **Order-event notifications** | Standard HTTPS webhook (`shopify.app.toml` declarative subscriptions, HMAC-verified POST to our own endpoint) | The **Notifications API** delivers events via an **AWS SQS queue** (optionally EventBridge) that the integrator provisions and consumes — not an inbound HTTP endpoint at all | Needs an SQS consumer process (new infra pattern for this repo), not a Flask route — architecturally closer to the "background job" gap already flagged in the KB/RAG plan (`docs/KB_WIKI_CURATION_RAG_PLAN.md` §1.7) than to the Shopify webhook receiver. |
| **Rate limiting** | Cost-based budget shared across a shop's GraphQL calls | Token-bucket **per individual operation** (each endpoint has its own requests/second + burst allowance) | Conceptually similar (both need budget-aware client code) but modeled per-endpoint rather than per-shop-wide-budget — the existing `_check_write_rate_limit` pattern in `shopify_service.py` needs per-operation granularity for Amazon, not a straight port. |

**Bottom line**: expect this integration to take meaningfully longer than Shopify's did, for reasons that are mostly *external* (Amazon's approval process, feed-based async writes needing a poll/notify UX) rather than *internal engineering difficulty* — the actual API-calling code is not harder to write than the Shopify service was.

---

## 2. SP-API Primer (grounding for the rest of this plan)

- **Authentication**: Register the app via the **Solution Provider Portal** (not Seller Central's "Develop Apps" — that path is for a seller building a private app for their own store, and requires a Professional Seller account; the Solution Provider Portal is the correct path for a third-party ISV like Project IQ and requires no seller account of its own), get a LWA `client_id`/`client_secret`. A seller authorizes via an OAuth-like consent flow, returning an authorization code exchanged for LWA `access_token`/`refresh_token`. Every SP-API request just needs `Authorization: Bearer <access_token>` — no request signing (confirmed: SigV4/IAM requirement was dropped SP-API-wide as of October 2, 2023). This closely mirrors the Shopify OAuth pattern already built (`web/api/blueprints/bp_shopify.py`), so the OAuth-connect/callback/token-refresh code shape can likely be reused almost as-is.
- **App registration tiers**: A **sandbox application**, registered in the Solution Provider Portal, gives working LWA credentials immediately — no seller authorization needed, no cost, usable right away for Phase 0's validation spike, even while the fuller application below is under review. Letting **real, other sellers** connect for real (not just sandbox dummy data) requires registering as a **Public Developer** — an Amazon-reviewed application (org details, data-access justification, security posture) plus a requirement to list the app in the **Selling Partner Appstore** under the Solution Provider Agreement. Treat this application as Phase 1, started immediately and in parallel with engineering, given unknown external review lead time — it does not block Phase 0's sandbox work from starting today.
- **Orders API v0** — read surface: `getOrders`, `getOrder`, `getOrderAddress`, `getOrderBuyerInfo`, `getOrderItems`, `getOrderItemsBuyerInfo`, `getOrderRegulatedInfo`/`updateVerificationStatus` (regulated-product compliance flows), and `updateShipmentStatus` — the one direct write op, for confirming shipment (an FBM seller telling Amazon "this shipped"), not for cancellation or refunds.
- **Feeds API** — the write mechanism for order lifecycle changes: submit a feed document (a specific feed-type payload, e.g. order-acknowledgement/fulfillment data), Amazon processes it asynchronously, and the integrator polls a feed-processing-report endpoint (or is notified via the Notifications API) for the result. A feed type for refund/financial adjustment is documented to exist in principle ("issues a refund adjustment for an order") but **its exact schema, required fields, and behavior for different order/payment types were not confirmed from documentation alone** in this research pass — this needs to be validated against Amazon's sandbox environment before committing to an implementation design, exactly the way the Shopify build's refund mechanics (idempotency key, transaction shape, `kind` vocabulary) were only nailed down through live testing, not docs (`docs/SHOPIFY_INTEGRATION_PLAN.md` §6b).
- **Notifications API**: subscribe to event types (e.g. order status changed) which Amazon then delivers onto an SQS queue you provision (or an EventBridge bus). Requires standing up an SQS consumer — a new infrastructure pattern for this repo, and one that should probably be built on the same background-worker infrastructure recommended for the KB/RAG plan's LangGraph orchestrator (`docs/KB_WIKI_CURATION_RAG_PLAN.md` §4.10), rather than a second bespoke async system.
- **Rate limiting**: each operation publishes its own steady-state rate + burst (token bucket), visible in the API's `x-amzn-RateLimit-Limit` response header — the equivalent of Shopify's cost-based throttling, but tracked per-operation rather than per-shop-wide-budget.

---

## 3. Feature-by-Feature Mapping: Shopify (built) → Amazon (planned)

| Capability | Shopify mechanism (shipped) | Amazon mechanism (planned) | Risk/gap |
|---|---|---|---|
| Connect a store/seller account | OAuth authorize → callback → encrypted token storage (`shopify_connections`) | LWA OAuth authorize → callback → encrypted token storage (new `amazon_connections`, or a generalized table — §4) | Low risk — same shape, different token endpoint. |
| Order lookup by number + email match | `find_order()` — GraphQL search by order number, compare email in Python (`shopify_service.py:205`) | `getOrders` filtered by `AmazonOrderId` or `BuyerEmail`/purchase-date range; Amazon's search is less flexible than Shopify's GraphQL query DSL — needs a small validation spike to confirm exact filterable fields | Medium — likely fine, needs sandbox confirmation of query parameters. |
| Order status / tracking display | Direct read of fulfillment status + tracking numbers | `getOrder` (status) + `getOrderItems`; tracking number visibility for FBM depends on the seller having submitted `updateShipmentStatus` themselves | Medium — FBA tracking may need a different read path than FBM. |
| Refund | `refundCreate` GraphQL mutation, synchronous | Feed-based refund/adjustment submission, asynchronous — confirm-then-**submit**-then-poll/notify, not confirm-then-execute-then-confirm-immediately | **High** — needs a UX redesign (see §5) and a sandbox validation spike before the exact mechanism is locked in. |
| Cancel order | `orderCancel` GraphQL mutation, synchronous, returns an async Job Amazon-Shopify-side already (so the existing code already polls a job) | Feed-based cancellation submission (order-acknowledgement feed type), asynchronous; **for FBA orders, may not be reliably cancelable via API at all once past `Pending`** — likely needs a "request submitted, outcome not guaranteed" framing rather than "cancelled" | **High** for FBA; medium for FBM. |
| Shipping-address update | `orderUpdate` GraphQL mutation (fetch-current, full-replace, merge) | **Likely not possible for already-placed Amazon orders at all** — Amazon's buyer-controlled address model generally does not expose a seller-side "change the ship-to address" write; this needs explicit confirmation and may simply be **out of scope** for Amazon (documented as an assumption to validate, not a promise) | **High** — plan for this to possibly be dropped from the Amazon feature set entirely pending validation. |
| Order-event webhooks | Shopify declarative webhook subscriptions → HTTPS POST to `bp_shopify.py` | SQS-based Notifications API — needs a consumer process, not a webhook route | New infra pattern (§2). |
| Audit trail | `shopify_write_audit` table, logged on every write action | Same pattern, generalized (§4) — log submission + eventual outcome (since writes are async, "outcome" may arrive later than the initial "submitted" log entry) | Low risk, mostly a schema tweak (needs a `status` lifecycle: submitted → processing → succeeded/failed, not just success/fail). |
| Rate limiting | Per-org write budget (`10 per hour`, memory/Redis-backed) | Same pattern, per-operation granularity | Low risk. |
| Protected Customer Data-style gating | Per-field-group approval in Partner Dashboard (Email, then Address+Name, then Phone) | Amazon has its own "Restricted Data Token" / PII-access model for buyer info (`getOrderBuyerInfo`, `getOrderItemsBuyerInfo`) — needs its own research pass once Phase 0 begins, not assumed identical to Shopify's model | Flagged as unresearched — do not assume Shopify's exact approval flow transfers. |

---

## 4. Multi-Provider Configuration & Activation Layer

This is the piece the user asked for explicitly: a tenant should be able to turn Shopify and/or Amazon on or off independently, and the bot's provider-agnostic intents (`check_order_status`, `request_refund`, `cancel_order`, `update_shipping_address` — dropping the `_shopify` suffix from the existing intent/action names since they'll no longer be Shopify-specific) should route to whichever provider(s) that tenant has enabled.

### 4.1 Data model

Generalize the existing single-purpose `shopify_connections` table (`common/db/_connection.py:267-279`: `org_id PK, shop_domain, access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, scopes, status, installed_at, uninstalled_at, updated_at`) into a **shared shape reused per provider**, rather than duplicating a near-identical `amazon_connections` table with copy-pasted columns:

```
commerce_connections
    org_id            TEXT
    provider          TEXT   -- 'shopify' | 'amazon'
    external_id       TEXT   -- shop_domain (Shopify) or seller_id/marketplace_id (Amazon)
    access_token      TEXT   -- encrypted, same Fernet pattern as today (common/crypto.py)
    refresh_token     TEXT
    access_token_expires_at   TIMESTAMPTZ
    refresh_token_expires_at  TIMESTAMPTZ
    scopes            TEXT
    status            TEXT NOT NULL DEFAULT 'connected'
    provider_metadata JSONB  -- provider-specific extras (e.g. Amazon marketplace_id list, region)
    installed_at, uninstalled_at, updated_at   TIMESTAMPTZ
    PRIMARY KEY (org_id, provider)
```

Plus a small settings table (or a JSONB column on an existing org-settings table if one exists) recording **which provider is authoritative when a tenant has both connected** — e.g. `org_commerce_settings(org_id, default_provider, enabled_providers TEXT[])` — since a single "where's my order" query needs to know which backend(s) to check, potentially trying both if a tenant genuinely sells on both platforms and order numbers don't disambiguate which store an order belongs to.

**Migration note**: this is an additive schema change, not a breaking one — `shopify_connections` can either be migrated into `commerce_connections` with `provider='shopify'` rows, or left as-is with `commerce_connections` used only for new providers going forward (simpler, less migration risk, mild duplication) — a decision worth revisiting once Amazon is actually being built rather than now.

### 4.2 Provider abstraction (service layer)

`action_server/actions/shopify_service.py`'s existing public surface is the de facto interface already, just not yet formalized as one:

```
find_order(org_id, order_number, email) -> Order | None
get_suggested_refund(org_id, order_gid) -> RefundQuote | None
refund_order(org_id, order_gid, ...) -> RefundResult
cancel_order(org_id, order_gid) -> CancelResult
update_shipping_address(org_id, order_gid, address) -> UpdateResult
```

Recommend introducing a `CommerceProvider` abstract base class with this shape, then:
- `ShopifyService` implements it as-is (already does, informally).
- A new `AmazonService` implements the same interface — but several methods will need an **async result shape** rather than the synchronous one Shopify's methods return today (e.g. `refund_order()` returning `{status: "submitted", feed_id: ..., poll_after: ...}` instead of an immediate success/failure), since that's the honest shape of Amazon's actual mechanism (§1). The interface should be designed to accommodate this from the start rather than forcing Amazon's async reality into a synchronous-shaped contract.
- A thin `get_provider(org_id) -> CommerceProvider | list[CommerceProvider]` resolver reads `org_commerce_settings`/`commerce_connections` and returns the right implementation(s) for that tenant.

### 4.3 Rasa layer changes

- Rename `action_shopify_order_status` → `action_order_status` (and equivalently for the other three actions), with the action body calling the resolver (§4.2) instead of importing `shopify_service` directly. This is a mechanical rename + one extra dispatch layer, not a rewrite of the existing, already-verified business logic.
- `utter_shopify_not_connected` becomes provider-aware — "no commerce integration connected" if neither is enabled, vs. today's Shopify-specific copy.
- New slot or org-context field indicating which provider resolved a given lookup, so a reply can honestly say "your Amazon order" vs "your Shopify order" if a tenant has both connected and the bot had to disambiguate.

### 4.4 Admin UI changes

Generalize `web/ui/src/portal/admin/ShopifyPage.jsx` into a **Commerce Integrations** hub page showing one `IntegrationCard` per supported provider (reusing the same `ConfigModal`/`StatusBadge` components already built for `IntegrationPage.jsx`), each with its own Connect/Disconnect flow — rather than a page named after one specific platform. Mobile parity (`expo-app`) follows the same pattern already established for the order-tracking rich message.

---

## 5. Confirm-Then-Submit UX Redesign (write actions)

The existing Shopify write-action rules (`core/data/rules.yml` confirm-then-execute pattern) assume: user confirms → action executes → immediate success/failure reply. Amazon's async feed model breaks that assumption for refund/cancel. Recommended shape instead:

1. User confirms the action (same as today).
2. Action **submits** the feed and replies with an honest "submitted, Amazon is processing this — I'll let you know the outcome" message, logging `status='submitted'` to the audit table.
3. A polling job (or, once built, the SQS Notifications consumer — §2) checks/receives the outcome and updates the audit row's status to `succeeded`/`failed`.
4. The bot surfaces the final outcome on the customer's next interaction, or (if a proactive-notification channel exists) pushes it — this needs a decision: does Project IQ have any "message the customer later, out of band" capability today? (Worth checking before committing to this design — if not, the fallback is "check back in a few minutes" framing with a manual status-check intent.)

This is a genuinely different interaction pattern from anything currently built, not a copy of the Shopify flow with new field names — flagging it here so it's scoped as real design work, not an afterthought.

---

## 6. Phased Roadmap

| Phase | Scope | Notes |
|---|---|---|
| **0a — Validation spike: auth + order read** | Register a **sandbox application** via the Solution Provider Portal — no Professional Seller account needed, no cost, no seller authorization required. **Live-confirmed 2026-08-06**: LWA token exchange works (`POST /auth/o2/token`, just `client_id`/`client_secret`/`refresh_token`, no SigV4 needed) and sandbox `getOrders` works (`x-amz-access-token` header only) — both fully unblocked, no SPP identity verification needed for this path. | De-risked exactly like the Shopify refund mechanics were — through a live call, not docs (one doc snippet had claimed AWS role assumption might still be needed for sandbox; disproven by an actual working call). |
| **0b — Validation spike: refund/cancel (Feeds API)** | **Blocked, live-confirmed 2026-08-06**: `createFeedDocument` returns a generic `400 Invalid input` regardless of `contentType` value tried — points to the app's Solution Provider Portal role/permissions grant not including Feeds API access. The Portal's **"Set up Solution Provider Account Profile and Permissions"** step (where roles/use-cases are selected) is greyed out/locked until **"Verify your Identity"** (business registration + ID document, ~20 min) is completed. **Deferred** — identity verification parked for later; resume 0b once done. | Does not block 0a, Phase 1, or Phase 2 (§8 decision — proceed with order-lookup path now, revisit refund/cancel validation after SPP identity verification is completed). |
| **1 — Public Developer application** | Submit Amazon's Public Developer registration + Appstore listing requirements (still via the Solution Provider Portal, but the fuller reviewed track) | **Start this in parallel with Phase 0**, not after — unknown external review lead time makes it the likely critical path, same category of risk as a real infra dependency. Does not block or depend on Phase 0. |
| **2 — Multi-provider config layer** | Build `commerce_connections`/`org_commerce_settings` (§4.1), `CommerceProvider` interface (§4.2), Rasa action renames (§4.3) — can ship with Shopify as the only real implementation initially, proving the abstraction before Amazon exists behind it | Depends on nothing Amazon-specific — could even start immediately, independent of Phases 0-1. |
| **3 — Amazon OAuth connect + read-only order status** | `AmazonService.find_order()`/order-status read path, admin UI Connect flow (§4.4) | Depends on Phase 1 approval (for real multi-seller use) — can be built/tested against Phase 0's private-app sandbox in the meantime. |
| **4 — SQS Notifications consumer** | Background worker subscribing to order-event notifications | Should share infrastructure with the KB/RAG plan's task-queue decision (`docs/KB_WIKI_CURATION_RAG_PLAN.md` §4.10) rather than standing up a second, unrelated async system. |
| **5 — Write actions (refund/cancel)** | Feed-submission + confirm-then-submit UX (§5), audit trail with async status lifecycle | Shipping-address update may be dropped from scope entirely here pending Phase 0's findings. |

---

## 7. Risks

- **App-approval timeline is unknown and external** — the single biggest schedule risk, not mitigable by engineering effort; start Phase 1 immediately regardless of engineering readiness.
- **Refund/cancel/address-update mechanics are confirmed-uncertain from documentation alone** (§1, §3) — Phase 0 must happen before any write-action code is designed in detail, exactly as live testing (not docs) was what actually nailed down Shopify's refund mechanics.
- **FBA cancellation may simply not be reliably API-drivable** past `Pending` status — the plan should be prepared to ship "cancellation requested, outcome pending/uncertain" as an honest answer for FBA orders rather than promising a Shopify-equivalent guarantee.
- **New infrastructure dependency (SQS/EventBridge)** — first AWS-specific infra this product would depend on; worth confirming there's an existing AWS account/ops relationship before assuming this is a quick add.
- **Confirm-then-submit UX is genuinely new interaction design**, not a port of the existing confirm-then-execute pattern — underestimating this as "the same thing with a different backend" is the most likely way this phase overruns.
- **Restricted Data Token / buyer-PII access model is unresearched** — do not assume Shopify's Protected-Customer-Data per-field-group approval flow maps directly; this needs its own investigation in Phase 0.

---

## 8. Decisions Needed From You

1. **Start the Public Developer application now, in parallel with engineering** (recommended, given unknown lead time) — note this no longer blocks or is blocked by anything else: Phase 0's sandbox validation spike needs no Professional Seller account and can start today regardless of this decision.
2. **Is shipping-address update acceptable to drop from the Amazon feature set** if Phase 0 confirms it's not possible via API — i.e., is order-status + refund + cancel alone still a worthwhile Amazon integration on its own?
3. **Does Project IQ have (or need) an out-of-band "notify the customer later" capability** for the confirm-then-submit async write pattern (§5), or should the fallback be a manual "check status" intent instead?
4. **Migrate `shopify_connections` into the generalized `commerce_connections` shape now (§4.1), or add it net-new for Amazon only and revisit consolidation later** — affects how much of the existing Shopify code gets touched as part of this work vs. staying untouched.

---

## 9. References

- [SP-API no longer requires AWS IAM or AWS Signature Version 4 — official changelog](https://developer-docs.amazon.com/sp-api/changelog/sp-api-will-no-longer-require-aws-iam-or-aws-signature-version-4)
- [Register as a Public SP-API Developer](https://developer-docs.amazon/sp-api/docs/register-as-a-public-developer) — Public Developer / Appstore listing requirement
- [SP-API Registration Overview](https://developer-docs.amazon/sp-api/docs/sp-api-registration-overview)
- Orders API v0 operation list (via community mirror, official docs paywalled behind inconsistent redirects during this research pass): `getOrders`, `getOrder`, `getOrderAddress`, `getOrderBuyerInfo`, `getOrderItems`, `getOrderItemsBuyerInfo`, `updateShipmentStatus`, `getOrderRegulatedInfo`, `updateVerificationStatus`
- Feed Type Values documentation (order-acknowledgement / financial-adjustment feed types referenced but not fully schema-confirmed in this pass) — validate directly against SP-API sandbox in Phase 0
