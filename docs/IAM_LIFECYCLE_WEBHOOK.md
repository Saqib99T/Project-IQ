# IAM lifecycle webhook → itsm-service — configuration runbook

> The **receiver** is already built and tested in itsm-service
> ([app/api/v1/webhooks.py](../../itsm-service/app/api/v1/webhooks.py),
> `tests/test_webhooks_iam.py`). This runbook documents how to **configure the
> IAM side to emit** the events so they actually fire. Nothing here changes live
> IAM config — it is the procedure to follow when you choose to enable it.

## Why

Today an ITSM user mirror refreshes (active flag, roles) on the user's **next
login**. The webhook gives **immediate** propagation: when IAM deactivates,
suspends, offboards, or re-roles a user — or subscribes/suspends an org — ITSM
reacts within the request instead of waiting for a login. It is an *optimization
+ correctness* layer, not a hard dependency: with it off, mirrors still
eventually converge on login, and [the IAM sync worker](../../itsm-service/app/workers/tasks_iam_sync.py)
provides a polling backstop.

## The contract the emitter must satisfy

**Endpoint:** `POST {ITSM_BASE_URL}/api/v1/webhooks/iam`
(prod: `http://127.0.0.1:8000/api/v1/webhooks/iam` from the box, or the
public/proxied URL if IAM is off-box).

**Headers:**
| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `X-IAM-Signature` | `sha256=<hex>` — HMAC-SHA256 of the **raw request body**, key = the shared secret |

**HMAC:** `hex(HMAC_SHA256(key = IAM_WEBHOOK_SECRET, msg = <raw body bytes>))`,
sent as `sha256=<hex>`. The receiver recomputes over the **exact bytes** it
received and compares constant-time — so the emitter must sign the **serialized
body it actually sends** (no re-serialization/whitespace changes in between).

**Shared secret:** `IAM_WEBHOOK_SECRET` — the **same** value on both sides. Set
it in the itsm-service environment (`.env` / compose / systemd) and in the
emitter's webhook config. Generate one with:
```bash
python -c "import secrets;print(secrets.token_urlsafe(48))"
```
It was never committed (placeholder `your-hmac-webhook-secret` in `.env.example`),
so this is a *provisioning* step, not a rotation.

**Response semantics (drive the emitter's retry policy):**
| Status | Meaning | Emitter should |
|--------|---------|----------------|
| `200 {"received": true}` | processed (or idempotent replay, or unknown-event ignored) | mark delivered |
| `400` | bad/invalid JSON | do **not** retry (malformed) |
| `401` | HMAC missing/mismatch | fix the secret; retrying won't help |
| `500` | transient processing error | **retry with backoff** |

The receiver is **idempotent** (tenant provisioning keys on `iam_org_id`;
concurrent duplicates return 200), so at-least-once delivery is safe.

## Events & payloads

All payloads are flat JSON. `event` is required; other fields are per-event.

### Organization / product
| `event` | Required fields | Effect in ITSM |
|---------|-----------------|----------------|
| `product.subscribed` | `product:"itsm"`, `org_id`, `org_name` | **provision tenant** (idempotent) + seed SLAs, sequences, "General" KB space |
| `product.unsubscribed` | `product:"itsm"`, `org_id` | suspend tenant (`is_active=false`) |
| `organization.suspended` | `org_id` | suspend tenant |
| `organization.reactivated` | `org_id` | unsuspend tenant |

```json
{ "event": "product.subscribed", "product": "itsm",
  "org_id": "org_acme_01", "org_name": "Acme Corp" }
```

### User lifecycle
`user_id` is the IAM **sub** (`sub` is accepted as an alias). `org_id` is
optional — when present, the action is scoped to that tenant's mirror; when
absent it applies to every tenant-mirror of that user.

| `event` (any of) | Required | Effect |
|------------------|----------|--------|
| `user.deactivated` / `user.suspended` / `user.deleted` / `member.removed` / `user.offboarded` | `user_id` | deactivate the user's ITSM mirror now |
| `user.reactivated` / `member.added` / `user.restored` | `user_id` | reactivate the mirror |
| `user.role_changed` / `user.updated` / `user.roles_changed` | `user_id`, `roles[]` | refresh mirrored `iam_roles` |

```json
{ "event": "user.deactivated", "user_id": "f3a1…", "org_id": "org_acme_01" }
{ "event": "user.role_changed", "user_id": "f3a1…", "org_id": "org_acme_01",
  "roles": ["Operator", "User"] }
```

> Unknown events return **200** and are ignored (forward-compatible) — safe to
> over-emit. A `user.*` event with no `user_id` is silently ignored.

## How to wire the emitter

Pick the path that matches where org/product/user lifecycle is **owned**.

### Path A — IAM platform app owns lifecycle (most likely)
Events like `product.subscribed`, `organization.suspended`, `member.added` are
**business** events, not native Keycloak events — so they almost certainly
originate in the IAM/org-management application in front of realm `99-iam`, not
in Keycloak itself.

1. In the IAM app's **outbound webhook / integration config**, add a subscriber:
   - URL: `{ITSM_BASE_URL}/api/v1/webhooks/iam`
   - Secret: the shared `IAM_WEBHOOK_SECRET`
   - Signature scheme: HMAC-SHA256 over raw body, header `X-IAM-Signature: sha256=<hex>`
   - Subscribe to the org/product/user events above (use the exact `event`
     strings and field names — the receiver matches on them literally).
2. Ensure the emitted JSON field names match the tables above
   (`org_id`/`org_name`/`product`/`user_id`/`roles`). Map internal names if needed.
3. Configure retry-on-`5xx` with backoff; treat `2xx` as delivered, `4xx` as
   permanent failure.

### Path B — emit from Keycloak directly (only for raw user events)
If you must source `user.*` events from Keycloak itself, Keycloak needs an
**Event Listener SPI** that POSTs an HMAC-signed webhook (native Keycloak has no
built-in HMAC webhook sender). Options:
- Deploy a webhook event-listener provider JAR (e.g. a community
  `keycloak-webhook` extension) into `providers/`, then enable it under
  **Realm settings → Events → Event listeners**.
- Configure it with the target URL + `IAM_WEBHOOK_SECRET` and map Keycloak admin
  events (`DELETE user`, `UPDATE user`, disable/enable) to the ITSM `event`
  strings + payload shape above (a thin translation layer is usually required —
  Keycloak's native event JSON differs from this contract).

> Org/product subscription events are **not** Keycloak-native — Path B only
> covers `user.*`. Use Path A for org/product.

## Verify (no live IAM change needed)

Test the **receiver** locally with a signed request (proves the secret + route
before touching IAM):

```bash
SECRET='<your IAM_WEBHOOK_SECRET>'
BODY='{"event":"user.deactivated","user_id":"test-sub","org_id":"org_test_acme_01"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
curl -sS -X POST http://127.0.0.1:8000/api/v1/webhooks/iam \
  -H 'Content-Type: application/json' \
  -H "X-IAM-Signature: sha256=$SIG" \
  --data "$BODY"
# → {"received":true}   (and the seeded user's mirror flips inactive)
```

- Wrong/absent signature → `401`. Malformed body → `400`.
- Check itsm-service logs for `webhook_received` then `webhook_user_active_set`.

## Operational notes
- **Rate limit:** the endpoint is limited to ~10 req/min per IP by the global
  middleware — fine for lifecycle events; don't use it for bulk backfill (use
  the IAM sync worker for that).
- **Out-of-order delivery:** a `user.*`/suspend event for an org with no tenant
  yet logs `webhook_tenant_not_found` / no-op mirror and returns 200 — it does
  not error. Mirrors converge on next login regardless.
- **Secrets never logged** — only verification outcome is logged.
- **No deployment performed by this runbook.** Enabling emission is a live IAM
  change; do it in a controlled window and confirm with the verify step above.
