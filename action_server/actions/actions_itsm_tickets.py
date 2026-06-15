import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from common import analytics_store
from action_server.actions._shared import (
    log_bot_response,
    get_analytics_context, get_effective_session_token,
    check_user_login, itsm_service, logger,
    get_iam_identity, is_iam_authenticated, require_iam_auth,
    get_org_context, get_iam_jwt,
)
from action_server.actions.itsm_service import (
    ITSM_STATUS_DISPLAY, LABEL_TO_ITSM_STATUS, URGENCY_TO_PRIORITY,
)


def _fmt_date(iso: str) -> str:
    """ISO date/datetime → short MM-DD-YY (e.g. '2026-06-09...' → '06-09-26')."""
    s = (iso or "")[:10]
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        y, m, d = s[:4], s[5:7], s[8:10]
        return f"{m}-{d}-{y[2:]}"
    return s


class ActionCreateItsmTicket(Action):
    def name(self) -> Text:
        return "action_create_itsm_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return [SlotSet("ticket_id", None)]
            dispatcher.utter_message(text="❌ Authentication required to create tickets.")
            return [SlotSet("ticket_id", None)]

        ticket_title   = tracker.get_slot("ticket_title")
        ticket_content = tracker.get_slot("ticket_content")
        urgency        = tracker.get_slot("urgency")  # "Low" | "Medium" | "High"

        # Map Rasa urgency label → itsm priority string
        urgency_int = {"Low": 1, "Medium": 3, "High": 5}.get(urgency, 3)
        priority    = URGENCY_TO_PRIORITY.get(urgency_int, "medium")

        # Build title prefix from org/app context
        org_ctx  = get_org_context(tracker)
        org_name = org_ctx["org_name"]
        channel  = org_ctx["channel"]
        app_id   = tracker.get_slot("app_id")
        if not app_id:
            latest_msg = tracker.latest_message
            if isinstance(latest_msg, dict):
                app_id = latest_msg.get("metadata", {}).get("app_id")

        if channel == "platform" and org_name:
            title_prefix = f"[{org_name}] "
        else:
            title_prefix = f"[{app_id or 'General'}] "

        full_title   = f"{title_prefix}{ticket_title}"
        description  = ticket_content or ticket_title or ""

        ticket = await itsm_service.create_ticket(
            jwt, full_title, description, priority=priority
        )

        if ticket:
            ticket_ref = ticket.get("ticket_number") or ticket.get("id", "")
            try:
                from common.config_manager import get_sla_config
                sla   = get_sla_config()
                prio  = (urgency or "Medium").lower()
                hours = sla.get(prio, sla.get("medium", 8))
                sla_line = f"\n⏱ Expected resolution: ~{hours}h ({urgency or 'Medium'} priority)"
            except Exception:
                sla_line = ""
            response_text = f"✅ Your ticket **{ticket_ref}** has been created.{sla_line}"
            dispatcher.utter_message(
                text=response_text,
                buttons=[
                    {"title": "🔍 Check its status", "payload": "/check_status"},
                    {"title": "📋 List my tickets", "payload": "/list_tickets"},
                    {"title": "🎫 Create another", "payload": "/create_ticket"},
                ]
            )
            log_bot_response(tracker, response_text)
            return [
                SlotSet("ticket_id", ticket_ref),
                SlotSet("ticket_title", None),
                SlotSet("ticket_content", None),
                SlotSet("issue_type", None),
                SlotSet("urgency", None),
            ]
        else:
            response_text = "❌ Failed to create ticket. Please try again later."
            dispatcher.utter_message(text=response_text)
            log_bot_response(tracker, response_text)
            return []


# --- 2. Custom Action: Check Status ---


class ActionCheckItsmStatus(Action):
    def name(self) -> Text:
        return "action_check_itsm_status"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return [SlotSet("ticket_id", None)]
            dispatcher.utter_message(text="❌ Authentication required to check ticket status.")
            return [SlotSet("ticket_id", None)]

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        import time as _time
        _t0 = _time.monotonic()
        ticket_data = await itsm_service.get_ticket(jwt, ticket_id_slot)
        logger.info("[STATUS TIMING] get_ticket=%.2fs", _time.monotonic() - _t0)

        if ticket_data:
            current_status = ITSM_STATUS_DISPLAY.get(ticket_data.get("status", ""), "Unknown")
            title        = ticket_data.get("title", "No Title")
            created_at   = (ticket_data.get("created_at") or "")[:16].replace("T", " ")
            updated_at   = (ticket_data.get("updated_at") or "")[:16].replace("T", " ")
            priority     = (ticket_data.get("priority") or "").capitalize()
            ticket_ref   = ticket_data.get("ticket_number") or ticket_id_slot

            message  = f"**Ticket Details: {ticket_ref}**\n\n"
            message += "| Property | Value |\n"
            message += "| :--- | :--- |\n"
            message += f"| **Status** | {current_status} |\n"
            message += f"| **Priority** | {priority} |\n"
            message += f"| **Title** | {title} |\n"
            message += f"| **Created** | {created_at} |\n"
            message += f"| **Updated** | {updated_at} |\n"

            # Attachments
            try:
                ticket_uuid = ticket_data.get("id")
                _ta = _time.monotonic()
                attachments = await itsm_service._get_list(
                    jwt, f"/api/v1/tickets/{ticket_uuid}/attachments"
                )
                logger.info("[STATUS TIMING] attachments=%.2fs", _time.monotonic() - _ta)
                if attachments:
                    message += "\n\n**📎 Attachments:**\n\n"
                    for att in attachments:
                        fname = att.get("filename", "File")
                        url   = att.get("download_url")
                        mime  = att.get("mime_type", "") or ""
                        if url and mime.startswith("image/"):
                            # Inline image → rendered as a clickable thumbnail by the widget
                            message += f"![{fname}]({url})\n"
                        elif url:
                            message += f"- [{fname}]({url})\n"
                        else:
                            message += f"- {fname}\n"
            except Exception as att_err:
                logger.warning("[CheckStatus] Could not fetch attachments: %s", att_err)

            dispatcher.utter_message(
                text=message,
                buttons=[
                    {"title": "📝 Update this ticket", "payload": "/update_ticket"},
                    {"title": "✅ Close ticket", "payload": "/verify_resolution"},
                    {"title": "📋 List all tickets", "payload": "/list_tickets"},
                ]
            )
            log_bot_response(tracker, message)
            return [SlotSet("ticket_status", current_status), SlotSet("ticket_id", ticket_ref)]
        else:
            error_msg = "❌ Could not retrieve ticket status (not found or access denied)."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("ticket_id", None)]


# --- 3. Custom Action: Update Ticket (Status or Content) ---


class ActionUpdateItsmTicket(Action):
    def name(self) -> Text:
        return "action_update_itsm_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return []
            dispatcher.utter_message(text="❌ Authentication required.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        target_status  = tracker.get_slot("target_status")
        update_content = tracker.get_slot("update_content")

        if target_status:
            # Map legacy label → itsm status string
            itsm_status = LABEL_TO_ITSM_STATUS.get(target_status)
            if not itsm_status:
                tl = target_status.lower()
                if "process" in tl:   itsm_status = "in_progress"
                elif "pending" in tl: itsm_status = "pending"
                elif "solved" in tl or "resolv" in tl: itsm_status = "resolved"
                elif "closed" in tl or "close" in tl:  itsm_status = "closed"
                else:
                    dispatcher.utter_message(
                        text=f"I didn't recognise status '{target_status}'."
                    )
                    return [SlotSet("target_status", None)]

            success = await itsm_service.update_ticket_status(jwt, ticket_id_slot, itsm_status)
            if success:
                dispatcher.utter_message(
                    text=f"✅ Ticket **{ticket_id_slot}** status updated to **{target_status}**."
                )
                if itsm_status == "closed":
                    dispatcher.utter_message(response="utter_ask_satisfaction")
                return [SlotSet("target_status", None), SlotSet("ticket_status", target_status)]
            else:
                dispatcher.utter_message(text="❌ Failed to update ticket status.")
                return [SlotSet("target_status", None)]

        elif update_content:
            success = await itsm_service.add_comment(jwt, ticket_id_slot, update_content)
            if success:
                dispatcher.utter_message(text=f"✅ Added comment to ticket **{ticket_id_slot}**.")
                return [SlotSet("update_content", None)]
            else:
                dispatcher.utter_message(text="❌ Failed to add comment.")
                return []
        else:
            ticket_data = await itsm_service.get_ticket(jwt, ticket_id_slot)
            if ticket_data:
                curr_status = ITSM_STATUS_DISPLAY.get(ticket_data.get("status", ""), "Unknown")
                dispatcher.utter_message(
                    response="utter_ask_target_status",
                    ticket_status=curr_status,
                )
                return [SlotSet("ticket_status", curr_status)]
            else:
                dispatcher.utter_message(text="❌ Ticket not found.")
                return []

# --- 4. Custom Action: Verify Resolution (Show Status & Close) ---


class ActionVerifyItsmResolution(Action):
    def name(self) -> Text:
        return "action_verify_itsm_resolution"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            dispatcher.utter_message(text="Session is not active.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        target_status = tracker.get_slot("target_status")

        if target_status == "Solved":
            success = await itsm_service.update_ticket_status(jwt, ticket_id_slot, "resolved")
            if success:
                dispatcher.utter_message(
                    text=f"✅ Ticket **{ticket_id_slot}** has been marked as **Resolved**. Glad I could help!"
                )
                dispatcher.utter_message(response="utter_ask_satisfaction")
                return [SlotSet("ticket_status", "Resolved"), SlotSet("target_status", None)]
            else:
                dispatcher.utter_message(text="❌ Failed to resolve the ticket.")
                return [SlotSet("target_status", None)]

        ticket_data = await itsm_service.get_ticket(jwt, ticket_id_slot)
        if ticket_data:
            curr_status = ITSM_STATUS_DISPLAY.get(ticket_data.get("status", ""), "Unknown")
            if curr_status in ("Resolved", "Closed"):
                dispatcher.utter_message(
                    text=f"Ticket **{ticket_id_slot}** is already **{curr_status}**."
                )
                return [SlotSet("ticket_status", curr_status)]
            dispatcher.utter_message(
                text=f"Ticket **{ticket_id_slot}** is currently **{curr_status}**. Do you want to mark it as **Resolved**?",
                buttons=[
                    {"title": "Yes, Mark as Resolved", "payload": '/inform_update{"target_status":"Solved"}'},
                    {"title": "No, keep it open", "payload": "/deny"},
                ]
            )
            return [SlotSet("ticket_status", curr_status)]
        else:
            dispatcher.utter_message(text="❌ Ticket not found.")
            return []


# --- 5. Helper Action: Deactivate Form and Clear Slots ---


class ActionDeactivateForm(Action):
    def name(self) -> Text:
        return "action_deactivate_form"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        return [
            ActiveLoop(None),
            SlotSet("ticket_title", None), 
            SlotSet("ticket_content", None), 
            SlotSet("issue_type", None),
            SlotSet("urgency", None),
        ]


# --- 6. Custom Action: View Ticket Comments ---


class ActionViewTicketComments(Action):
    def name(self) -> Text:
        return "action_view_ticket_comments"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return []
            dispatcher.utter_message(text="❌ Authentication required.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        comments = await itsm_service.get_comments(jwt, ticket_id_slot)

        if not comments:
            dispatcher.utter_message(text=f"No comments found for ticket **{ticket_id_slot}**.")
            return []

        recent = comments[-5:]
        message = f"**Recent comments for {ticket_id_slot}:**\n\n"
        for c in recent:
            body    = c.get("body", "")
            ts      = (c.get("created_at") or "")[:16].replace("T", " ")
            message += f"📅 *{ts}*:\n{body}\n\n"

        dispatcher.utter_message(text=message)
        return []


# --- 7. Custom Action: List Open Tickets ---


class ActionListOpenTickets(Action):
    def name(self) -> Text:
        return "action_list_open_tickets"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return []
            dispatcher.utter_message(text="❌ Authentication required.")
            return []

        latest_msg = tracker.latest_message
        user_text  = latest_msg.get("text", "").lower() if isinstance(latest_msg, dict) else ""
        show_history = any(w in user_text for w in ["all", "history", "closed", "past", "old", "every"])

        # Check for status filter from button payloads (e.g. /list_tickets{"status_id": 5})
        itsm_status_filter = None
        status_name        = None
        entities = latest_msg.get("entities", []) if isinstance(latest_msg, dict) else []
        for e in entities:
            if e.get("entity") == "status_id":
                itsm_sid = int(e["value"])
                # Map ITSM status id → itsm status string
                _itsm_to_itsm = {
                    1: "open", 2: "in_progress", 3: "in_progress",
                    4: "pending", 5: "resolved", 6: "closed", 10: "approved",
                }
                itsm_status_filter = _itsm_to_itsm.get(itsm_sid)
                status_name = ITSM_STATUS_DISPLAY.get(itsm_status_filter, "")
                break

        if itsm_status_filter:
            tickets = await itsm_service.list_tickets_by_status(jwt, [itsm_status_filter])
        elif show_history:
            tickets = await itsm_service.list_tickets(jwt, active_only=False)
        else:
            tickets = await itsm_service.list_tickets(jwt, active_only=True)

        if not tickets:
            filter_text = f" with status **{status_name}**" if status_name else ""
            dispatcher.utter_message(text=f"You have no tickets{filter_text}.")
            return []

        context_title = (
            f"Tickets ({status_name})" if status_name
            else ("Ticket History" if show_history else "Your Open Tickets")
        )
        message  = f"**📂 {context_title}**\n\n"
        message += "| # | Status | Title | Updated |\n"
        message += "| :--- | :--- | :--- | :--- |\n"

        for t in tickets[:15]:
            tnum      = t.get("ticket_number", t.get("id", "?"))
            title     = (t.get("title") or "No Title").replace("|", "-")
            status_s  = ITSM_STATUS_DISPLAY.get(t.get("status", ""), "Unknown")
            updated   = _fmt_date(t.get("updated_at"))
            title_s   = (title[:25] + "..") if len(title) > 25 else title
            message  += f"| **{tnum}** | {status_s} | {title_s} | {updated} |\n"

        dispatcher.utter_message(
            text=message,
            buttons=[
                {"title": "📊 View Graph", "payload": "/show_ticket_graph"},
                {"title": "🔍 Check ticket status", "payload": "/check_status"},
                {"title": "🎫 Create new ticket", "payload": "/create_ticket"},
            ]
        )
        return []


class ActionUploadFile(Action):
    def name(self) -> Text:
        return "action_upload_file"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        # File uploads go via the web UI presigned-URL flow, not through chat.
        dispatcher.utter_message(
            text="📎 To attach a file, use the paperclip icon in the ticket detail view."
        )
        return []


class ActionListAttachments(Action):
    def name(self) -> Text:
        return "action_list_attachments"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return []
            dispatcher.utter_message(text="❌ Authentication required.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        attachments = await itsm_service.get_attachments(jwt, ticket_id_slot)

        if not attachments:
            dispatcher.utter_message(text=f"No attachments found for ticket **{ticket_id_slot}**.")
            return []

        message  = f"**📎 Attachments for {ticket_id_slot}:**\n\n"
        message += "| Name | Type |\n"
        message += "| :--- | :--- |\n"

        for att in attachments:
            fname = att.get("filename", "File")
            mime  = att.get("mime_type", "")
            if "image" in mime:
                type_icon = "🖼️ Image"
            elif "pdf" in mime:
                type_icon = "📄 PDF"
            else:
                type_icon = "📁 File"
            message += f"| {fname} | {type_icon} |\n"

        dispatcher.utter_message(text=message)
        return []


class ActionShowTicketGraph(Action):
    """Generates a pie chart showing tickets grouped by status."""

    def name(self) -> Text:
        return "action_show_ticket_graph"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            dispatcher.utter_message(text="❌ Please sign in first to view your ticket graph.")
            return []

        tickets = await itsm_service.list_tickets(jwt, active_only=False, limit=200)

        if not tickets:
            dispatcher.utter_message(text="📊 No tickets found to generate a graph.")
            return []

        status_counts: dict = {}
        for t in tickets:
            label = ITSM_STATUS_DISPLAY.get(t.get("status", ""), "Unknown")
            status_counts[label] = status_counts.get(label, 0) + 1

        labels = list(status_counts.keys())
        values = list(status_counts.values())
        color_map = {
            "Open":             "#3B82F6",
            "In Progress":      "#F59E0B",
            "Pending":          "#8B5CF6",
            "Pending Approval": "#EC4899",
            "Approved":         "#06B6D4",
            "Rejected":         "#EF4444",
            "Resolved":         "#10B981",
            "Closed":           "#6B7280",
            "Cancelled":        "#9CA3AF",
            "Unknown":          "#D1D5DB",
        }
        colors = [color_map.get(lbl, "#D1D5DB") for lbl in labels]
        total  = sum(values)

        chart_data = {
            "type": "pie",
            "title": f"Tickets by Status ({total} total)",
            "labels": labels,
            "datasets": [{"data": values, "backgroundColor": colors, "borderColor": "#ffffff", "borderWidth": 2}],
        }
        summary  = f"**📊 Ticket Status Summary ({total} tickets)**\n\n"
        for lbl, val in zip(labels, values):
            pct = round(val / total * 100, 1)
            summary += f"- **{lbl}**: {val} ({pct}%)\n"

        dispatcher.utter_message(text=summary, json_message={"chart": chart_data})
        return []


class ValidateTicketForm(FormValidationAction):
    def name(self) -> Text:
        return "validate_ticket_form"

    def validate_ticket_content(
        self,
        slot_value: Any,
        dispatcher: CollectingDispatcher,
        tracker: Tracker,
        domain: Dict[Text, Any],
    ) -> Dict[Text, Any]:
        slots_to_set = {"ticket_content": slot_value}
        
        current_issue_type = tracker.get_slot("issue_type")
        if not current_issue_type and slot_value:
            text = slot_value.lower()
            if any(x in text for x in ["laptop", "printer", "screen", "monitor", "mouse", "keyboard", "pc", "computer", "device", "hardware", "machine", "webcam"]):
                slots_to_set["issue_type"] = "Hardware"
            elif any(x in text for x in ["wifi", "internet", "connection", "network", "vpn", "slow", "offline", "connect", "bandwidth"]):
                slots_to_set["issue_type"] = "Network"
            elif any(x in text for x in ["word", "excel", "outlook", "team", "app", "software", "crash", "error", "login", "password", "access", "license", "bug"]):
                slots_to_set["issue_type"] = "Software"
                
        return slots_to_set


# --- 16. Custom Action: Create Ticket From Form ---


class ActionCreateTicketFromForm(Action):
    def name(self) -> Text:
        return "action_create_ticket_from_form"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        jwt = get_iam_jwt(tracker)
        if not jwt:
            dispatcher.utter_message(text="Session is not active. Please sign in and try again.")
            return []

        message_text = tracker.latest_message.get("text", "")
        logger.info("[TicketForm] Raw message length: %d", len(message_text))
        try:
            json_start = message_text.find("{")
            if json_start == -1:
                raise ValueError("No JSON data found")
            form_data = json.loads(message_text[json_start:])
        except Exception as exc:
            logger.error("[TicketForm] Failed to parse form data: %s", exc)
            dispatcher.utter_message(text="❌ Error processing form data.")
            return []

        title    = form_data.get("title", "")
        detail   = form_data.get("detail", "")
        urgency  = form_data.get("urgency", "Medium")
        app_id   = tracker.get_slot("app_id") or "General"

        urgency_int = {"Low": 1, "Medium": 3, "High": 5}.get(urgency, 3)
        priority    = URGENCY_TO_PRIORITY.get(urgency_int, "medium")
        full_title  = f"[{app_id}] {title}"

        ticket = await itsm_service.create_ticket(
            jwt, full_title, detail or title, priority=priority
        )

        if ticket:
            ticket_ref = ticket.get("ticket_number") or ticket.get("id", "")
            dispatcher.utter_message(
                text=f"✅ Success! Ticket **{ticket_ref}** created.",
                buttons=[
                    {"title": "🔍 View Ticket", "payload": "/check_status"},
                    {"title": "📋 List Tickets", "payload": "/list_tickets"},
                ]
            )
            return [SlotSet("ticket_id", ticket_ref)]
        else:
            dispatcher.utter_message(text="❌ Failed to create ticket.")
            return []


# ======================================================================
# HANDOFF ACTIONS — Phase 2
# All config values come from the DB runtime config or the config file.
# Nothing is hardcoded here.
# ======================================================================

def _get_handoff_runtime_cfg() -> dict:
    """Load handoff runtime settings from DB. Returns safe defaults on error."""
    try:
        from common.conversation_db import get_handoff_runtime_config
        return get_handoff_runtime_config()
    except Exception:
        return {
            "triggers": {"confidence_threshold": 0.40, "confidence_streak_required": 2,
                         "frustration_threshold": 0.75, "frustration_streak_required": 2,
                         "direct_handoff_intents": []},
            "queue": {"default_priority": 5, "ask_user_after_mins": 15,
                      "max_queue_depth": 50},
            "operators": {"default_max_concurrent": 3, "auto_busy_on_max_load": True},
            "gdpr": {"consent_required": True}
        }


def _call_admin_api(path: str, method: str = "GET", data: dict = None) -> Optional[dict]:
    """Call the Admin API from within the Action Server."""
    import urllib.request
    import urllib.error
    try:
        from common.config_manager import get_server_config
        cfg = get_server_config()
        port = cfg.get('admin_port', 8181)
        url = f"http://127.0.0.1:{port}{path}"
        req_data = json.dumps(data).encode() if data else None
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={"Content-Type": "application/json"},
            method=method
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        logger.warning(f"Admin API call failed ({method} {path}): {e}")
        return None


def _score_frustration(text: str) -> float:
    """Return a frustration score 0.0–1.0 using a simple keyword heuristic.
    VADER is used when available; falls back to keyword matching."""
    if not text:
        return 0.0
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        score = SentimentIntensityAnalyzer().polarity_scores(text)
        neg = score.get('neg', 0.0)
        compound = score.get('compound', 0.0)
        return round(min(1.0, neg + max(0, -compound) * 0.5), 3)
    except ImportError:
        pass
    # Keyword fallback
    frustration_words = [
        'not working', 'broken', 'useless', 'terrible', 'awful', 'worst',
        'frustrated', 'angry', 'stupid', 'ridiculous', 'never works',
        'stop working', 'this is bad', 'waste of time', 'cant believe'
    ]
    text_lower = text.lower()
    hits = sum(1 for w in frustration_words if w in text_lower)
    return min(1.0, hits * 0.25)


