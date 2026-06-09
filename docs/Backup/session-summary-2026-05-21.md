# Project IQ V2 — Session Summary (2026-05-21)

## Overview

This session delivered a comprehensive upgrade to the Project IQ support chatbot across web and mobile. All changes apply to **both platforms** unless explicitly noted.

---

## What Was Implemented

### Phase 1 — Bug Fixes

| # | Fix | Files |
|---|-----|-------|
| 3.1 | History panel layout — sessions grouped by **product** instead of date; clean message preview strips intent strings | `ChatScreen.js`, `ChatWindow.jsx` |
| 3.2 | Categorization — history search with `?search=` ILIKE; preview skips `/%` intent strings | `bp_user_api.py`, `ChatScreen.js`, `ChatWindow.jsx` |
| 3.3 | Summaries — `cleanPreview()` helper removes bot formatting chars | `ChatScreen.js`, `ChatWindow.jsx` |
| 3.4 | Back button — hamburger now opens history drawer; Settings/Profile reachable from profile panel | `ChatScreen.js`, `ChatWindow.jsx` |
| 3.5 | Camera / file upload — expo-image-picker + file attachment with preview in TicketModals | `TicketModals.js` |
| 3.6 | Profile page — `ProfileScreen.js` created; shows username, active product, dark mode toggle, API settings link, logout | `ProfileScreen.js`, `App.js` |

### Phase 2 — IAM Integration (Keycloak)

**Architecture decisions:**
- All users (end users, operators, super-admins) authenticate via Keycloak JWT (RS256)
- GLPI retained for ticket data and KB only — not for auth
- Guest mode: KB search open; ticket creation / handoff require login
- `sender_id = iam-{sub}` for authenticated users
- GLPI users auto-provisioned from IAM token on first ticket creation

**Backend — new files:**

| File | Purpose |
|------|---------|
| `common/iam_service.py` | JWT validation via PyJWT + Keycloak JWKS (cached `PyJWKClient`) |
| `common/db/iam_glpi_users.py` | `iam_sub ↔ glpi_user_id` mapping; `get_or_provision_glpi_user()` |
| `web/api/shared.py` | `require_iam_token` decorator, `require_role()`, `get_iam_user_or_guest()` |
| `web/api/blueprints/bp_auth.py` | `POST /auth/verify`, `POST /operator/iam-login` |

**Backend — modified files:**

- `web/api/blueprints/bp_chat.py` — Bearer extraction, `sender_id = iam-{sub}`, IAM metadata to Rasa
- `web/api/blueprints/bp_user_api.py` — `app_id` in responses, `?search=` param, preview filtering
- `core/domain.yml` — slots: `iam_sub`, `iam_name`, `iam_email`, `glpi_user_id`
- `action_server/actions/_shared.py` — `get_iam_identity()`, `is_iam_authenticated()`, `require_iam_auth()`
- `action_server/actions/actions_glpi_tickets.py` — IAM path for ticket creation + SLA line in response
- `action_server/actions/actions_handoff.py` — IAM auth guard
- `common/db/_handoff.py` — `get_operator_by_iam_sub()`, `create_operator()` accepts `iam_sub`
- `common/app.config` — `[IAM]`, `[SLA]`, `[GLPI_WEBHOOK]` sections added

**Web — new files:**

| File | Purpose |
|------|---------|
| `web/ui/src/widget/hooks/useIam.js` | Keycloak-js wrapper: `useIam()`, `useUser()`, `useRoles()`, `useApps()` |
| `web/ui/src/widget/hooks/useOfflineQueue.js` | Offline message queue (sessionStorage + online event) |
| `web/ui/src/widget/utils/prefillTicket.js` | Auto-fill ticket from conversation context |
| `web/ui/src/widget/components/ProfilePanel.jsx` | Profile overlay: name, product, dark mode toggle, sign out |

**Mobile — new files:**

| File | Purpose |
|------|---------|
| `expo-app/src/hooks/useIamAuth.js` | PKCE flow via expo-auth-session, SecureStore token storage, proactive refresh |
| `expo-app/src/hooks/useOfflineQueue.js` | Offline queue (NetInfo + AsyncStorage) |
| `expo-app/src/hooks/useBiometric.js` | Face ID / fingerprint re-auth (expo-local-authentication) |
| `expo-app/src/utils/prefillTicket.js` | Same prefill logic as web |
| `expo-app/src/context/ThemeContext.js` | Dark mode React Context, persisted in AsyncStorage |

### Phase 3 — In-App Notifications + Push

**Backend — new files:**

| File | Purpose |
|------|---------|
| `common/db/_notifications.py` | `create_notification()`, `get_notifications()`, `mark_read()`, `mark_all_read()`, push token CRUD |
| `common/db/_kb_gaps.py` | `log_kb_gap()`, `get_kb_gaps()` for admin knowledge gap report |
| `web/api/impl/notify.py` | Fire-and-forget: DB row + Socket.IO + Expo push (background thread) |
| `web/api/blueprints/bp_notifications.py` | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /notifications/push-token` |
| `web/api/blueprints/bp_glpi_webhook.py` | `POST /webhooks/glpi` — GLPI event → notify user |

**Backend — modified files:**

- `web/api/blueprints/register.py` — registered new blueprints
- `web/api/impl/socketio_events.py` — `handoff_queued/assigned/ended` emit notifications; `new_notification`, `notification_count` events
- `web/api/blueprints/bp_kb.py` — `GET /admin/kb/gaps` endpoint
- `common/db/_connection.py` — auto-migrations: `notifications`, `push_tokens`, `ticket_senders`, `kb_search_gaps`, `iam_sub` column on operators
- `requirements.txt` — `cryptography>=41.0.0`

**Web — new files:**

- `web/ui/src/widget/components/NotificationBell.jsx` — Bell icon + unread badge; dropdown list; Socket.IO live updates; `onUnreadChange` callback

**Mobile — new files:**

- `expo-app/src/screens/NotificationsScreen.js` — Pull-to-refresh list; tap to mark read; relative timestamps

### Additional Improvements (implemented without prompting)

| # | Improvement |
|---|------------|
| 1 | Voice input — Web Speech API mic button (web); keyboard hint on mobile |
| 2 | App icon badge — `Notifications.setBadgeCountAsync()` synced to unread count (mobile) |
| 3 | Dark mode — full system; ThemeContext + toggle in profile; respects OS preference |
| 4 | PDF export — `expo-print` + `expo-sharing` (mobile); `window.print()` (web) |
| 5 | Quick issue chips — 6 common issues pre-fill ticket form (web + mobile) |
| 6 | Biometric re-auth — Face ID / fingerprint on app resume after 5 min (mobile) |
| 7 | SLA countdown — Expected resolution time in ticket creation response (backend) |
| 8 | Offline queue — Messages queued when offline, auto-drained on reconnect |
| 9 | Ticket pre-fill — Category / priority / title inferred from conversation |
| 10 | Knowledge gap detection — Failed KB searches logged; admin report endpoint |
| 11 | History search — Keyword search in conversation history panel |
| 12 | Handoff notifications — Operator assigned / ended events trigger user notification |

### iPhone Safe Area Fixes

- All `SafeAreaView` components use explicit `edges={['top', 'bottom']}`
- Header `minHeight: 56` on all screens
- Input bar uses `SafeAreaView` with `edges={['bottom']}`
- Hairline `borderTopWidth: 1` on input bar instead of shadow (avoids bleed on iPhone)
- Applied to: `ChatScreen.js`, `ProfileScreen.js`, `NotificationsScreen.js`, `SettingsScreen.js`

---

## Pending / Requires Action

### Phase 4 — AI Agents (DELAYED — awaiting LLM choice)

Two agents planned for a future session:
1. **Customer reply drafter** — suggests reply to customer from operator chat
2. **KB article drafter** — auto-drafts KB article from resolved ticket

LLM options to choose from: **Claude API**, **OpenAI GPT-4o**, or **Ollama (local/free)**. Once chosen, implementation via Rasa action server.

---

### One-time Setup Tasks (before going live)

#### 1. Keycloak / 99 IAM (IAM Team)

**Confirmed live URLs (dev environment):**
- Keycloak: `https://id.dev.iam.99technologies.com`
- AccessWise admin UI: `https://app.dev.iam.99technologies.com`
- IAM API: `https://api.dev.iam.99technologies.com`
- Realm: `99-iam` ✓

**Steps needed (via AccessWise UI — sign in as super_admin):**
```
1. Register app:   clientId=project-iq, name="Project IQ"
                   roles: Admin, Operator
                   redirect URIs: http://localhost:8181/*, projectiq://*, exp://*/*
2. Assign "Operator" role (resource_access["project-iq"]) to support staff accounts
3. Assign "Admin"    role to admins
4. super_admin realm role for super-admins (already a realm-level role)
```

#### 2. Backend `app.config` ✓ Already updated

```ini
[IAM]
keycloak_url = https://id.dev.iam.99technologies.com
realm        = 99-iam
client_id    = project-iq
api_url      = https://api.dev.iam.99technologies.com

[SLA]
critical_hours = 2
high_hours     = 4
medium_hours   = 8
low_hours      = 24

[GLPI_WEBHOOK]
secret = <generate a random secret, e.g. openssl rand -hex 32>
```

#### 3. GLPI Webhook

In GLPI admin → Setup → Notifications → Webhook Notifications:
- URL: `https://your-api-host/webhooks/glpi`
- Header: `X-Glpi-Signature: <same secret as above>`
- Events: Ticket Created, Ticket Modified, Followup Added, Solution Added

#### 4. Web Embedding Page

Inject IAM config before loading the widget:

```html
<script>
  window.__IAM_CONFIG__ = {
    url:      'https://iam.99technologies.ai',
    realm:    '99-iam',
    clientId: 'project-iq'
  };
</script>
```

#### 5. Mobile Build

New Expo packages added — rebuild required before TestFlight / Play Store:

```
expo-auth-session
expo-local-authentication
expo-notifications
expo-print
expo-sharing
expo-image-picker
@react-native-community/netinfo
```

Run: `eas build --platform all`

---

## New API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/verify` | Bearer | Validate IAM token, return user info |
| POST | `/operator/iam-login` | Bearer | Auto-provision operator from IAM token |
| GET | `/notifications` | `?sender_id=` | List notifications (unread first) |
| POST | `/notifications/:id/read` | — | Mark one notification read |
| POST | `/notifications/read-all` | — | Mark all read |
| POST | `/notifications/push-token` | — | Register Expo push token |
| GET | `/admin/kb/gaps` | — | Knowledge gap report (`?days=7&app_id=IT`) |
| POST | `/webhooks/glpi` | Signature header | GLPI event receiver |

---

## Database Changes (auto-migrated on startup)

```sql
-- New tables
notifications      (id, user_id, type, title, body, app_id, payload, read, created_at)
push_tokens        (id, user_id, token, platform, created_at)
ticket_senders     (glpi_ticket_id, sender_id, app_id, created_at)
iam_glpi_users     (iam_sub, glpi_user_id, name, email, created_at)
kb_search_gaps     (id, query, app_id, sender_id, created_at)

-- Column additions
operators.iam_sub  TEXT UNIQUE
```

---

## Standing Rules (saved to memory)

- **Functionality must not break** — map all dependencies before touching shared code
- **Web + mobile parity** — every feature must work on both platforms
