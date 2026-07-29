# Web ↔ Mobile parity audit

Audit of feature parity between the **web chat widget** (`web/ui/src/widget/`)
and the **Expo mobile app** (`expo-app/src/`), per the standing rule that every
feature ships on both unless physically impossible on one platform.

_Method: compared component trees, hooks, and the structured bot-message types
each chat client renders (`MessageBubble`)._ Date: 2026-06-22.

## Summary

Parity is **strong**. One genuine rendering gap (structured ticket-detail card
on mobile); everything else is at parity or a platform-appropriate difference.

## Feature parity

| Capability | Web widget | Mobile (Expo) | Status |
|---|---|---|---|
| IAM/Keycloak SSO login | `useIam` + ChatWindow | `useIamAuth` + LoginModal | ✅ parity |
| Markdown message rendering | MessageBubble | MessageBubble | ✅ parity |
| Quick-reply buttons / payloads | MessageBubble | MessageBubble, QuickActions | ✅ parity |
| Charts in chat | `ChartRenderer` (rich) | inline bar chart in MessageBubble | ✅ parity (web fidelity higher) |
| Ticket create form | TicketForm | TicketModals | ✅ parity |
| Attachment upload (ticket) | TicketForm | TicketModals (DocumentPicker) | ✅ parity |
| Handoff to operator (socket) | useChatSocket | useChatSocket | ✅ parity |
| Product switching | ProfilePanel | ProfileScreen | ✅ parity |
| Notifications | NotificationBell (in-widget) | NotificationsScreen + push | ✅ parity (mobile adds push) |
| Session feedback / CSAT rating | MessageBubble/ChatWindow | SessionFeedbackModal | ✅ parity |
| **Structured ticket-detail card** (status + comments + clickable attachments) | **MessageBubble `ticketDetail`** | **— (markdown text only)** | ⚠️ **gap** |

## The one real gap

**Structured `ticket_detail` rendering on mobile.** The bot's ticket-status
reply carries both a markdown body *and* a structured `json_message.ticket_detail`
(fields + a comments list + attachment links). The **web** `MessageBubble`
renders this as a rich card (`ticketDetail`, `comments`, `attachments`
branches). The **mobile** `MessageBubble` has no `ticketDetail`/`comments`
branch — it falls back to the markdown text.

Impact: mobile users still *see* ticket info and the "💬 Comments" markdown
block, but not the structured card or tappable attachment links. **Severity:
low–moderate** (cosmetic/fidelity, not missing data).

Fix (when prioritized): add a `ticketDetail` branch to
`expo-app/src/components/MessageBubble.js` mirroring the web card — render
status/priority chips, the comments list (`author_name · date`), and attachment
links. Small, self-contained.

## Platform-appropriate divergences (NOT gaps)

Mobile-only by nature — correct to omit on web:
- **Biometric unlock** (`useBiometric`) — device capability.
- **Offline message queue** (`useOfflineQueue`) — web is always-connected.
- **Local chat-history persistence** (`useChatHistory`) — handled by the browser/session on web.
- **Push notifications** — native; web uses the in-widget notification bell.

## Recommendation

Only the **structured ticket-detail card on mobile** is a true parity item, and
it's low-severity (data is already shown via markdown). Suggest scheduling it as
a small follow-up rather than urgent. No other action needed — the platforms are
otherwise in parity.
