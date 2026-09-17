import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from common import analytics_store, attachment_store
from action_server.actions._shared import (
    log_bot_response,
    get_analytics_context, get_effective_session_token,
    check_user_login, itsm_service, logger,
    get_iam_identity, is_iam_authenticated, require_iam_auth,
    get_org_context, get_iam_jwt, bind_request_id,
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


class ActionPresentTicketForm(Action):
    """Launches ticket creation — replaces the plain `utter_ticket_form`
    step in rules.yml's two KB->ticket rules (2026-09-17 fix).

    utter_ticket_form is a `custom: {ticket_form: true}` payload meant for
    the web widget's rich inline form component (MessageBubble.jsx renders
    it, submits via `/submit_ticket_form{...}` on completion — see
    ChatWindow.jsx). That payload has no text/buttons at the top level, so
    non-widget channels (WhatsApp) received literally nothing for it —
    confirmed live on prod: KB search would skip correctly, but the
    conversation just dead-ended right after, no error anywhere since
    "nothing to send" isn't treated as a failure.

    The rest of the ticket_form flow (the per-slot utter_ask_* questions,
    confirmation, creation, /stop cancellation) was already fully built in
    rules.yml — see 'Submit ticket_form - Ask Confirmation', 'Create Ticket
    on Affirmation', 'Interrupt form with stop intent'. Only the initial
    *activation* was missing: nothing anywhere set active_loop=ticket_form,
    so that machinery was live but dormant on every channel, not just
    WhatsApp. This action is the one place that starts it.

    WIDGET/MOBILE BEHAVIOR IS UNCHANGED: for any channel other than
    WhatsApp, this dispatches the exact same custom payload
    utter_ticket_form always sent, byte for byte, and does NOT activate the
    form loop — the rich UI component is still what drives ticket creation
    there, exactly as before this change."""

    def name(self) -> Text:
        return "action_present_ticket_form"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        latest = tracker.latest_message
        metadata = (latest.get("metadata") or {}) if isinstance(latest, dict) else {}
        channel = (metadata.get("channel") or "") if isinstance(metadata, dict) else ""

        if channel.startswith("whatsapp"):
            # No custom-UI equivalent on WhatsApp -- start the (already
            # fully built, previously dormant) conversational form instead.
            # Rasa asks the first missing required_slot's utter_ask_* in
            # the same turn once active_loop is set, no extra text needed
            # here.
            return [ActiveLoop("ticket_form")]

        dispatcher.utter_message(
            custom={"ticket_form": True, "text": "Please fill out the ticket details below:"}
        )
        return []


class ActionCreateItsmTicket(Action):
    def name(self) -> Text:
        return "action_create_itsm_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
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
        meta     = tracker.latest_message.get("metadata", {}) if isinstance(tracker.latest_message, dict) else {}
        app_id   = tracker.get_slot("app_id") or meta.get("app_id")
        # Product the session is scoped to — slug (app_id) + display name from the
        # client metadata. The client only sends product_name when a real product is
        # selected, so gate on it (avoids creating bogus 'General'/'IT' products).
        # No product selected → slug stays None → ticket is productless (blank).
        product_name = meta.get("product_name") or None
        product_slug = (app_id or None) if product_name else None
        # TEMP diagnostic — confirm product metadata reaches the create action.
        logger.info("[CREATE PRODUCT] app_id=%r product_slug=%r product_name=%r meta_keys=%s",
                    app_id, product_slug, product_name, sorted(meta.keys()))

        if channel == "platform" and org_name:
            title_prefix = f"[{org_name}] "
        else:
            title_prefix = f"[{app_id or 'General'}] "

        full_title   = f"{title_prefix}{ticket_title}"
        description  = ticket_content or ticket_title or ""

        # itsm-service requires description >= 10 chars. Catch it here with a clear
        # message instead of letting the API return a cryptic 422 → generic failure.
        if len(description.strip()) < 10:
            msg = ("⚠️ Please describe the issue in a bit more detail "
                   "(at least 10 characters) so I can create the ticket.")
            dispatcher.utter_message(text=msg)
            log_bot_response(tracker, msg)
            return [SlotSet("ticket_content", None)]

        ticket = await itsm_service.create_ticket(
            jwt, full_title, description, priority=priority,
            product_slug=product_slug, product_name=product_name,
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
                    {"title": "🔍 Check Status", "payload": "/check_status"},
                    {"title": "📋 List", "payload": "/list_tickets"},
                    {"title": "🎫 New ticket", "payload": "/create_ticket"},
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
        bind_request_id(tracker)
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
            product_name = ticket_data.get("product_name") or ""
            ticket_ref   = ticket_data.get("ticket_number") or ticket_id_slot

            import re as _re
            # The product is shown in its own field, so strip the "[product]"
            # prefix the title is stored with.
            clean_title = _re.sub(r'^\[[^\]]*\]\s*', '', title)

            ticket_uuid = ticket_data.get("id")

            # Collect attachments (structured for the widget + text fallback).
            attach_list = []
            try:
                _ta = _time.monotonic()
                attachments = await itsm_service._get_list(
                    jwt, f"/api/v1/tickets/{ticket_uuid}/attachments"
                )
                logger.info("[STATUS TIMING] attachments=%.2fs", _time.monotonic() - _ta)
                for att in (attachments or []):
                    attach_list.append({
                        "filename": att.get("filename", "File"),
                        "url":      att.get("download_url"),
                        "mime":     att.get("mime_type", "") or "",
                    })
            except Exception as att_err:
                logger.warning("[CheckStatus] Could not fetch attachments: %s", att_err)

            # Public comments shown to the user. itsm-service filters internal
            # (agent-only) notes out for the end user's token, so we only ever
            # receive user-visible comments here. Most recent 5, oldest→newest.
            comment_list = []
            try:
                _tc = _time.monotonic()
                comments = await itsm_service._get_list(
                    jwt, f"/api/v1/tickets/{ticket_uuid}/comments"
                )
                logger.info("[STATUS TIMING] comments=%.2fs", _time.monotonic() - _tc)
                for c in (comments or [])[-5:]:
                    comment_list.append({
                        "author": c.get("author_name") or "Support",
                        "date":   (c.get("created_at") or "")[:16].replace("T", " "),
                        "body":   (c.get("body") or "").strip(),
                    })
            except Exception as cmt_err:
                logger.warning("[CheckStatus] Could not fetch comments: %s", cmt_err)

            # Text fallback (mobile / non-structured clients): status + priority on
            # the header line, [product] prefix stripped, no Property/Value table.
            message  = f"**Ticket {ticket_ref}: {current_status}"
            if priority:
                message += f" · {priority}"
            message += "**\n\n"
            message += f"**Title:** {clean_title}\n\n"
            if product_name:
                message += f"**Product:** {product_name}\n\n"
            if comment_list:
                message += "**💬 Comments:**\n\n"
                for c in comment_list:
                    hdr = c["author"] + (f" · {c['date']}" if c["date"] else "")
                    message += f"_{hdr}_\n{c['body']}\n\n"
            message += f"**Created:** {created_at}\n\n**Updated:** {updated_at}\n"
            if attach_list:
                message += "\n\n**📎 Attachments:**\n\n"
                for a in attach_list:
                    if a["url"] and a["mime"].startswith("image/"):
                        message += f"![{a['filename']}]({a['url']})\n"
                    elif a["url"]:
                        message += f"- [{a['filename']}]({a['url']})\n"
                    else:
                        message += f"- {a['filename']}\n"

            dispatcher.utter_message(
                text=message,
                json_message={"ticket_detail": {
                    "ref":         str(ticket_ref),
                    "status":      current_status,
                    "priority":    priority,
                    "title":       clean_title,
                    "product":     product_name,
                    "comments":    comment_list,
                    "created":     created_at,
                    "updated":     updated_at,
                    "attachments": attach_list,
                }},
                buttons=[
                    {"title": "📝 Update", "payload": "/update_ticket"},
                    {"title": "✅ Close", "payload": "/verify_resolution"},
                    {"title": "📋 List", "payload": "/list_tickets"},
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return []
            dispatcher.utter_message(text="❌ Authentication required.")
            return []

        latest_msg = tracker.latest_message
        user_text  = latest_msg.get("text", "").lower() if isinstance(latest_msg, dict) else ""
        show_history = any(w in user_text for w in ["all", "history", "closed", "past", "old", "every"])

        # Read filter params from the /list_tickets{...} payload. Rasa's REST
        # payload parser does NOT reliably surface these as NLU entities (verified:
        # parse returns []), so parse the JSON object out of the message text
        # directly, falling back to any entities Rasa did extract.
        import json as _json
        entities = latest_msg.get("entities", []) if isinstance(latest_msg, dict) else []
        raw_text = latest_msg.get("text", "") if isinstance(latest_msg, dict) else ""
        params = {}
        _brace = raw_text.find("{")
        if _brace != -1:
            try:
                params = _json.loads(raw_text[_brace:])
            except Exception:
                params = {}
        for e in entities:
            if e.get("entity") and e.get("entity") not in params and e.get("value") is not None:
                params[e["entity"]] = e["value"]

        itsm_status_filter = None
        status_name        = None
        if params.get("status_id") is not None:
            try:
                itsm_sid = int(params["status_id"])
                # Map ITSM status id → itsm status string
                _itsm_to_itsm = {
                    1: "open", 2: "in_progress", 3: "in_progress",
                    4: "pending", 5: "resolved", 6: "closed", 10: "approved",
                }
                itsm_status_filter = _itsm_to_itsm.get(itsm_sid)
                status_name = ITSM_STATUS_DISPLAY.get(itsm_status_filter, "")
            except (ValueError, TypeError):
                pass

        # Record limit from the filter popup (e.g. /list_tickets{"limit": 5}).
        record_limit = 15  # default cap when not specified
        if params.get("limit") is not None:
            try:
                record_limit = max(1, int(params["limit"]))
            except (ValueError, TypeError):
                pass

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

        # Structured rows for the 3-column card layout rendered by the clients:
        #   col 1: ticket no (+ date below)   col 2: title (+ product below)   col 3: status
        # product_name is null when the ticket has no product → shown blank.
        rows = []
        for t in tickets[:record_limit]:
            title = (t.get("title") or "No Title")
            # Drop a leading "[context]" prefix — product is its own column now.
            title = re.sub(r"^\[[^\]]*\]\s*", "", title)
            rows.append({
                "no":      str(t.get("ticket_number", t.get("id", "?"))),
                "date":    _fmt_date(t.get("updated_at")),
                "title":   title,
                "product": t.get("product_name") or "",
                "status":  ITSM_STATUS_DISPLAY.get(t.get("status", ""), "Unknown"),
            })

        dispatcher.utter_message(
            text=f"**📂 {context_title}**",
            json_message={"ticket_list": {"title": context_title, "rows": rows}},
            buttons=[
                {"title": "📊 View Graph", "payload": "/show_ticket_graph"},
                {"title": "🔍 Check Status", "payload": "/check_status"},
                {"title": "🎫 New ticket", "payload": "/create_ticket"},
            ]
        )
        return []


class ActionUploadFile(Action):
    def name(self) -> Text:
        return "action_upload_file"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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
        bind_request_id(tracker)
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

        # Product the session is scoped to — from client metadata. Only set when a
        # real product is selected (client sends product_name then); else productless.
        meta = tracker.latest_message.get("metadata", {}) if isinstance(tracker.latest_message, dict) else {}
        product_name = meta.get("product_name") or None
        product_slug = (meta.get("app_id") or tracker.get_slot("app_id") or None) if product_name else None
        logger.info("[CREATE PRODUCT form] product_slug=%r product_name=%r meta_keys=%s",
                    product_slug, product_name, sorted(meta.keys()))

        urgency_int = {"Low": 1, "Medium": 3, "High": 5}.get(urgency, 3)
        priority    = URGENCY_TO_PRIORITY.get(urgency_int, "medium")
        full_title  = f"[{app_id}] {title}"

        ticket = await itsm_service.create_ticket(
            jwt, full_title, detail or title, priority=priority,
            product_slug=product_slug, product_name=product_name,
        )

        if ticket:
            ticket_ref  = ticket.get("ticket_number") or ticket.get("id", "")
            ticket_uuid = ticket.get("id", "")

            # Upload any file stashed during the form (pre-ticket upload). The
            # bytes were saved by /api/ticket-attachment and referenced by doc_id;
            # now that the ticket exists we push them to itsm via presigned PUT.
            attach_note = ""
            attachment = form_data.get("attachment") or {}
            doc_id = attachment.get("doc_id")
            if doc_id and ticket_uuid:
                loaded = attachment_store.load(doc_id)
                if loaded:
                    data, fname, mime = loaded
                    uploaded = await itsm_service.upload_attachment(
                        jwt, ticket_uuid, data, fname, mime
                    )
                    attachment_store.discard(doc_id)
                    if uploaded:
                        attach_note = f"\n\n📎 Attached: **{fname}**"
                    else:
                        attach_note = (
                            f"\n\n⚠️ Ticket created, but the attachment '{fname}' "
                            f"could not be uploaded — you can add it from the ticket "
                            f"detail view."
                        )
                else:
                    logger.warning("[TicketForm] attachment token not found in store")

            dispatcher.utter_message(
                text=f"✅ Success! Ticket **{ticket_ref}** created.{attach_note}",
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


