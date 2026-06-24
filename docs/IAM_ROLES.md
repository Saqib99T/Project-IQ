# IAM Roles — canonical model (single source of truth)

**IAM (Keycloak) is the sole authority for users and roles.** Every service
derives roles **read-only** from the verified JWT on each request — nothing
stores or edits the authoritative role except the super-admin portal, which
writes back to Keycloak via `iam_set_client_roles` (`common/iam_service.py`).

Role *derivation* is centralized **once per service** (there is no shared module
because the bot and itsm-service are separate deployments with different role
vocabularies). This doc is the cross-repo contract that keeps them aligned.

## The IAM roles

| Role | Where in the token | Meaning |
|------|--------------------|---------|
| `super_admin` | **realm** (`realm_access.roles`) | platform-wide admin (99T org) |
| `org_admin`   | **realm** | tenant administrator |
| `Operator`    | **client** (`resource_access["project-iq"].roles`) | live-support agent |
| `Admin`       | **client** | tenant admin (client-scoped) |
| `User`        | realm/client | end user |
| `Bot`         | realm/client | service account / bot |

> ⚠️ **realm vs client + casing.** `super_admin`/`org_admin` are **realm**
> roles (lowercase). `Operator`/`Admin`/`User`/`Bot` are **client** roles on the
> `project-iq` client (capitalized). This split is the #1 source of cross-service
> drift — see the consistency note below.

## Bot derivation — `common/iam_service.py :: extract_iam_user()`

Single place; produces boolean flags consumed everywhere (never re-derived):

- `is_super_admin` = realm `super_admin`
- `is_admin`       = client `Admin` **or** realm `org_admin` **or** `super_admin`
- `is_operator`    = client `Operator`
- `is_user` / `is_bot` = `user` / `bot` present in realm **or** client roles (case-insensitive)
- `is_platform_admin`, `is_client_admin`, `is_org_admin` — derived from the above

`operators.is_admin` (Chatbot DB) is *set from* this flag on login — it is **not**
an independent derivation.

## itsm-service mapping — `app/auth/dependencies.py :: _IAM_TO_TENANT_ROLE`

Operates on the token's **realm** roles (`iam_roles`); highest-privilege wins:

| IAM role (realm) | ITSM tenant role |
|------------------|------------------|
| `super_admin` / `org_admin` / `admin` | `admin` |
| `operator` | `agent` |
| `user` | `end_user` |
| `bot` | `service_account` |

Platform-org users map via `_best_platform_role` → `platform_admin` /
`platform_support`. The full realm+client role set is mirrored onto the
`users.iam_roles` column for display/query (`synced_iam_roles`).

## ⚠️ Known consistency risk (verify against Keycloak)

The **operator** role is read from **different places** by the two services:

- **Bot** → client role **`Operator`** (`resource_access["project-iq"]`).
- **itsm-service** → **realm** role **`operator`** (its map only consults realm roles).

So a user with only the *client* `Operator` role is an operator to the bot but
maps to `end_user` in itsm-service. **Operators must carry the realm `operator`
role as well** (or both services must read the same source). Action: confirm the
Keycloak role setup grants operators the realm `operator` role; otherwise align
one service to the other. The same applies to `Admin` (client) vs the realm
`org_admin`/`super_admin` that itsm relies on — currently aligned because admins
carry realm `org_admin`/`super_admin`.

## Rule of thumb for new code

- **Never** re-derive roles from `resource_access`/`realm_access` inline. In the
  bot use the `extract_iam_user()` flags; in itsm-service use `current_user.roles`.
- To change a user's role, change it **in Keycloak** (or via the portal's
  IAM-write path) — not in the ITSM `users` table or the Chatbot `operators` row,
  which are read-only projections refreshed from the token on login.
