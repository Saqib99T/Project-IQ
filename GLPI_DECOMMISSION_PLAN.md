# GLPI → ITSM Decommission Plan

Goal: remove **all** GLPI dependencies; itsm-service becomes the single backend for
KB, tickets, attachments, users, and ticket events. **600 references across 42 files.**

Nothing destructive is done until each capability's itsm-service replacement is
verified. Status legend: ✅ ready · ⚙️ needs rewiring · ⛔ blocker.

---

## Capability audit

| # | Capability | GLPI today | itsm-service replacement | Status |
|---|---|---|---|---|
| 1 | **KB content** | GLPI knowbase → `kb_cache_manager` | `kb_articles` (114 migrated as global) | ✅ done |
| 2 | **KB retrieval (bot)** | `actions_kb` → `kb_cache` (GLPI/pkl) | `ITSMService.search_kb/suggest_kb` + `/kb/*` | ⛔ needs **KB bot service account** (`KB_BOT_CLIENT_ID/SECRET` blank) |
| 3 | **Tickets (bot)** | `actions_glpi_tickets`, `glpi_service` | `ITSMService.create/get/list/update/comments` | ✅ client built; verify all actions cut over |
| 4 | **Ticket attachments** | `bp_ticket_attachment` (`_glpi_upload`) | `POST/GET /tickets/{id}/attachments` (presigned) | ⚙️ repoint web upload/download to presigned flow |
| 5 | **Bot auth / session** | `actions_glpi_auth`, `actions_session`, GLPI session token | IAM JWT (`get_iam_jwt`) already used for ticket calls | ⚙️ remove GLPI login/session actions (IAM-SSO replaces them) |
| 6 | **User mapping** | `iam_glpi_users` (IAM sub → GLPI user, sender map) | itsm auto-provisions local user from IAM | ⚙️ replace sender-map with itsm ticket/user ids |
| 7 | **Inbound ticket events** | `bp_glpi_webhook` (GLPI → proactive bot notify) | itsm emits `ticket.created/updated` outbound webhooks | ⚙️ build a web receiver + register subscription |
| 8 | **Config / infra** | `get_glpi_config`, `GlpiService`, `glpi_entity_manager`, `[GLPI]` config, `web_api`/`shared`/`register` wiring | n/a | ⚙️ teardown after 1–7 |
| 9 | **Dev scripts** | `export_glpi_kb`, `rebrand`, `test_login_script`, … | n/a | delete (non-runtime) |

Only **#2 is a true blocker.** Everything else has an itsm-service path and just
needs code rewiring + verification.

---

## Phased sequence

### Phase 0 — KB content (DONE)
- Migrated 114 GLPI articles → itsm-service global "Global Knowledge Base" space.
- Added Admin → Knowledge Base → **Articles** listing in the ITSM app.

### Phase 1 — KB retrieval cutover ⛔
1. Provision a Keycloak service-account client (platform-org identity, KB read).
   Wire `KB_BOT_CLIENT_ID` (config) + secret (env, **never committed**).
2. Verify `kb_cache_manager._fetch_from_itsm_service()` returns the 114 articles.
3. Point `actions_kb` search at itsm-service; **remove the GLPI + JSON KB sources**
   from `kb_cache_manager` (the local pkl/vector index stays as a *derived* cache).
4. KB deep-links → ITSM KB article URLs (drop GLPI `knowbaseitem.form.php`).

### Phase 2 — Tickets cutover
- Replace `actions_glpi_tickets` usage with `ITSMService`; confirm create / list /
  detail / status / comment parity. Delete `actions_glpi_tickets` + GLPI ticket code.

### Phase 3 — Attachments
- Repoint `bp_ticket_attachment` upload/download to itsm-service presigned flow.
  Remove `_glpi_upload` / `_glpi_session`.

### Phase 4 — Auth/session + user mapping
- Remove `ActionGlpiLogin` / `ActionInitGlpiSession` and GLPI session plumbing in
  `_shared` (IAM-SSO is the sole auth). Replace `iam_glpi_users` sender-map with
  itsm ticket/user identifiers.

### Phase 5 — Inbound ticket events
- Build a web receiver for itsm `ticket.created/updated` webhooks; register the
  subscription. Retire `bp_glpi_webhook`.

### Phase 6 — Config/infra teardown
- Delete `GlpiService`, `glpi_entity_manager`, `get_glpi_config`, `[GLPI]` config,
  GLPI wiring in `web_api`/`shared`/`register`, and dev scripts. Final grep must
  return **0** runtime GLPI references.

---

## Open decisions / risks
- **Bot identity scope:** the bot KB cache is shared across tenants — it must pull
  **global-only** articles (add a guard in `_fetch_from_itsm_service`) to avoid
  leaking any future tenant-scoped article into the shared bot.
- **Secret handling:** bot client secret via env var only (org policy: no secrets
  in code/config commits).
- **Sequencing:** Phases 2–5 can break the live bot if cut before verified — each
  ships behind a smoke test before deleting the GLPI path.
