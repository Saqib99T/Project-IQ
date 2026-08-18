# Project IQ — Architecture & Code Review

**Date:** 2026-08-18 (eight remediation passes same day)
**Branch reviewed:** V3-Shopify
**Scope:** `core/`, `action_server/`, `common/` (backend + IAM), `extensions/` + `shopify-app/` (commerce integrations), `web/` + `expo-app/` (frontends), `.github/` + `infra/` + `scripts/` + `docs/` (CI/infra/hygiene)
**Status:** 15 resolved (one uncovered and fixed a live bug, another a live leaked credential, another a live production incident during its own fix), 3 reassessed (corrected, no action needed), 1 in progress by design (a complete, bounded slice of it finished), 6 patterns commended. Every item from the original review is now resolved, reassessed, or (H-05 only, by design) partially done.

An interactive version of the original findings (severity color-coding, at-a-glance counts) is also available as a published artifact; this file is the durable, versioned copy and the one that gets updated as items close.

---

## At a glance

| Resolved | Reassessed | In progress | Commended |
|---|---|---|---|
| 15 | 3 | 1 | 6 |

**H-05** (TypeScript) is the only item not fully closed, deliberately — it's multi-session by design. Tooling is in place and the entire proposed "starting slice" (`web/ui/src/shared/itsm/`, 15/15 files) is fully converted with real types (see the sixth- and seventh-pass notes below); the rest of the ~350-file frontend is left for follow-up sessions. **M-01** (itsm-service's JWKS proxy), **M-09** (docker-compose for local dev), and **M-11** (the Apple key) are now resolved — see the fifth, eighth, and fourth-pass notes below. The `docs/SECURITY_SECRETS.md` items 1–5 backlog (Keycloak client secret, operator-JWT secret, DB passwords, reused SSH+Postgres password, Android keystore passwords) remains completely untouched — it's outside this review's original findings and still needs a scheduled maintenance window.

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

### 🟢 H-05 — Zero TypeScript across the entire frontend — SHARED/ITSM SLICE COMPLETE
Not a drop-in fix — intentionally a multi-session effort. Two passes so far: tooling + one proof-of-concept file (sixth pass), then the rest of `web/ui/src/shared/itsm/` — all 15 files, 100% of the proposed starting slice (see the seventh-pass note below). ~350 files remain across the rest of `web/ui` and `expo-app` for future sessions.

### ✅ H-06 — No frontend CI — RESOLVED
**Resolution:** added `.github/workflows/frontend.yml`. Verified locally before wiring anything in: `web/ui`'s vitest suite (27/27) and all three build targets (default/widget/portal/itsm) pass, so those are blocking checks. Lint has 1,621 pre-existing findings never triaged before — wired as advisory (`continue-on-error`), matching the same pattern this repo already uses for `pip-audit`, rather than turning every future PR red on day one. `expo-app` has no lint config or devDependencies at all; gets `npm ci` + a syntax check as the smallest useful check rather than inventing a lint setup as a side effect.

---

## Medium — worth cleaning up

### ✅ M-01 — itsm-service's JWKS proxy points at nothing — RESOLVED
Lives in a separate repo/deployment (`itsm-service`, prod `.env`), not this one.

**Diagnosis first, not a blind fix:** the code (`app/auth/jwks.py`) already implements the same proxy → direct → bundled-fallback chain as this repo's `common/iam_service.py` — nothing wrong with the logic. Tested actual connectivity from inside the running container: direct HTTPS to the IAM JWKS endpoint succeeded in 0.17s. The SOCKS proxy (`socks5://172.21.0.1:1080`, nothing listening) wasn't solving a real problem — direct access works fine on its own.

**Resolution:** removed `IAM_JWKS_PROXY` from prod's `.env` (backed up first to `.env.bak-20260818-182213`).

**Applying it was not clean and is worth recording honestly.** The host's `docker-compose` is v1.29.2, which has a known compatibility bug (`KeyError: 'ContainerConfig'`) with the current Docker Engine when recreating a container — it fails, but only *after* stopping/renaming the old one, so a naive `--force-recreate` leaves the service down with no automatic rollback. This happened twice before the actual fix landed:
1. `docker-compose up -d --force-recreate api` (no `--no-deps`) also pulled in `db` and `redis` as dependencies — Redis was stopped and left down for ~20s before caught and restarted. `db` hit a naming conflict and was never actually touched.
2. `docker-compose up -d --force-recreate --no-deps api` correctly scoped to just `api`, but still hit the same bug — the API container was down for ~15-20s before caught and restarted (from the old, unmodified config, so the underlying fix still hadn't been applied at this point).

Both recoveries were immediate (start the stopped container back up) and verified clean afterward (health checks, worker logs, no data loss). The bug's actual trigger: `docker-compose`'s recreate path tries to merge anonymous-volume config from the *existing* container, which breaks in this Engine version — this container only uses two explicit bind mounts (no anonymous volumes), so removing the old container first (`docker stop` + `docker rm`, after saving its full `docker inspect` config as a manual-recreate fallback) let a fresh `docker-compose up -d --no-deps api` create the replacement cleanly with no old container to merge against. That worked.

**Verified end-to-end**, not just "container is up": the new container's env no longer has `IAM_JWKS_PROXY`; directly invoked `app.auth.jwks.refresh_jwks()` inside the running container and confirmed it populated the key cache with real keys over the direct connection; full request chain (nginx → the app) and Celery workers both confirmed healthy afterward.

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

### ✅ M-09 — No docker-compose for the core stack — RESOLVED (Option A)
Implemented the recommended Option A from the proposal below (see the eighth-pass note) — `docker-compose.dev.yml` for Postgres (pgvector) + Redis only, app processes still run directly via venv. Verified end-to-end, not just syntax-checked: brought the stack up (on temporary alternate ports — this dev machine already has its own itsm-service Postgres/Redis containers bound to 5432/6379), confirmed both health checks pass, created the `vector` extension successfully, and connected with `psycopg2` using the exact credentials the app itself uses. Fully torn down afterward.

### ✅ M-10 — Local dev shared a Sentry project with production — RESOLVED (found and fixed same day, not in the original pass)
`common/app.config.local` had a live Sentry DSN pointing at the same self-hosted project (`sentry.99technologies.com`) production uses — every local dev run's errors were reporting into the same stream as real incidents. **Resolution:** blanked the DSN in `common/app.config.local` (blank = disabled, same pattern the codebase already uses elsewhere). Confirmed via `get_sentry_config()` returning `{'dsn': ''}`.

### ✅ M-11 — A live, currently-used Apple App Store Connect API key was committed — RESOLVED
Found mid-cleanup while going through `docs/Backup/`: **`docs/Backup/AuthKey_KAT7LHZC7V.p8`** was a real PKCS8 EC private key, committed 2026-06-10, present on `V2`/`V3-ShopiFy`/`V3-improve`/`V4-sla` (clean on `main`). Unlike CRIT-01's token, this one didn't expire on its own, and it was actively referenced by the live EAS build config (`expo-app/eas.json`).

This was already independently discovered and documented in `docs/SECURITY_SECRETS.md` (item 6, dated 2026-06-24) — that audit also lists five other unrotated exposed secrets (Keycloak client secret, operator-JWT secret, DB passwords, a reused SSH+Postgres password, Android keystore passwords) that predate this review and remain outstanding, untouched here — they require live-system access (Keycloak admin, prod SSH) only the owner can act on.

**Resolution:** the owner revoked key ID `KAT7LHZC7V` in App Store Connect and generated a replacement (`VP6WWM4XHN`), updated `expo-app/eas.json` to point at it, and stored the new key outside the repo (`expo-app/secrets/`, gitignored — verified not tracked). Only then was history purged, in that order deliberately: purging git history without rotating first would only have hidden the leak, not neutralized it, since anyone who already had the old key would still be able to use it.

The purge itself needed a second pass: the file had been renamed at one point (`docs/AuthKey_KAT7LHZC7V.p8` → `docs/Backup/AuthKey_KAT7LHZC7V.p8` in an earlier commit), and `git filter-repo --path` matches exact historical paths, not renames — the first pass only stripped the post-rename path and left the same blob reachable at the pre-rename one. Caught by checking the actual blob hash across all objects rather than trusting a path-based search, before anything was pushed. Second pass targeted both paths, verified clean by blob hash after an aggressive `git gc`, then pushed to all 4 affected branches and synced local refs the same way as CRIT-01.

`*.p8` is in `.gitignore` (both the repo root's and `expo-app/`'s) so this can't recur silently.

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

### Fourth pass (same day): M-11
The owner rotated the Apple key in App Store Connect (revoked `KAT7LHZC7V`, issued `VP6WWM4XHN`, updated `expo-app/eas.json`, stored the new key outside the repo) before any history was touched — rotation neutralizes the exposure; purging history without it would only hide the evidence while the old key stayed valid. History purge needed two attempts: the file had been renamed early in its history (`docs/AuthKey_KAT7LHZC7V.p8` → `docs/Backup/AuthKey_KAT7LHZC7V.p8`), and `git filter-repo --path` doesn't follow renames, so the first pass only stripped the post-rename path. Caught by verifying via blob hash rather than trusting a path search, before pushing anything. Second pass targeted both paths, verified clean, pushed to all 4 affected branches.

### Fifth pass (same day): M-01
See the M-01 section above for the full account, including two brief production incidents (Redis and the API container each down for ~15-20s) caused by a `docker-compose` 1.29.2 bug encountered while applying the fix — both caught and recovered immediately, no data loss, verified end-to-end afterward.

### Sixth pass (same day): H-05, steps 1 and 4 of the proposal below
- **Tooling**: added `typescript` (^7.0.2), `web/ui/tsconfig.json` (`allowJs: true`, `strict: false` — incremental adoption, not repo-wide strictness on day one), and a `typecheck` npm script wired into `frontend.yml` as a blocking CI step (unlike lint, this passes clean today with zero errors, so no reason to make it advisory).
- **Proof-of-concept conversion**: `web/ui/src/shared/itsm/useItsmApi.js` → `.ts` (71 other files import it, none by extension, so nothing else needed to change). Added real types — request/response generics on `call`/`get`/`post`/`put`/`patch`/`remove`, an `ApiError` interface, typed shapes for the tenant/user-directory and KB-article responses — not just `: any` everywhere. `tsc --noEmit` passes with zero errors. Verified the whole toolchain handles the mix correctly: vitest (27/27, including this file's existing test, unmodified), the default build and the `itsm` build target (the heaviest consumer), all pass. Confirmed eslint doesn't yet cover `.ts` files (silently skips them) — deliberately left the `.ts`-ESLint setup for a follow-up rather than scope-creeping this pass; `tsc` already catches the correctness class of bug that mattered here.
- Steps 2 (converting the rest of the shared layer) and 3 (established convention for future files) are intentionally left for follow-up sessions — see the original proposal below, now partially executed.

### Seventh pass (same day): H-05, the rest of `web/ui/src/shared/itsm/`
All 14 remaining files converted (`cn.js`, `useItsmPermissions.js` → `.ts`; `ItsmTenantContext`, `TenantSwitcher`, `primitives`, `ui`, `Pagination`, `AccessLevelField`, `reportSections`, `CommentsSection`, `GlobalSearch`, `TicketEditPanel`, `TicketSlaPanel`, `ReferenceDataManager` → `.tsx`), completing the folder — 15/15 files, matching the original proposal's "starting slice" exactly.

Real types throughout, not blanket `any`: request/response shapes per endpoint, a shared `DataTableColumn<T>` generic in `ui.tsx` reused by `ReferenceDataManager`'s dynamic config-driven columns, `LucideIcon` typing on every icon prop, a generic `ReferenceRow = Record<string, any>` explicitly documented as intentional (this component is generic over every reference-entity type in the app — departments, categories, vendors, KB tags — so a per-entity interface isn't the right shape here). Tightened `useItsmApi.ts`'s `ItsmResourceState.error` from `unknown` to `Error | null` while doing this — every real caller reads `.message` off it, so the looser type was just forcing an unsafe cast at each call site instead of once, at the source.

Verified end-to-end after all 15 files: `tsc --noEmit` clean (zero errors), all 27 vitest tests pass unmodified, and all 4 build targets succeed (default, widget, portal, and `itsm` — the heaviest consumer of this folder). eslint still doesn't cover `.ts`/`.tsx` (unchanged from the sixth pass) — confirmed the overall lint problem count *dropped* (1644→1641) simply because 14 fewer files are in its scan glob, not because of any new issue elsewhere.

### Eighth pass (same day): M-09, Option A
Added `docker-compose.dev.yml` (Postgres via `pgvector/pgvector:pg16` + Redis via `redis:7-alpine`) — the option recommended in the original proposal, not B or C. This dev machine already had its own itsm-service Postgres/Redis containers bound to the standard ports, which incidentally confirms the problem this solves: local Postgres for this app has only ever come from *happening to* have the sibling itsm-service repo checked out and running, since the "Chatbot" database lives in the same instance as itsm-service's `itsm_db` (see the M-01 investigation). Verified for real rather than just syntax-checked: brought the stack up on temporary alternate ports to avoid the existing local containers, confirmed both health checks pass, ran `CREATE EXTENSION vector` successfully, and connected with `psycopg2` using the exact host/user/db credentials the app itself would use — then fully tore it down. Added a pointer in `.env.example` so the instructions are discoverable from the file someone actually copies to get started.

### What's left, roughly in order of value
1. **`docs/SECURITY_SECRETS.md` items 1–5** — pre-existing, separately-tracked rotation backlog (Keycloak client secret, operator-JWT secret, DB passwords, reused SSH+Postgres password, Android keystore passwords). Not part of this review's original findings — needs a scheduled maintenance window and live-system access this review hasn't exercised.
2. **H-05 (continued)** — expand outward from `shared/itsm/` into `portal/`, `itsm-app/`, and `widget/`; set up `@typescript-eslint` now that there's a real body of `.ts`/`.tsx` to justify it.
3. **M-09, options B/C** — only if the team actually wants full containerized dev or a prod-parity staging story; Option A already solves the actual onboarding gap.

### Unrelated finding from the M-01 work: itsm-service's `docker-compose` is outdated
v1.29.2 has a known compatibility bug with the current Docker Engine that makes `--force-recreate` unreliable on any service with anonymous volumes tied to an existing container (worked around this time by removing the old container first). Worth a deliberate upgrade to the `docker compose` v2 plugin during a maintenance window, rather than working around this bug every time a container needs recreating.

### Deploy reminder for M-02
Whenever this branch's changes reach a database for real: run `alembic upgrade head` (or apply `12bd2020ac48` specifically) *before or with* the code deploy — the new code writes `resolved = TRUE`, which a database still on the old `INTEGER` column would reject.

---

## Proposals for the two remaining scope decisions

Neither of these was implemented — both are real scope calls, not quick fixes.

### M-09 — docker-compose for the core stack (Option A implemented — see eighth pass above)

Today: prod runs the app via systemd (`project-iq-admin.service`, `rasa-core@.service`) + nginx + gunicorn directly on the VM (`infra/`); only auxiliary services (firecrawl, infisical) have docker-compose files. Worth noting: Postgres for this app *already runs in Docker* in prod today — it shares the same `pgvector/pgvector:pg16` container itsm-service provisions, just not via anything in this repo.

Three options, increasing in scope/effort:

- ✅ **A — Dev backing-services only** (recommended starting point, now implemented): `docker-compose.dev.yml` with just Postgres + Redis. The app processes (web API, action server, Rasa core) keep running directly via venv/`start_local.ps1` as today. Lowest effort, no Dockerfiles needed for the Python app, no prod-parity claim — just removes "go install/configure Postgres and Redis yourself" from onboarding.
- **B — Full local stack**: adds Dockerfiles for web API / action server / Rasa core, containerizing the whole local dev topology. Meaningfully better reproducibility, but real effort: needs volume-mounted live-reload, careful env wiring, and verifying eventlet/Socket.IO behave correctly inside a container network.
- **C — Full prod-parity stack**: B plus nginx + pgbouncer, mirroring production exactly — useful for pre-prod validation, but the most effort and carries ongoing risk of drifting from the real systemd/nginx configs it's supposed to mirror.

**Recommendation:** A now, B later if the team actually wants containerized dev, C only if a staging-via-compose story becomes a real need.

### H-05 — TypeScript migration starting slice (all 4 steps now done — see sixth and seventh passes above)

~350 `.js`/`.jsx` files across `web/ui` and `expo-app`, zero `.ts` before this pass. A big-bang rewrite isn't realistic; staged approach:

1. ✅ **Tooling only, near-zero risk:** add `typescript`, a `tsconfig.json` with `allowJs: true` — Vite already supports `.ts`/`.tsx` coexisting with existing `.jsx`/`.js` with no changes to existing files. Done.
2. ✅ **Starting slice:** the shared API/data layer, not pages — `web/ui/src/shared/itsm/`, all 15 files (the itsm API client, permission helpers, design-system primitives, and every ticket/tenant/reference-data component imported by both `itsm-app` and `portal/admin/itsm`). Type safety pays off most where it's imported everywhere — and would have caught the exact class of bug M-02 found (a field's shape silently changing under callers) at compile time instead of at request time. Done, complete.
3. 🔁 **Convention going forward:** convert leaf utility/hook/API-client files before page/component files, which carry more JSX surface area and conversion risk per file. Followed within this slice (utilities and context first, the large generic `ReferenceDataManager` last); not yet written down as a documented team convention for files outside this folder.
4. ✅ **Proof-of-concept file conversion:** `useItsmApi.js` → `.ts`, with real types (not blanket `any`) on every exported function. Validated the Vite/vitest toolchain handles mixed `.ts`/`.jsx` cleanly — `tsc --noEmit` passes with zero errors, all 27 vitest tests pass, all 4 build targets succeed. eslint doesn't cover `.ts` yet (`@typescript-eslint` setup deferred to when there's more converted code outside this one folder to justify it).

---

*Prepared for internal review — not for external distribution.*
