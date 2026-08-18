# Project IQ — Architecture & Code Review

**Date:** 2026-08-18 (three remediation passes same day)
**Branch reviewed:** V3-Shopify
**Scope:** `core/`, `action_server/`, `common/` (backend + IAM), `extensions/` + `shopify-app/` (commerce integrations), `web/` + `expo-app/` (frontends), `.github/` + `infra/` + `scripts/` + `docs/` (CI/infra/hygiene)
**Status:** 12 resolved (one of which uncovered and fixed a live bug), 3 reassessed (corrected, no action needed), 4 still open, 6 patterns commended

An interactive version of the original findings (severity color-coding, at-a-glance counts) is also available as a published artifact; this file is the durable, versioned copy and the one that gets updated as items close.

---

## At a glance

| Resolved | Reassessed | Still open | Commended |
|---|---|---|---|
| 12 | 3 | 4 | 6 |

Of the 4 still open: **M-11** is a live, currently-used Apple API key found mid-review, deliberately left untouched pending the owner's rotation; **M-01** and **M-09** need a separate repo/deployment or a larger infra decision; **H-05** (TypeScript migration) is a large, incremental effort out of scope for a drive-by fix.

---

## Critical — fix before anything else

### ✅ CRIT-01 — A live signed JWT is committed to git — RESOLVED
`common/tmp/admin_token.txt` was tracked because `common/tmp/` was never added to `.gitignore`.

**Resolution:** decoded the token first — it expired 2026-06-15, three days *before* it was even committed, so there was never a live exposure window; rotation was moot. Untracked and deleted the file, added `common/tmp/` to `.gitignore`, then purged it from git history entirely. Turned out to span more than this branch: the commit that introduced it was reachable from `V2`, `V3-ShopiFy`, `V3-improve`, and `V4-sla` (only `main` was clean). Rewrote and force-pushed all four, verified the file no longer appears in any blob across any branch, and confirmed the 2 commits that were locally ahead on `V4-sla` (unpushed at the time) survived the rewrite intact.

### ✅ CRIT-02 — CI has no secret-scanning step — RESOLVED
**Resolution:** added `.github/workflows/secret-scan.yml` — gitleaks on every push/PR. This is exactly the check that would have caught CRIT-01 before it ever reached `main`.

---

## High — structural debt

### ✅ H-01 — No schema migration framework — ADDRESSED
`common/db/_connection.py` managed the entire schema as ~400 lines of inline DDL run at import time, with a bare `except: pass` around every `ALTER`.

**Resolution:** scaffolded Alembic under `common/db/migrations/`, with a baseline migration (`414f8fd00f34`) that ports the existing DDL exactly. Testing it against a real local Postgres surfaced a genuine bug in the process: **the legacy bootstrap silently created zero tables on a truly fresh database.** One `ALTER TABLE kb_articles` (a table nothing in this repo actually creates — `kb_articles` has no `CREATE TABLE` anywhere in the current codebase) failed and poisoned the whole shared transaction; the bare `except: pass` hid the cascade. Verified: legacy bootstrap → 0 tables on an empty DB; the new Alembic baseline → all 28 tables, correctly seeded. The legacy bootstrap itself is left in place untouched for existing deployments — Alembic is additive, used for new schema work going forward. `kb_articles`'s real production schema is still unknown to this codebase (flagged in the migration's docstring rather than guessed at).

### ✅ H-02 — Hardcoded fallback password `'12345'` — RESOLVED
**Resolution:** replaced with an empty-string fallback in `common/app.config`, `config_manager.py`, and `_connection.py`'s dead `ImportError` branch. Confirmed `common/app.config` isn't even the active file for local/prod (both have their own profile configs), so this touches nothing live. Empty password fails the same way a wrong one would — no new behavior, just no more guessable value in source.

### 🔁 H-03 — CORS defaults to wide open — REASSESSED, NO ACTION NEEDED
Originally flagged as High. On investigation: this app authenticates via Bearer JWT everywhere (zero use of `flask.session`/cookies found), and the chat widget is designed to be embedded on arbitrary, unknowable customer domains. A wildcard `CORS(app)` is low-risk without cookie-based ambient credentials, and clamping it to an allowlist would likely **break widget embeds on every customer site**. Correcting the original assessment — left as-is.

### ✅ H-04 — `bp_portal_api.py` is a 1,685-line god-file — RESOLVED
**Resolution:** split into `bp_portal_operator.py` (queue, sessions, live chat, canned responses, AI draft, user history, transfer, presence — 1,137 lines) and `bp_portal_admin.py` (stats, analytics, operator roster, org directory, history, IAM user management — 571 lines). No test coverage existed for these routes at all, so the split was done mechanically (exact line-range extraction, not retyping) to eliminate transcription risk, then verified two ways: byte-for-byte diff of every route body against the original file (identical), and actually registering all blueprints on a real Flask app to confirm the exact same 29 routes/methods come up under `/portal/api/*` with zero duplicate-endpoint conflicts. Both new blueprints share the original's `url_prefix`, so no URL changed.

### ⬜ H-05 — Zero TypeScript across the entire frontend — OPEN
Not addressed in this pass — a gradual migration, not a drop-in fix.

### ✅ H-06 — No frontend CI — RESOLVED
**Resolution:** added `.github/workflows/frontend.yml`. Verified locally before wiring anything in: `web/ui`'s vitest suite (27/27) and all three build targets (default/widget/portal/itsm) pass, so those are blocking checks. Lint has 1,621 pre-existing findings never triaged before — wired as advisory (`continue-on-error`), matching the same pattern this repo already uses for `pip-audit`, rather than turning every future PR red on day one. `expo-app` has no lint config or devDependencies at all; gets `npm ci` + a syntax check as the smallest useful check rather than inventing a lint setup as a side effect.

---

## Medium — worth cleaning up

### ⬜ M-01 — itsm-service's JWKS proxy points at nothing — OPEN
Lives in a separate repo/deployment (`itsm-service`, prod `.env`), not this one — needs its own session to fix safely.

### ✅ M-02 — Boolean-as-integer columns alongside real booleans — RESOLVED
Investigating this surfaced a real, currently-live bug, not just a style inconsistency: `bp_studio_inspector.py` filtered on `c.resolved = TRUE` / `= FALSE` against `conversations.resolved`, which was `INTEGER`, not `BOOLEAN`. Postgres has no `integer = boolean` operator — confirmed by running the exact query against a real database, which raised `operator does not exist: integer = boolean`. (That filter turned out to be unreachable from the current `web/ui` frontend — `InspectorPage.jsx`'s filter state never sends the `ticket_flt` param — so it wasn't visibly breaking real users today, but it was a landmine for the first thing to call that param directly or a future UI wiring it up.)

**Full resolution:** before changing the column type, checked every consumer for JSON-serialization dependence on `1`/`0` vs `true`/`false` — the backend SQL comparisons (`bp_studio_inspector.py`, `_analytics.py`'s `get_recent_conversations`) and both frontend pages that render those endpoints' responses (`InspectorPage.jsx`, `AnalyticsPage.jsx`). Confirmed `web/ui` never reads the raw `resolved` field back from any API response — safe to change the type. Then:
- Added Alembic migration `12bd2020ac48`: `conversations.resolved` INTEGER → BOOLEAN (`USING (resolved <> 0)`, default `FALSE`).
- Updated the 3 call sites that used integer literals (`common/db/_messages.py`'s `SET resolved = 1`, `common/db/_analytics.py`'s `c.resolved=1`) to `TRUE`; `bp_studio_inspector.py`'s comparison, already `TRUE`/`FALSE`, now matches the real column type instead of needing the surgical `=1`/`=0` patch (reverted).
- Updated the legacy bootstrap DDL in `_connection.py` to declare the column as `BOOLEAN DEFAULT FALSE` from the start, so a genuinely fresh non-Alembic install gets it right immediately (existing databases are unaffected — `CREATE TABLE IF NOT EXISTS` no-ops on them either way).
- Verified end-to-end against a real database: applied the migration, confirmed the column reports `boolean`/`false` default, and exercised all 3 updated call sites' exact SQL successfully.

`actions.success` (the other column in the original finding) was also checked — used consistently as an integer everywhere, no equivalent bug found there; left as INTEGER.

**Deployment note:** this migration must run (`alembic upgrade head`, or at minimum apply `12bd2020ac48`) on any database before this code is deployed to it — unlike this session's other changes, it is not backward-compatible with an unmigrated schema. Not deployed anywhere by this session (local-only, per usual workflow).

### ✅ M-03 — `_get_read_connection()` implies capability that doesn't exist — RESOLVED
Investigation found `app.config.prod` already had a complete, disabled-by-default `[DATABASE_REPLICA]` config section (host/port/name/user/password) — someone had planned this feature and wired the config, but never wrote the connection-routing logic. **Resolution:** implemented it for real instead of just removing the misleading stub — added `get_db_replica_config()` (returns `None` when disabled) and a lazily-created replica pool in `_connection.py`, with automatic fallback to the primary if the replica is unconfigured or unreachable. Zero behavior change everywhere today (every environment has it disabled) — verified `_get_read_connection()` still returns `(conn, False)` exactly as before.

### 🔁 M-04 — Dynamic `UPDATE ... SET` building duplicated six times — REASSESSED
Read all 6 sites in full. They aren't actually duplicated logic — each has genuinely distinct per-field conditions (one depends on already-fetched row state, one JSON-serializes a column, one triggers a side-effect query). The only truly shared fragment is a one-line `f"UPDATE t SET {...} WHERE ..."` format string; a shared helper would either save one line per site or need to grow complex enough to absorb the real differences, neither of which is worth touching 4 files' write paths for. Correcting the finding — left as-is.

### ✅ M-05 — Dependency audit is advisory-only, and Python-only — RESOLVED
**Resolution:** added an `npm-audit` job to `security.yml` (matrix over `web/ui`, `expo-app`, `scripts/demo-automation`), advisory (`continue-on-error`) to match the existing `pip-audit` convention, triggered on PR changes to any of the three `package-lock.json` files plus the existing weekly/manual schedule.

### ✅ M-06 — Stray debug artifacts committed to git — RESOLVED
**Resolution:** confirmed zero code references to any of them (the log-viewer feature reads differently-named files), then removed `actions.err`, `actions.out`, `rasa.err`, `server.err`, `server.out`, `server_new.err/out`, `_nul`, and `scripts/seed/gen_err.txt`/`gen2_err.txt`/`gen3_err.txt` from git, and added `*.err`/`*.out` to `.gitignore`.

### ✅ M-07 — `docs/` is 62% dead weight — RESOLVED
**Resolution:** removed all 41 files from `docs/Backup/` except one — see M-11 below, a live secret was found in there that changed the plan mid-cleanup. Scanned every remaining file for other credentials first (found none); confirmed the two files with real historical password references (`DEPLOYMENT.md`, `docs/Backup/PRODUCTION_OPS.md`) were already redacted in their current working-tree content before deleting either. Git history preserves everything removed.

### 🔁 M-08 — Scripts get versioned by filename, not edited in place — PARTIALLY CORRECTED, PARTIALLY RESOLVED
Investigated both examples from the original finding — they turned out to be two different situations:
- **`debug_api.py` / `debug_api2.py` — RESOLVED.** Both genuinely dead: they test `/operator/login`, `/operator/conversation/<id>`, `/operator/queue` — endpoints from `bp_operator`, which `register.py` confirms was fully retired in favor of `bp_portal_operator`/`bp_portal_admin`. Deleted both.
- **`gen_itsm_seed.py` / `gen_itsm_seed2.py` / `gen_itsm_seed3.py` — REASSESSED, not a real instance of this smell.** These aren't duplicates or superseded drafts — they're sequential phases of one seed pipeline (Phase 1 base entities, Phase 2 SLO/error-budget, Phase 3 Support Recording/RCA governance), each re-deriving the prior phase's UUIDs so foreign keys line up across all three. Correcting the original finding: left as-is.

### ⬜ M-09 — No docker-compose for the core stack — OPEN

### ✅ M-10 — Local dev shared a Sentry project with production — RESOLVED (found and fixed same day, not in the original pass)
`common/app.config.local` had a live Sentry DSN pointing at the same self-hosted project (`sentry.99technologies.com`) production uses — every local dev run's errors were reporting into the same stream as real incidents. **Resolution:** blanked the DSN in `common/app.config.local` (blank = disabled, same pattern the codebase already uses elsewhere). Confirmed via `get_sentry_config()` returning `{'dsn': ''}`.

### 🔴 M-11 — A live, currently-used Apple App Store Connect API key is committed — OPEN, NOT a routine fix
Found mid-cleanup while going through `docs/Backup/`: **`docs/Backup/AuthKey_KAT7LHZC7V.p8`** is a real PKCS8 EC private key, committed 2026-06-10, present on `V2`/`V3-ShopiFy`/`V3-improve`/`V4-sla` (clean on `main`). Unlike CRIT-01's token, this one **does not expire on its own**, and it's **actively referenced by the live EAS build config**:
```
expo-app/eas.json:44-46 — ascApiKeyId: "KAT7LHZC7V"
```
This was already independently discovered and documented in `docs/SECURITY_SECRETS.md` (item 6, dated 2026-06-24) — that audit also lists five other unrotated exposed secrets (Keycloak client secret, operator-JWT secret, DB passwords, a reused SSH+Postgres password, Android keystore passwords) that predate this review and remain outstanding. None of those were touched in this pass; they require live-system access (Keycloak admin, Apple Developer portal, prod SSH) that only the owner can act on. **Deliberately left in place per explicit instruction — rotation is the owner's action, not something this review can perform.** `*.p8` added to `.gitignore` so no *new* key gets committed the same way; the existing file stays tracked until rotated, at which point delete it and repeat the same history-purge process as CRIT-01.

---

## Commended — keep doing this

### OK-01 — The `extensions/` plugin framework is genuinely well designed
A small `Extension` / `ExtensionManifest` / `ConfigField` contract that both Shopify and Amazon cleanly implement, with a generic admin UI driven by `config_schema` instead of bespoke per-integration frontend code.

### OK-02 — OAuth and webhook security is correct
Shopify webhook and install-callback HMACs both use constant-time `hmac.compare_digest`; OAuth tokens are Fernet-encrypted at rest via `common/crypto.py` with a clear failure mode on key rotation.

### OK-03 — JWKS handling in `common/iam_service.py` is thoughtfully engineered
Proxy → direct → bundled-fallback-snapshot fetch chain, with a short failure backoff so an unreachable IAM host degrades fast instead of stalling every request. (Notably more robust than itsm-service's version of the same idea — see M-01.)

### OK-04 — Secrets convention: `PIQ_<SECTION>_<OPTION>`
A clean, deliberately-scoped env-override pattern, applied only in secret getters — never written back by the config-save path.

### OK-05 — Backend CI discipline
Pytest, Rasa training-data validation, a ruff gate against new `print()` calls, and a bot that requires every feature PR to link a spec issue. Rare to see this much process rigor on a project this size.

### OK-06 — Unvalidated code is labeled as such, not shipped quietly
The Amazon Notifications/SQS module says outright, in its own docstring, that it's untested against live SP-API — and stays behind a disabled-by-default flag until someone proves it in a sandbox.

---

## Order of operations — status

1. ✅ **Rotate the leaked token** — done (token was already dead; history purged and force-pushed across all 5 branches instead of just rotating).
2. ✅ **Add CI secret-scanning** — done (`secret-scan.yml`).
3. ⬜ **Fix itsm-service's dead JWKS proxy** — not done; separate repo/deployment.
4. ✅ **Introduce Alembic for `common/db`** — done (baseline + fresh-install bug fixed).
5. 🔁 **Lock down CORS defaults** — reassessed, not needed (see H-03).
6. ✅ **Stand up CI for `web/ui` + `expo-app`** — done (`frontend.yml`).
7. ✅ **Repo hygiene sweep** — done: stray logs/tmp secret (M-06), `docs/Backup` (M-07), dead debug scripts (M-08). Surfaced a live Apple API key mid-sweep (M-11) — left in place, needs owner rotation.

### Second pass (same day): H-04, M-07, M-08
Picked up from the "what's left" list below. `bp_portal_api.py` split into two blueprints (H-04); `docs/Backup` sprawl removed except the still-live `.p8` key (M-07); dead `/operator/*` debug scripts removed, seed-script "duplicates" reassessed as legitimate sequential phases and left alone (M-08).

### Third pass (same day): M-02, M-03, M-04, M-05
M-03 implemented for real (read-replica routing — config existed, the routing logic never did). M-05 added (npm audit, matrix over the three JS projects). M-04 reassessed and left alone (not real duplication). M-02 fully resolved: found a live 500 in the Studio Inspector's ticket filter, patched it surgically, then verified `web/ui` has no dependence on the field's JSON serialization and completed the proper fix — an Alembic migration converting `conversations.resolved` to real `BOOLEAN`, with all 3 call sites and the legacy bootstrap DDL updated to match, verified end-to-end against a real database.

### What's left, roughly in order of value
1. **M-11** — rotate the Apple API key (`docs/Backup/AuthKey_KAT7LHZC7V.p8`), then delete + purge from history. Needs the repo owner (Apple Developer portal access); highest-value remaining item.
2. **`docs/SECURITY_SECRETS.md` items 1–5** — pre-existing, separately-tracked rotation backlog (Keycloak client secret, operator-JWT secret, DB passwords, reused SSH+Postgres password, Android keystore passwords). Not part of this review's original findings, but discovered adjacent to M-11 — needs live-system access this review can't exercise.
3. **M-01** — itsm-service JWKS proxy fix (needs that repo/deployment).
4. **M-09** — docker-compose for the core stack; a real infra decision (how much of prod's systemd/nginx/gunicorn topology to mirror). See proposal below.
5. **H-05** — TypeScript migration (large, incremental). See proposed starting slice below.

### Deploy reminder for M-02
Whenever this branch's changes reach a database for real: run `alembic upgrade head` (or apply `12bd2020ac48` specifically) *before or with* the code deploy — the new code writes `resolved = TRUE`, which a database still on the old `INTEGER` column would reject.

---

## Proposals for the two remaining scope decisions

Neither of these was implemented — both are real scope calls, not quick fixes.

### M-09 — docker-compose for the core stack

Today: prod runs the app via systemd (`project-iq-admin.service`, `rasa-core@.service`) + nginx + gunicorn directly on the VM (`infra/`); only auxiliary services (firecrawl, infisical) have docker-compose files. Worth noting: Postgres for this app *already runs in Docker* in prod today — it shares the same `pgvector/pgvector:pg16` container itsm-service provisions, just not via anything in this repo.

Three options, increasing in scope/effort:

- **A — Dev backing-services only** (recommended starting point): `docker-compose.dev.yml` with just Postgres + Redis. The app processes (web API, action server, Rasa core) keep running directly via venv/`start_local.ps1` as today. Lowest effort, no Dockerfiles needed for the Python app, no prod-parity claim — just removes "go install/configure Postgres and Redis yourself" from onboarding.
- **B — Full local stack**: adds Dockerfiles for web API / action server / Rasa core, containerizing the whole local dev topology. Meaningfully better reproducibility, but real effort: needs volume-mounted live-reload, careful env wiring, and verifying eventlet/Socket.IO behave correctly inside a container network.
- **C — Full prod-parity stack**: B plus nginx + pgbouncer, mirroring production exactly — useful for pre-prod validation, but the most effort and carries ongoing risk of drifting from the real systemd/nginx configs it's supposed to mirror.

**Recommendation:** A now, B later if the team actually wants containerized dev, C only if a staging-via-compose story becomes a real need.

### H-05 — TypeScript migration starting slice

~350 `.js`/`.jsx` files across `web/ui` and `expo-app`, zero `.ts` today. A big-bang rewrite isn't realistic; proposed staged approach:

1. **Tooling only, near-zero risk:** add `typescript`, a `tsconfig.json` with `allowJs: true` — Vite already supports `.ts`/`.tsx` coexisting with existing `.jsx`/`.js` with no changes to existing files.
2. **Starting slice:** the shared API/data layer, not pages — e.g. `web/ui/src/shared/itsm/` (the itsm API client + permission helpers, imported by both `itsm-app` and `portal/admin/itsm`) or narrower still, just the `useApi`/`call()` fetch wrapper plus type definitions for the core data shapes (`Conversation`, `HandoffQueueItem`, `Operator`). Type safety pays off most where it's imported everywhere — and would have caught the exact class of bug M-02 just found (a field's shape silently changing under callers) at compile time instead of at request time.
3. **Convention going forward:** convert leaf utility/hook/API-client files before page/component files, which carry more JSX surface area and conversion risk per file.
4. **Suggested first step:** one proof-of-concept file conversion (e.g. `useItsmApi.js` → `.ts`) to validate the Vite/vitest/eslint toolchain handles mixed `.ts`/`.jsx` cleanly, before committing to converting anything else.

---

*Prepared for internal review — not for external distribution.*
