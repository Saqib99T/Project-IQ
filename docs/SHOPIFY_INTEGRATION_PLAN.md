# Shopify Integration — Effort Estimate & Implementation Plan

**Prepared:** 2026-07-31 · **Updated:** 2026-08-06 — Phase 1 built and verified live against a real Shopify dev store; see §6a for what the plan got right/wrong in practice.
**Context:** Follow-up to [docs/COMPARISON_GORGIAS_VS_PROJECTIQ.md](COMPARISON_GORGIAS_VS_PROJECTIQ.md) — Gorgias's automation/personalization depends on live Shopify order/customer data. This document scopes what it would take for Project IQ to connect to a merchant's Shopify store and support equivalent order-related conversations.
**Research basis:** Shopify Dev docs on [OAuth/access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant), [webhook subscriptions](https://shopify.dev/docs/apps/build/webhooks/subscribe), and [API rate limits](https://shopify.dev/docs/api/usage/limits), current as of the 2026 platform requirements (OAuth 2.0 mandatory since Jan 1 2026; expiring offline tokens required for new public apps from Apr 1 2026; GDPR compliance webhooks mandatory for app approval; GraphQL Admin API is cost-based-throttled, REST Admin API is legacy/deprecated for new builds).

---

## 1. Scoping Assumptions (read this first)

"Shopify integration" can mean very different amounts of work depending on intent. This plan assumes the realistic, ITSM-relevant baseline and flags the larger option separately:

- **Baseline scope (this plan's main estimate):** Project IQ tenants who run a Shopify store can connect it (OAuth), and the bot can look up order status, handle basic order actions (cancel, refund initiation, shipping-address update) — i.e., parity with Gorgias's **Support Agent** mode. This is the same "Resolve"/"Retain" skill area scored in the comparison doc.
- **Out of baseline scope, flagged as Phase 4 (optional/larger):** Gorgias's **Shopping Assistant** mode (pre-purchase product discovery, upsells, discounts) is a different product surface (sales/marketing, not support) and would be a separate initiative, not a Shopify "integration" task — estimated separately below so it doesn't distort the core number.
- Project IQ is **multi-tenant** (per [project_tenant_provisioning](../.claude memory — tenant onboarding via signed webhook)); this plan assumes **each tenant connects their own Shopify store independently**, not one shared store. That's what makes this a proper "Shopify App" build (OAuth install flow, per-tenant token storage) rather than a single hardcoded API key.
- If instead only **one specific tenant** ever needs this (single hardcoded store, no multi-merchant OAuth, no App Store distribution), effort drops substantially — noted inline as the "single-tenant shortcut" wherever relevant.

---

## 2. Why This Isn't a Small Add-On

Three platform realities push this above a "plug in an API key" task:

1. **OAuth is now mandatory, not optional.** As of Jan 1 2026, Shopify no longer allows static/legacy API tokens for new apps — everything goes through OAuth 2.0 authorization code grant, and new public apps must handle **expiring offline access tokens with refresh** (from Apr 1 2026). That means Project IQ needs token storage, refresh logic, and re-auth handling per tenant, not just a stored secret.
2. **GDPR compliance webhooks are mandatory for approval.** Any app installable by multiple merchants must implement `customers/data_request`, `customers/redact`, and `shop/redact` webhook handlers before Shopify will approve it — this is a hard requirement, not a nice-to-have.
3. **The API is cost-based rate-limited, not request-count limited.** Every GraphQL query costs "points" against a per-shop bucket (1,000 pts/min standard plan, restoring at 50 pts/sec). Bulk/backfill operations need Shopify's async bulk-operation API, not naive polling loops — this affects how the sync/cache layer must be built, not just how fast it runs.

None of this is exotic, but it means the honest shape of the work is: **build a small OAuth-based Shopify app + webhook receiver + rate-limit-aware API client**, then wire that into the existing Rasa action server and admin UI — not "call an endpoint."

---

## 3. Target Architecture

```
Tenant Admin (Portal UI)
   └─ "Connect Shopify Store" → OAuth install link
        └─ Shopify OAuth consent → callback → Project IQ backend
             └─ Exchanges code for offline access token
             └─ Stores token (encrypted) + shop domain, keyed by tenant_id
             └─ Registers webhook subscriptions (orders/*, customers/*, GDPR topics)

New service/module: shopify_integration
   ├─ OAuth flow handlers (install, callback, token refresh)
   ├─ GraphQL Admin API client (cost-aware, retry/backoff, bulk-op support)
   ├─ Webhook receiver (HMAC-verified) → normalizes into internal order/customer model
   ├─ GDPR compliance webhook handlers (data_request/redact/shop_redact)
   └─ Background sync/cache (same pattern as kb_cache_manager.py) for low-latency lookups

Rasa layer
   ├─ New intents: check_order_status, request_return, request_refund,
   │   update_shipping_address, cancel_order
   ├─ New form: order lookup (order_number + email, or authenticated customer id)
   └─ New custom actions calling into shopify_integration via internal API

Frontend (widget + mobile — parity required)
   └─ Order-status/tracking rich-message component (mirrors existing chart/graph
       rich responses already supported in ChatWindow.jsx/MessageBubble.jsx)

Admin/Portal
   └─ Shopify connection management page (connect/disconnect, scope status,
       webhook health, re-auth prompts on token expiry)
```

---

## 4. Detailed Work Breakdown

### 4.1 Shopify App Registration & OAuth
| Task | Effort | Notes |
|---|---|---|
| Create Partner/Dev Dashboard app, define scopes (`read_orders`, `read_customers`, `write_orders`, etc.) | 0.5 day | One-time setup |
| OAuth install + callback endpoints, state/CSRF handling | 2-3 days | Standard authorization-code-grant flow |
| Encrypted token storage per tenant (new table) + refresh-token handling | 2-3 days | Ties into existing Infisical-style secret handling patterns, but per-tenant dynamic secrets (not static env config) — new pattern for this codebase |
| GDPR compliance webhook handlers (data_request/redact/shop_redact) | 2 days | Mandatory for any multi-merchant app; skip entirely if single-tenant shortcut |
| **Subtotal** | **~7-9 days** | |

### 4.2 Backend Integration Service
| Task | Effort | Notes |
|---|---|---|
| GraphQL Admin API client (auth, retries, cost-based throttle awareness) | 3-4 days | New reusable client module |
| Webhook receiver + HMAC signature verification + normalization into internal model | 3-4 days | Orders created/updated/cancelled, fulfillment updates |
| Background sync/cache layer for order/customer lookups (latency optimization) | 3-4 days | Reuses the existing `kb_cache_manager.py` background-thread caching pattern |
| Write-action endpoints: refund, cancel order, update shipping address | 4-5 days | Refunds/cancels need confirmation-step guardrails, not fire-and-forget |
| Internal API surface for Rasa actions to call (auth, tenant scoping) | 2 days | Mirrors existing action-server-to-backend pattern already used for ITSM API |
| **Subtotal** | **~15-19 days** | |

### 4.3 Rasa NLU / Dialogue / Actions
| Task | Effort | Notes |
|---|---|---|
| New intents + training data (`check_order_status`, `request_return`, `request_refund`, `cancel_order`, `update_shipping_address`) | 2-3 days | Plus retraining/validation passes |
| Order-lookup form (slot filling: order number/email, or authenticated identity) | 2 days | Reuses existing `FormAction` patterns (`ticket_form` precedent) |
| Custom actions calling the new backend service | 3-4 days | `action_shopify_order_status`, `action_shopify_initiate_return`, `action_shopify_refund`, `action_shopify_update_shipping` |
| Confirmation/guardrail rules before executing refunds/cancellations (`RulePolicy`) | 1-2 days | Same pattern as existing "always confirm before submitting a ticket" rule |
| **Subtotal** | **~8-11 days** | |

### 4.4 Frontend (Widget + Mobile — parity required per project convention)
| Task | Effort | Notes |
|---|---|---|
| Order/tracking rich-message component — web widget | 2-3 days | Extends existing rich-response rendering (charts/buttons already supported) |
| Same component — mobile app (Expo) | 2-3 days | Web/Mobile parity is a hard requirement for this project |
| **Subtotal** | **~4-6 days** | |

### 4.5 Admin/Portal UI
| Task | Effort | Notes |
|---|---|---|
| "Connect Shopify Store" flow + connection status/health page | 3-4 days | New admin page, similar effort class to existing Config Manager pages |
| Re-auth/expiry handling UI (token refresh failures, scope changes) | 1-2 days | |
| **Subtotal** | **~4-6 days** | |

### 4.6 Security, Compliance & Testing
| Task | Effort | Notes |
|---|---|---|
| Webhook HMAC verification + replay protection | 1 day | Security-critical, not optional |
| PII handling review (customer email/address/order data) — encryption at rest | 2-3 days | Ties to the PII-encryption gap already flagged in the Gorgias comparison doc |
| Audit logging of write actions (who/what/when) | 1-2 days | Extends existing `actions` table logging pattern |
| Shopify dev store setup + end-to-end test suite (OAuth, webhooks, rate-limit behavior) | 3-4 days | Needs a real Shopify partner dev store, not mockable in full |
| Multi-tenant isolation testing (two tenants, two stores, no data bleed) | 1-2 days | Given multi-tenant is the baseline scope |
| **Subtotal** | **~8-12 days** | |

---

## 5. Effort Summary — Baseline Scope (Support-Agent Parity)

| Layer | Effort (person-days) |
|---|---|
| Shopify App & OAuth | 7-9 |
| Backend integration service | 15-19 |
| Rasa NLU/actions | 8-11 |
| Frontend (web + mobile) | 4-6 |
| Admin/Portal UI | 4-6 |
| Security, compliance & testing | 8-12 |
| **Total** | **~46-63 person-days** (~9-13 person-weeks) |

With 1 backend engineer + 1 bot/NLU engineer working in parallel where possible, this lands at roughly **6-9 calendar weeks**, matching the "Medium" effort rating given in the original comparison doc — this document just makes that estimate concrete.

**Single-tenant shortcut:** if this is only ever needed for one specific merchant (no OAuth install flow, no GDPR webhooks, one hardcoded custom-app access token), cut §4.1's GDPR webhook item and simplify token storage — saves roughly **8-10 days**, bringing the total to **~38-53 person-days (~6-8 weeks)**.

---

## 6. Phased Roadmap

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| **Phase 0 — Discovery** | Partner account setup, scope/permission decisions, dev store, architecture sign-off | 2-3 days | Nothing — do this first |
| **Phase 1 — MVP (read-only)** ✅ **Done 2026-08-06** | OAuth connect, order status lookup, "Where is my order" intent, admin connect UI | ~3-4 weeks | Phase 0 |
| **Phase 2 — Write actions** ✅ **Done 2026-08-06** — refund, cancel, and shipping-address update all verified live | Refund/cancel/shipping-address update with confirmation guardrails, audit logging | ~2-3 weeks | Phase 1 |
| **Phase 3 — Subscriptions (optional)** | Subscription edits | Separate initiative | Note: Gorgias itself uses **Recharge** (a third-party app) for this, not native Shopify — so this isn't really a "Shopify integration" task even for Gorgias. Recommend excluding unless a tenant specifically needs it |
| **Phase 4 — Shopping Assistant / pre-sales mode (optional, out of baseline)** | Product discovery, upsells, live-inventory discounts | 4-6+ weeks, separate product surface | Requires product/marketing scope decision — this is a different capability (sales), not a support integration |

---

## 6a. Phase 1 Build Report — What The Plan Got Right/Wrong (2026-08-06)

Phase 1 is built and verified end-to-end against a live Shopify Partner dev app ("MyApp") and dev store ("MyStore") — real OAuth consent, real GraphQL order lookup, real chat responses. Four things surfaced during the actual build that this plan either got only partially right or missed entirely; recorded here so the effort estimates and risk list in §2/§8 stay honest for whoever touches this next.

**1. The expiring-token requirement was correctly flagged (§2, §8) but the exact mechanism wasn't discoverable without live testing.** The token exchange silently returns the old non-expiring token shape unless the request includes an undocumented `expiring=1` field — omit it and every Admin API call (GraphQL *and* REST) is rejected with `"Non-expiring access tokens are no longer accepted"`. Fixed by adding `expiring=1` to the exchange call and storing/auto-refreshing the resulting `refresh_token` (access tokens last only ~1 hour; refresh tokens ~90 days, and rotate on every use — both old tokens are invalidated the moment you refresh, so the new pair must be persisted together or the connection becomes unrecoverable).

**2. Protected Customer Data access was not in the original plan at all.** Even with the correct OAuth scopes granted by the merchant, Shopify separately gates read access to the `Order` object (and any customer PII) behind an app-level "Protected Customer Data" approval — a platform policy this plan's research pass didn't surface. For a development store this needs no formal review, just selecting the specific data fields/reasons in the Partner Dashboard's **API access requests** section (a different surface than the Dev Dashboard used for credentials) — but it's a real, blocking 403 (`ACCESS_DENIED`) until done, and would need real review for a production/App-Store-listed app.

**3. Webhook registration architecture needed correcting mid-build.** The original plan (§3, §4.2) called for registering webhook subscriptions via REST API calls inside the OAuth callback. That approach both (a) breaks under expiring tokens — the REST `webhooks.json` endpoint hit the same "non-expiring token" rejection — and (b) isn't Shopify's recommended mechanism regardless: subscriptions should be declared in `shopify-app/shopify.app.toml` under `[[webhooks.subscriptions]]` (order events) and `[webhooks.privacy_compliance]` (the three GDPR topics), deployed once via `shopify app deploy`, and Shopify then applies them automatically to every shop that installs the app — no per-connection registration code needed at all. The runtime registration call has been removed; the declarative TOML config is added but **not yet deployed/testable**, since webhook delivery requires Shopify's servers to reach a public HTTPS endpoint, which `localhost` isn't (unlike the OAuth redirect, which is browser-mediated and works fine locally).

**4. Order-to-caller email matching needed a real design decision the plan didn't anticipate.** The natural-seeming approach — match the logged-in user's IAM email to the order — breaks in two ways found through actual use: (a) `Order.email` (the checkout-time contact) can be **null**, e.g. for orders where a customer was assigned after the fact rather than entered at checkout — the durable identity link is the linked **Customer.email**, not the Order field; and (b) a real business need surfaced where one person places an order and a *different* logged-in user checks its status later. Resolved by trying the caller's IAM email first (zero extra friction for the common case) and only asking "what email was used for this order?" as a fallback when that doesn't match, rather than a hard requirement either way.

**Also fixed in passing:** a copy-paste bug in the Rasa rules (unrelated to Shopify) where the order-status retry rule, mirrored from the pre-existing ticket-status rule, called `action_check_itsm_status` instead of `action_shopify_order_status`.

**Net effect on the estimates above:** §4.1 (OAuth) and §4.2 (backend service) both ran somewhat over their AI-assisted estimates in §7 specifically because of items 1-3 above — none of which were code-complexity problems, all of which were "the platform's actual behavior differs from its own docs/plan assumptions" problems, discoverable only by testing live. The §7 note that "live end-to-end verification doesn't compress no matter how the code gets written" undersold it slightly: it's not just that verification takes human time, it's that verification is what *surfaces the requirements* — the docs alone weren't sufficient to write this correctly on the first pass.

---

## 6b. Phase 2 Build Report (2026-08-06)

Write actions (`request_refund`, `cancel_shopify_order`, `update_shipping_address`) are built as confirm-then-execute pairs (prepare action authenticates + previews + asks for explicit affirm/deny; only the execute action calls Shopify), each gated by the tenant-scoped write rate limit called for in §4.2/§4.6 (`[SHOPIFY] write_rate_limit`, default 10/hour per org — implemented in `shopify_service.py` directly rather than `web/api/rate_limiting.py`, since these calls originate from the action server calling Shopify directly and never pass through a Flask request at all).

**Verified live, all three:** cancellation (`orderCancel` — confirmed via the order's `cancelledAt` timestamp), shipping-address update (`orderUpdate` — confirmed via `city`/`province`/`country` actually changing), and refund (`refundCreate` — confirmed via the order's `displayFinancialStatus` flipping to `REFUNDED` for the full $949.95). Refund needed a second test order with an actual captured payment — the first test order was `PENDING`, and `suggestedRefund` correctly computed $0 refundable against it since there was nothing captured to reverse.

Seven more real findings from building this, on top of §6a's — refund alone needed four fixes, each only surfacing by actually executing the mutation against a real paid order, not from reading the schema:

**1. `suggestedRefund` defaults to computing nothing.** Called with no arguments, it silently returns `amountSet: $0` and empty `refundLineItems`/`suggestedTransactions` — even against a $949.95 paid order with a refundable line item. The field needs `suggestFullRefund: true` explicitly; it defaults to `false`. Nothing in the response *looks* like an error (no `userErrors`, no exception) — it just quietly suggests refunding zero, which would have silently no-opped a real refund request if not caught.

**2. `OrderTransactionInput` (inside `RefundInput.transactions`) requires `orderId` and `gateway` on every transaction**, not just `parentId`/`amount`/`kind` as the object shape returned by `suggestedTransactions` implies. `gateway` must match the original transaction's own gateway (e.g. `"manual"`) — thankfully `suggestedTransactions` does carry that field even though it's not obvious it's needed until the mutation rejects its absence.

**3. `suggestedTransactions[].kind` returns `"SUGGESTED_REFUND"` — a preview-only marker, not a valid value for the mutation input.** Passing it straight through fails with `"Kind suggested_refund is not a valid transaction"`. The real `OrderTransactionKind` for an actual refund is `"REFUND"`; the query-side and mutation-side vocabularies look like they should match but don't.

**4. `suggestedRefund`'s recommended `restockType` (usually `"CANCEL"`) requires a `locationId` to actually restock, which a chat-driven refund has no principled way to choose.** Fixed by always forcing `restockType: "NO_RESTOCK"` regardless of what's suggested — inventory restocking is treated as a separate merchant decision, not something a support-bot refund should make unilaterally.

**5. `refundCreate` requires an idempotency key as of API 2026-04**, via `@idempotent(key: $idempotencyKey)` — a directive, not a regular mutation argument. Missing this isn't a documented "required field" in the schema in the way GraphQL usually enforces required arguments; it's an API-version-gated runtime requirement layered on afterward. Handled by generating a fresh UUID per refund attempt.

**6. Shopify treats `shippingAddress` on `orderUpdate` as a full replace, not a per-field patch.** Submitting only the fields a customer wants to change (e.g. just a new street address) fails with `"Enter a last name"` — because omitted fields aren't merged server-side, they're simply absent from the new address, and Shopify requires a name on any address at all. Fixed by fetching the order's current shipping address first and merging the caller's changes onto it, plus a fallback to the caller's IAM identity name for the edge case (common in this dev store's test data, unlikely in production) where the order has no address on file at all to merge from.

**7. Protected Customer Data approval is granted per-field-group, not once for the whole app.** The Email approval granted for Phase 1's order lookup (§6a) does *not* cover Address/Name/Phone — attempting to read those back after a successful `orderUpdate` failed with the same `ACCESS_DENIED` shape as §6a's Order-object gate, once per field. The important nuance: **the restriction is on reading a protected field's value in a response, not on writing it** — the mutation itself succeeds (empty `userErrors`) even when the response can't echo the new address back. Worked around by not requesting those fields in the mutation response at all (the caller already knows what it submitted); reading an *existing* address on an order that already has real values in these fields still needs the additional field approval, which hasn't been requested yet.

**Net read:** the pattern holding across both phases is the same — Shopify's actual runtime behavior (idempotency enforcement, full-replace semantics, per-field-group data access, silent-zero defaults, query/mutation vocabulary mismatches) diverges from what a schema/docs read alone would predict, in ways only live testing surfaces, and `refundCreate` specifically needed four sequential live-test-fix-retest cycles before it worked — not because the code was wrong in concept, but because each fix exposed the next requirement. Budget for that discovery cost specifically, not just implementation time.

---

## 7. Effort With AI-Agent-Assisted Development

The estimates in §4/§5 are traditional hand-written-code numbers. Using an AI coding agent (e.g. Claude Code) working directly in this repo compresses some layers heavily and others barely at all — the difference comes down to whether the task is **pattern-following inside a codebase the agent can read in full** (compresses a lot) or **waiting on an external system / requiring a human to physically verify something** (doesn't compress).

This repo specifically has strong precedent the agent can copy rather than invent from scratch: `ticket_form` → order-lookup form, `kb_cache_manager.py` → Shopify order/customer cache, Config Manager UI → Shopify connection UI, existing chart/graph rich-responses → order-tracking rich-response. That precedent is what makes the multipliers below realistic rather than optimistic.

| Layer | Traditional | AI-agent-assisted | Reduction | Why it does / doesn't compress |
|---|---|---|---|---|
| Shopify App & OAuth (§4.1) | 7-9 days | **3.5-4 days** | ~50% | OAuth flow is a well-documented, standard pattern — agent drafts install/callback/refresh/GDPR-webhook handlers fast. Human still must register the real Partner app and click through the actual OAuth consent screen once to verify — that step doesn't compress |
| Backend integration service (§4.2) | 15-19 days | **8-9.5 days** | ~50% | GraphQL client + webhook receiver + cache layer directly mirror `kb_cache_manager.py`, which the agent can read and adapt. Write-action endpoints (refund/cancel) compress less — the business logic and confirmation guardrails need careful human review since they move real (or test) money |
| Rasa NLU/actions (§4.3) | 8-11 days | **3.5-4.5 days** | ~60% | Highest-compression layer — intents/training data/forms/actions are exactly the kind of pattern-replication (following `ticket_form` and existing action-server conventions) an agent does fastest. Retraining/validation runs still take real wall-clock time regardless |
| Frontend, web + mobile (§4.4) | 4-6 days | **2-3 days** | ~50% | New rich-message component follows the existing chart/graph rendering pattern in `ChatWindow.jsx`/`MessageBubble.jsx`; mobile parity is mostly re-applying the same component, which agents do well |
| Admin/Portal UI (§4.5) | 4-6 days | **2-3 days** | ~50% | Same shape as the existing Config Manager pages — direct pattern reuse |
| Security, compliance & testing (§4.6) | 8-12 days | **6-8.5 days** | ~25% | Lowest-compression layer. An agent can draft HMAC verification and encryption code quickly, but a live Shopify dev store, real OAuth round-trips, multi-tenant isolation testing, and security sign-off require a human actually running and observing the system — that verification time doesn't shrink just because the code was written faster |
| **Total** | **~46-63 days** | **~26-33 days (~5-6.5 weeks)** | **~40-45%** | |

**Single-tenant shortcut, AI-assisted:** applying the same skip (no OAuth app/GDPR webhooks) to the compressed numbers brings the total to roughly **~20-26 person-days (~4-5 weeks)**.

**What doesn't compress no matter how the code gets written:**
- Shopify Partner/App Store review time (external, calendar-bound — see §8).
- Live end-to-end OAuth + webhook verification against a real Shopify dev store — this needs a human clicking through the actual flow at least once.
- Security/compliance sign-off on write-actions that touch refunds or customer PII — judgment calls, not code generation.
- API version churn / ongoing maintenance after launch.

**Net effect:** AI-agent assistance turns the ~9-13 person-week traditional estimate into roughly **~5-6.5 person-weeks**, mainly by collapsing the boilerplate-heavy layers (OAuth scaffolding, Rasa training data, UI pages) that follow existing in-repo patterns. It does *not* meaningfully shrink the parts of the timeline that depend on external verification or human judgment — so the realistic calendar-time savings on Phase 0-2 is closer to **35-40%**, not the full 40-45% person-day reduction, once Shopify's own review/testing bottlenecks are accounted for.

---

## 8. Risks & External Dependencies (not fully engineering-controlled)

- **Shopify App Store / Partner review**, if the app is to be publicly listed or used by external merchants beyond internal tenants — review timelines are Shopify's, not ours, and can add 1-4+ weeks of elapsed (not effort) time.
- **API version churn** — Shopify recommends updating to the latest stable API version quarterly; ongoing (small) maintenance cost after launch, not a one-time cost.
- **Token expiry policy** (Apr 1 2026 requirement for new public apps) means refresh-token handling is not optional and must be correct from day one — a broken refresh flow silently disconnects merchants.
- **Rate limits under multi-tenant load** — with many tenants' stores queried concurrently, the cost-based throttle is per-shop, so this scales safely per-tenant, but the shared background-sync worker pool needs to be designed for many concurrent per-shop budgets, not one global budget.
- **PCI scope** — refunds/payments still flow through Shopify's own payment rails; Project IQ never touches card data directly, which keeps PCI exposure low, but customer PII (name/email/address) still needs the encryption-at-rest work called out in §4.6.

---

## 9. Team & Skills Needed

- 1 backend engineer comfortable with OAuth flows, webhook security (HMAC), and GraphQL — for §4.1/4.2/4.6.
- 1 bot/NLU engineer familiar with the existing Rasa domain/actions structure — for §4.3.
- 0.5 frontend engineer for the rich-message component across widget + mobile — for §4.4.
- No dedicated DevOps lift expected beyond adding one new service/module to the existing Docker Compose stack and a new encrypted-secret table.

---

## 10. Recommendation

Don't start building against Shopify's API speculatively — the estimate above is solid, but Phase 0 (discovery) should confirm **which specific tenant(s) actually need this and why** before committing engineering time, since that single decision (multi-tenant OAuth app vs. single hardcoded store) swings the total effort by ~20%. If there's a concrete tenant/use case, Phase 0 + Phase 1 (MVP read-only order status) is the right first checkpoint — it's the lowest-risk slice that proves the integration works end-to-end before committing to write-actions (Phase 2) or the larger, separate Shopping Assistant initiative (Phase 4).

Building it with an AI coding agent (§7) is a reasonable default for this repo specifically — it already has the exact patterns (`ticket_form`, `kb_cache_manager.py`, Config Manager UI, chart rich-responses) an agent can extend rather than invent, which is what turns the ~9-13 person-week traditional estimate into a ~5-6.5 person-week one. The one thing agent-assistance won't buy back is the human-verification tail: someone still has to click through a real OAuth flow, run the multi-tenant isolation tests against a live Shopify dev store, and sign off on the refund/cancel write-paths. Plan the calendar timeline around that tail, not around the code-writing speed.
