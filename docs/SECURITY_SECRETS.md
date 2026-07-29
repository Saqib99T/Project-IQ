# Secrets handling & rotation

## How secrets are loaded

Secrets are **no longer stored in the tracked `app.config*` files**. They are
supplied at runtime via environment variables and read by
[common/config_manager.py](../common/config_manager.py) through the
`_env_secret()` helper:

```
PIQ_<SECTION>_<OPTION>   # uppercased; matches the app.config [SECTION] + option
```

When the env var is set it wins; otherwise the (now-blank) file value is used.
The override is applied **only inside the secret getters**, never in
`load_config()`/`save_config()`, so a runtime secret can never be written back
into a tracked file via the admin "save config" path.

- **Local dev:** put values in a git-ignored `.env` at the repo root (auto-loaded
  by `python-dotenv`). See [.env.example](../.env.example) for the variable names.
- **Server (prod/staging):** set the same `PIQ_*` vars as real environment
  variables — `Environment=` lines in the systemd units
  ([infra/](../infra/)) or the service's env file. The server keeps its own
  hand-maintained `app.config`; deploys do **not** overwrite it.

| Env var | Config location | Used for |
|---|---|---|
| `PIQ_IAM_BACKEND_CLIENT_SECRET` | `[IAM] backend_client_secret` | Keycloak confidential-client auth (token exchange, service accounts) |
| `PIQ_DATABASE_DB_PASSWORD` | `[DATABASE] db_password` | Primary Postgres |
| `PIQ_DATABASE_REPLICA_DB_REPLICA_PASSWORD` | `[DATABASE_REPLICA] db_replica_password` | Read replica (if enabled) |
| `PIQ_HANDOFF_OPERATOR_JWT_SECRET` | `[HANDOFF] operator_jwt_secret` | Signs operator-dashboard JWTs |
| `PIQ_HANDOFF_SMTP_PASSWORD` | `[HANDOFF] smtp_password` | Transcript-email SMTP |
| `PIQ_HANDOFF_LLM_API_KEY` | `[HANDOFF] llm_api_key` | Anthropic key (if LLM summary enabled) |
| `PIQ_KNOWLEDGE_BASE_KB_BOT_CLIENT_SECRET` | `[KNOWLEDGE_BASE] kb_bot_client_secret` | KB-bot service account → itsm-service |

## ⚠️ Exposed secrets — ROTATE these

The following real values were committed to git history and must be treated as
compromised. Removing them from the working tree (done) does **not** remove them
from history — **rotation is what neutralizes the exposure.**

1. **Keycloak backend client secret** (`project-iq-backend`) — was committed in
   `app.config` + `app.config.local` (dev realm `99-iam`).
   → In Keycloak admin: regenerate the client secret for `project-iq-backend`.
   Update `PIQ_IAM_BACKEND_CLIENT_SECRET` in local `.env` **and** on the server.
   If the **prod** realm's client uses a different secret, rotate it too.

2. **Operator-dashboard JWT secret** — was committed in
   `app.config.prod` (and a dev value in `app.config.local`).
   → Generate a new random secret (e.g. `python -c "import secrets;print(secrets.token_urlsafe(48))"`).
   Set `PIQ_HANDOFF_OPERATOR_JWT_SECRET` locally + on the server.
   **Note:** rotating invalidates all active operator sessions — operators must re-login.

3. **Any real DB password** the server uses → rotate the Postgres role password
   and set `PIQ_DATABASE_DB_PASSWORD` on the box. (The committed values `12345`
   / `itsm_pass` were dev defaults.)

4. **Prod server SSH password + Postgres `postgres` password** — the **same**
   value was committed (as the SSH password and reused as the DB password) in
   `DEPLOYMENT.md`, `docs/Backup/PRODUCTION_OPS.md`, `status.sh`,
   `scripts/status.sh`, and `status/app.py` (now removed; those scripts read
   `PGPASSWORD` / `PIQ_DATABASE_DB_PASSWORD` from the environment).
   → Change the Linux `user` account password (and prefer key-based SSH only).
   → Rotate the Postgres `postgres` role password; set `PGPASSWORD` /
   `PIQ_DATABASE_DB_PASSWORD` on the box. **Stop reusing one secret for both.**

5. **Android keystore / key passwords** — were in `expo-app/CREDENTIALS.md`
   (now redacted; real values in the git-ignored
   `expo-app/credentials/android/keystore.env` + EAS account).
   A signing keystore **cannot be rotated** (Google Play is bound to its SHA1).
   The keystore *file* was never committed (git-ignored), so the passwords alone
   are low-risk, but treat them as sensitive and rely on the redacted doc going
   forward.

6. **Apple private key** (`docs/Backup/AuthKey_KAT7LHZC7V.p8`, a PKCS8 EC key —
   the naming convention Apple uses for APNs/MusicKit/Sign-in-with-Apple auth
   keys) — committed 2026-06-10 ("just backup"), found 2026-07-29, not
   previously tracked here. Still present in the working tree as of this
   writing — owner is rotating on their own timeline.
   → In the Apple Developer portal, revoke the key with this Key ID
   (`KAT7LHZC7V`) and issue a replacement; update wherever the old key was
   configured (APNs cert config, CI secrets, etc.).
   → Once rotated, delete `docs/Backup/AuthKey_KAT7LHZC7V.p8` from the working
   tree — rotation neutralizes the exposure, same as every item above; the
   file removal is just cleanup, not the fix.

> **Optional, heavier:** purge the values from git history with `git filter-repo`
> (rewrites history → everyone re-clones). Rotation above is sufficient to
> neutralize the leak; do this only if policy requires scrubbing history.

## Deploy prerequisite (do NOT skip)

Before deploying this change to a server, ensure every `PIQ_*` var that the
server needs is set in its environment. Because the tracked config values are
now blank, a deploy that *also* overwrote the server's `app.config` without the
env vars set would break IAM auth, DB connections, and operator login. The
server's own `app.config` is not overwritten by the current deploy flow, but
verify before/after deploy:

```
systemctl show project-iq-admin -p Environment   # confirm PIQ_* present
```

## Status & verification (checked 2026-06-24)

Re-verified the working tree — **all real secrets remain blank** in every
tracked `app.config*` (`backend_client_secret`, `kb_bot_client_secret`,
`operator_jwt_secret`, `smtp_password`, `llm_api_key`, `db_replica_password`
are empty; the only non-blank values are dev defaults — `db_password = 12345`,
`firecrawl_api_key = fc-selfhosted`). So nothing *new* has leaked since the last
sweep; the **rotation actions in the section above are still outstanding** (they
neutralize the *historical* commits and are unaffected by clearing the tree).

Two changes since the original sweep:

- **Operator-dashboard JWT (item 2) — surface being retired.** The operator
  console moved to **IAM-only** auth: `bp_operator` and the legacy operator
  dashboard were removed, and the portal now authenticates with the IAM token
  via `/portal/api`. The operator-JWT *mint* path still lingers in
  [bp_auth.py](../web/api/blueprints/bp_auth.py) (`get_operator_jwt_secret`),
  so the committed secret is still worth rotating to neutralize the history
  leak — but the live attack surface is shrinking, and once the mint path is
  deleted the `PIQ_HANDOFF_OPERATOR_JWT_SECRET` var can be dropped entirely.

- **New secret to *provision* (not exposed): `IAM_WEBHOOK_SECRET`** — the
  itsm-service IAM lifecycle-webhook receiver
  ([itsm-service `app/config.py`](../../itsm-service/app/config.py),
  `app/api/v1/webhooks.py`) verifies an HMAC over the raw body using this
  secret. It was **never committed with a real value** (`.env.example` ships the
  placeholder `your-hmac-webhook-secret`), so it is **not** part of the exposure
  above. Generate a strong random value
  (`python -c "import secrets;print(secrets.token_urlsafe(48))"`), set it as
  `IAM_WEBHOOK_SECRET` in the itsm-service environment, and configure the **same**
  value on the Keycloak side that signs the events (see the IAM lifecycle
  runbook). This is a *provisioning* step, not a rotation — track it with the
  deploy, not this leak list.

> **No live rotation was performed** in compiling this status — it is a checklist
> only. Execute the numbered rotations in a controlled maintenance window
> (rotating the operator-JWT and DB secrets forces re-login / reconnect).
