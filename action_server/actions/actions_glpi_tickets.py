import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from action_server.actions.glpi_service import GlpiService
from common import analytics_store
from common.config_manager import get_glpi_config
from action_server.actions._shared import (
    get_glpi_service, get_glpi_base_url, log_bot_response,
    get_analytics_context, get_effective_session_token,
    check_user_login, glpi_service, logger,
    get_iam_identity, is_iam_authenticated, require_iam_auth,
    get_org_context,
)


class ActionCreateGlpiTicket(Action):
    def name(self) -> Text:
        return "action_create_glpi_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # ── Auth check: prefer IAM, fall back to GLPI session ─────────────────
        iam = get_iam_identity(tracker)
        if iam["sub"]:
            # IAM authenticated — get or provision GLPI user
            session_token = get_effective_session_token(tracker)  # may be None (service account used)
            try:
                from common.db.iam_glpi_users import get_or_provision_glpi_user
                glpi_requester_id = get_or_provision_glpi_user(
                    iam_sub=iam["sub"], name=iam["name"],
                    email=iam["email"],
                    given_name=iam.get("given_name", ""),
                    family_name=iam.get("family_name", ""),
                )
            except Exception as e:
                logger.warning(f"[IAM] Failed to provision GLPI user: {e}")
                glpi_requester_id = None
        else:
            # Legacy GLPI session path
            if not await check_user_login(tracker, dispatcher):
                return [SlotSet("ticket_id", None)]
            session_token = get_effective_session_token(tracker)
            glpi_requester_id = None  # GLPI session owns the requester context

        # Retrieve form slots
        ticket_title   = tracker.get_slot("ticket_title")
        ticket_content = tracker.get_slot("ticket_content")
        issue_type     = tracker.get_slot("issue_type")
        urgency        = tracker.get_slot("urgency")

        urgency_map = {"Low": 1, "Medium": 3, "High": 5}

        # ── Org + product context ──────────────────────────────────────────────
        org_ctx    = get_org_context(tracker)
        org_id     = org_ctx["org_id"]
        org_name   = org_ctx["org_name"]
        channel    = org_ctx["channel"]
        product_id = org_ctx["product_id"]

        app_id = tracker.get_slot("app_id")
        if not app_id:
            latest_msg = tracker.latest_message
            if isinstance(latest_msg, dict):
                app_id = latest_msg.get("metadata", {}).get("app_id")

        # ── Entity ID: org-aware via entity manager, fallback to legacy map ────
        try:
            from common.glpi_entity_manager import get_entity_id_sync, get_category_id
            entity_id   = get_entity_id_sync(org_id, org_name) if org_id else 0
            itil_cat_id = get_category_id(product_id) if product_id else 0
        except Exception as _em_err:
            logger.warning(f"[OrgCtx] entity/category lookup failed: {_em_err}")
            entity_id   = 0
            itil_cat_id = 0

        if not entity_id:
            entity_id = {"Root": 0, "IT": 1, "Accounting": 2}.get(app_id, 1)

        # Fall back to legacy hardcoded category when config has no mapping yet
        if not itil_cat_id:
            if app_id == "Accounting":
                itil_cat_id = {"Hardware": 10, "Software": 11, "Network": 12, "Other": 2}.get(issue_type, 2)
            else:
                itil_cat_id = {"Hardware": 4, "Software": 6, "Network": 8, "Other": 1}.get(issue_type, 1)

        # In platform channel prefix title with org name so 99Tech operators see source org
        if channel == "platform" and org_name:
            title_prefix = f"[{org_name}] "
        else:
            title_prefix = f"[{app_id or 'General'}] "

        ticket_data = {
            "name":               f"{title_prefix}{ticket_title}",
            "content":            ticket_content,
            "urgency":            urgency_map.get(urgency, 3),
            "itilcategories_id":  itil_cat_id,
        }
        if glpi_requester_id:
            ticket_data["_users_id_requester"] = glpi_requester_id

        new_ticket_id = await glpi_service.create_ticket(session_token, ticket_data, entity_id)
        
        if new_ticket_id:
            ticket_ref = f"Ticket-{new_ticket_id}"
            # Build SLA line
            try:
                from common.config_manager import get_sla_config
                sla   = get_sla_config()
                prio  = (urgency or 'Medium').lower()
                hours = sla.get(prio, sla.get('medium', 8))
                sla_line = f"\n⏱ Expected resolution: ~{hours}h ({urgency or 'Medium'} priority)"
            except Exception:
                sla_line = ''
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
            response_text = "❌ Failed to create ticket. Please check API credentials and URL."
            dispatcher.utter_message(text=response_text)
            log_bot_response(tracker, response_text)
            return []


# --- 2. Custom Action: Check Status ---


class ActionCheckGlpiStatus(Action):
    def name(self) -> Text:
        return "action_check_glpi_status"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        print(f"DEBUG: Entering action_check_glpi_status")
        logger.info("DEBUG: Entering action_check_glpi_status")

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return [SlotSet("ticket_id", None)]
        session_token = get_effective_session_token(tracker)

        ticket_id_slot = tracker.get_slot("ticket_id")
        
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        ticket_number = ticket_id_slot.upper().replace('GLPI-', '').replace('TICKET-', '')
        
        # Entity context is set in ActionInitGlpiSession
        # GLPI should only return tickets in the active entity
        app_id = tracker.get_slot("app_id")
        logger.info(f"ActionCheckGlpiStatus: Checking ticket {ticket_number} for app_id={app_id}")

        # Map app_id to entity_id for GLPI-Entity header
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)  # Default to IT (1)

        # Use service account token for ticket lookup (user token may be expired on mobile)
        svc = get_glpi_service()
        svc_token = await svc.init_session() or session_token
        ticket_data = await glpi_service.get_ticket(svc_token, ticket_number, entity_id)

        if ticket_data:
            # --- Entity Access Control ---
            app_id = tracker.get_slot("app_id")
            if not app_id:
                app_id = tracker.latest_message.get("metadata", {}).get("app_id")

            entity_id_map = {
                "Root": 0,    # Root Entity (Default)
                "IT": 1,      # IT Entity
                "Accounting": 2,   # Accounting Entity
            }

            # Only enforce entity check when app_id is a known context
            if app_id in entity_id_map:
                expected_entity_id = entity_id_map[app_id]
                ticket_entity = ticket_data.get("entities_id")
                try:
                    ticket_entity_id = int(ticket_entity)
                except (ValueError, TypeError):
                    ticket_entity_id = -1

                # Root entity (0) is parent of all — always allowed
                if ticket_entity_id != 0 and ticket_entity_id != expected_entity_id:
                    logger.warning(f"Access Denied: Ticket {ticket_id_slot} (Entity {ticket_entity_id}) does not belong to App Context {app_id} (Entity {expected_entity_id})")
                    dispatcher.utter_message(text=f"❌ **Invalid ticket.** Ticket **{ticket_id_slot}** does not belong to the **{app_id}** department.")
                    return [SlotSet("ticket_id", None)]
            # -----------------------------
            status_map = {
                1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
            }
            
            def _fmt_date(raw):
                try:
                    from datetime import datetime
                    dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
                    return dt.strftime("%y-%m-%d %H:%M")
                except Exception:
                    return raw or "N/A"

            current_status_id = ticket_data.get("status")
            current_status = status_map.get(current_status_id, "Unknown Status")
            title = ticket_data.get("name", "No Title")
            date_creation = _fmt_date(ticket_data.get("date_creation", ""))
            date_mod = _fmt_date(ticket_data.get("date_mod", ""))
            
            # Simple content clean up (strip HTML loosely if needed or just show snippet)
            # content = ticket_data.get("content", "")[:100] + "..."

            message = f"**Ticket Details: {ticket_id_slot}**\n\n"
            message += "| Property | Value |\n"
            message += "| :--- | :--- |\n"
            message += f"| **Status** | {current_status} |\n"
            message += f"| **Title** | {title} |\n"
            message += f"| **Created** | {date_creation} |\n"
            message += f"| **Updated** | {date_mod} |\n"

            # Fetch attachments using service account token (user token lacks Document_Item read permission)
            try:
                numeric_id = int(ticket_number)
                svc = get_glpi_service()
                svc_token = await svc.init_session()
                if svc_token:
                    docs = await glpi_service.get_ticket_documents(svc_token, numeric_id, entity_id)
                    logger.info(f"[CheckStatus] get_ticket_documents returned {len(docs)} docs")
                    if docs:
                        message += "\n\n**📎 Attachments:**\n\n"
                        for doc in docs:
                            doc_id = doc.get('id')
                            fname = doc.get('filename') or doc.get('name', 'File')
                            mime = doc.get('mime', '')
                            url = f"/api/ticket-attachment?doc_id={doc_id}"
                            if mime.startswith('image/'):
                                message += f"![{fname}]({url}) "
                            else:
                                message += f"- [{fname}]({url})\n"
            except Exception as e:
                logger.warning(f"[CheckStatus] Could not fetch attachments: {e}", exc_info=True)

            dispatcher.utter_message(
                text=message,
                buttons=[
                    {"title": "📝 Update this ticket", "payload": "/update_ticket"},
                    {"title": "✅ Close ticket", "payload": "/verify_resolution"},
                    {"title": "📋 List all tickets", "payload": "/list_tickets"},
                ]
            )
            log_bot_response(tracker, message)
            return [SlotSet("ticket_status", current_status)]
        else:
            error_msg = "❌ Could not retrieve ticket status (Not Found or API Error)."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("ticket_id", None)]


# --- 3. Custom Action: Update Ticket (Status or Content) ---


class ActionUpdateGlpiTicket(Action):
    def name(self) -> Text:
        return "action_update_glpi_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return []

        session_token = get_effective_session_token(tracker)

        ticket_id_slot = tracker.get_slot("ticket_id")

        # 1. Ask for Ticket ID if missing
        if not ticket_id_slot:
             dispatcher.utter_message(response="utter_ask_ticket_id")
             return []

        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))
        
        # 2. Check if we have a target_status OR update_content
        target_status = tracker.get_slot("target_status")
        update_content = tracker.get_slot("update_content")

        if target_status:
            # Handle Status Update
            status_map = {
                "New": 1, "Processing (Assigned)": 2, "Processing (Planned)": 3, 
                "Pending": 4, "Solved": 5, "Closed": 6, "Approved": 10
            }
            # Allow case-insensitive matching if direct input, or exact from buttons
            # Simple fuzzy match attempt or direct map
            status_id = status_map.get(target_status)
            if not status_id:
                # Try simple lookups
                if "processing" in target_status.lower(): status_id = 2
                elif "pending" in target_status.lower(): status_id = 4
                elif "solved" in target_status.lower(): status_id = 5
                elif "closed" in target_status.lower(): status_id = 6
                else:
                    dispatcher.utter_message(text=f"I didn't recognize expectations for status '{target_status}'.")
                    return [SlotSet("target_status", None)]

            success = await glpi_service.update_ticket_status(session_token, ticket_number, status_id)
            if success:
                 dispatcher.utter_message(text=f"✅ Ticket **{ticket_id_slot}** status updated to **{target_status}**.")
                 if status_id == 6: # Closed
                     dispatcher.utter_message(response="utter_ask_satisfaction")
                 return [SlotSet("target_status", None), SlotSet("ticket_status", target_status)]
            else:
                 dispatcher.utter_message(text="❌ Failed to update ticket status.")
                 return [SlotSet("target_status", None)]

        elif update_content:
            # Handle Comment Update
            success = await glpi_service.add_ticket_followup(session_token, ticket_number, update_content)
            if success:
                dispatcher.utter_message(text=f"✅ Added comment to ticket **{ticket_id_slot}**.")
                return [SlotSet("update_content", None)]
            else:
                dispatcher.utter_message(text="❌ Failed to add comment.")
                return []
        else:
            # 3. If neither provided, Show Status and Ask
            ticket_data = await glpi_service.get_ticket(session_token, ticket_number)
            if ticket_data:
                status_map_rev = {
                    1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                    4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
                }
                curr_status = status_map_rev.get(ticket_data.get("status"), "Unknown")
                
                # Show status and buttons via utter_ask_target_status
                dispatcher.utter_message(
                    response="utter_ask_target_status", 
                    ticket_status=curr_status
                )
                # We return SlotSet("ticket_status", curr_status) so the slot is filled for the message
                return [SlotSet("ticket_status", curr_status)]
            else:
                dispatcher.utter_message(text="❌ Ticket not found.")
                return []

# --- 4. Custom Action: Verify Resolution (Show Status & Close) ---


class ActionVerifyGlpiResolution(Action):
    def name(self) -> Text:
        return "action_verify_glpi_resolution"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        session_token = get_effective_session_token(tracker)
        if not session_token:
            dispatcher.utter_message(text="Session is not active.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))

        # Check if we assume 'affirm' means 'Close it'
        # But we need a way to track if we just showed the status.
        # Simplest approach logic:
        # If last intent was 'verify_resolution', show status and ask.
        # If last intent was 'affirm', close it.
        # However, custom actions don't easily persist state this way without slots.
        
        # Let's leverage the 'target_status' slot again.
        # If target_status is explicitly 'Closed', we close.
        # If not, we show status and set a button to Close.
        
        target_status = tracker.get_slot("target_status")
        
        if target_status == "Solved":
             success = await glpi_service.update_ticket_status(session_token, ticket_number, 5)
             if success:
                dispatcher.utter_message(text=f"✅ Ticket **{ticket_id_slot}** has been marked as **Solved**. Glad I could help!")
                dispatcher.utter_message(response="utter_ask_satisfaction")
                return [SlotSet("ticket_status", "Solved"), SlotSet("target_status", None)]
             else:
                dispatcher.utter_message(text="❌ Failed to solve the ticket.")
                return [SlotSet("target_status", None)]
        
        # Fetch current status
        ticket_data = await glpi_service.get_ticket(session_token, ticket_number)
        if ticket_data:
            status_map_rev = {
                1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
            }
            curr_status = status_map_rev.get(ticket_data.get("status"), "Unknown")
            
            if curr_status == "Solved" or curr_status == "Closed":
                dispatcher.utter_message(text=f"Ticket **{ticket_id_slot}** is already **{curr_status}**.")
                return [SlotSet("ticket_status", curr_status)]

            # Ask to confirm closure
            dispatcher.utter_message(
                text=f"Ticket **{ticket_id_slot}** is currently **{curr_status}**. Do you want to mark it as **Solved**?",
                buttons=[
                    {"title": "Yes, Mark as Solved", "payload": '/inform_update{"target_status":"Solved"}'},
                    {"title": "No, keep it open", "payload": '/deny'} 
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

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return []

        session_token = get_effective_session_token(tracker)

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))

        followups = await glpi_service.get_ticket_followups(session_token, ticket_number)
        
        if not followups:
             dispatcher.utter_message(text=f"No comments found for ticket **{ticket_id_slot}**.")
             return []
        
        # Sort by date (assuming 'date' field exists, otherwise rely on list order)
        # GLPI usually returns them in order, but let's be safe.
        followups.sort(key=lambda x: x.get('date', ''))
        
        # Limit to last 5 for readability
        recent_comments = followups[-5:]
        
        message = f"**Recent comments for {ticket_id_slot}:**\n\n"
        for comment in recent_comments:
            # Strip HTML tags if necessary, GLPI content is HTML
            import re
            clean_content = re.sub('<[^<]+?>', '', comment.get('content', ''))
            user_id = comment.get('users_id')
            date = comment.get('date')
            message += f"📅 *{date}* (User {user_id}):\n{clean_content}\n\n"
            
        dispatcher.utter_message(text=message)
        return []


# --- 7. Custom Action: List Open Tickets ---


class ActionListOpenTickets(Action):
    def name(self) -> Text:
        return "action_list_open_tickets"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return []

        session_token = get_effective_session_token(tracker)

        # Determine if user wants ALL tickets or just OPEN ones
        latest_msg = tracker.latest_message
        user_text = latest_msg.get("text", "").lower() if isinstance(latest_msg, dict) else str(latest_msg).lower()
        history_keywords = ['all', 'history', 'closed', 'past', 'old', 'every']
        show_history = any(word in user_text for word in history_keywords)
        
        # Entity context is already set in ActionInitGlpiSession via changeActiveEntities
        # GLPI will automatically filter tickets to the active entity
        
        # Get app_id from slot first, then fallback to message metadata
        app_id = tracker.get_slot("app_id")
        latest_msg = tracker.latest_message
        if isinstance(latest_msg, dict):
            msg_metadata = latest_msg.get("metadata", {})
            if isinstance(msg_metadata, str):
                try:
                    msg_metadata = json.loads(msg_metadata)
                except:
                    msg_metadata = {}
            elif msg_metadata is None:
                msg_metadata = {}
            if isinstance(msg_metadata, dict) and msg_metadata.get("app_id"):
                app_id = msg_metadata.get("app_id")

        session_token = get_effective_session_token(tracker)

        # Check for status_id in custom payload entities
        status_id = None
        status_name = None
        
        # Try to parse from message text if it looks like JSON payload from button
        # e.g. /list_tickets{"status_id": 1}
        # Rasa usually extracts these into entities, but let's check manually if entities are missing
        latest_message = tracker.latest_message
        entities = latest_message.get("entities", [])
        text = latest_message.get("text", "")
        
        logger.info(f"DEBUG: latest_message text: '{text}'")
        logger.info(f"DEBUG: latest_message entities: {entities}")

        # Check entities first
        for e in entities:
             if e['entity'] == 'status_id':
                 status_id = int(e['value'])
                 break
        
        # Manual Fallback: Parse JSON from text if entity missing
        # e.g. /list_tickets{"status_id": 1}
        if status_id is None and text.startswith('/list_tickets{'):
            try:
                import json
                json_str = text.replace('/list_tickets', '')
                logger.info(f"DEBUG: Manual parsing json_str: '{json_str}'")
                data = json.loads(json_str)
                if 'status_id' in data:
                    status_id = int(data['status_id'])
            except Exception as e:
                logger.error(f"Failed to parse manual status_id: {e}") 
        
        logger.info(f"DEBUG: Final status_id: {status_id}")
        # But for custom payload buttons "/intent{json}", Rasa parses entities automatically.
        # Let's also check if we can get it from metadata or just passed arguments if any
        
        # status map for display
        status_map_rev = {
            1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
            4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
        }
        
        if status_id:
             status_name = status_map_rev.get(status_id, f"Status {status_id}")

        # Map app_id to entity_id for GLPI-Entity header
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)  # Default to IT (1)
        logger.info(f"ActionListOpenTickets: app_id={app_id}, entity_id={entity_id}, status_id={status_id}")

        # Re-scope GLPI entity context in case app_id changed mid-session
        try:
            await glpi_service.change_active_entities(session_token, entity_id, is_recursive=True)
        except Exception as e:
            logger.warning(f"Failed to switch GLPI entity context: {e}")

        # Call service (GLPI returns only tickets visible in current entity context)
        # If status_id is set, active_only should technically be ignored by the service if we rely on criteria,
        # but let's be explicit: if looking for Closed (6), then active_only must be False.
        
        filter_active = not show_history
        if status_id is not None:
             filter_active = False # Let status_id dictate
             
        tickets = await glpi_service.get_user_tickets(session_token, active_only=filter_active, entity_id=entity_id, status_id=status_id)
        
        if not tickets:
             target_dept = app_id if app_id else "Root"
             filter_text = f" with status **{status_name}**" if status_name else ""
             dispatcher.utter_message(text=f"You have no tickets{filter_text} in the **{target_dept}** department.")
             return []
        
        # Header
        context_title = f"Tickets ({status_name})" if status_name else ("Ticket History" if show_history else "Your Open Tickets")
        message = f"**📂 {context_title}**\n\n"
        
        # Table Header
        message += "| ID | Status | Title | Updated |\n"
        message += "| :--- | :--- | :--- | :--- |\n"

        for t in tickets[:15]: # Limit increased to 15
            tid = t.get('id')
            title = t.get('name', 'No Title')
            # Escape pipes in title to prevent breaking table
            title = title.replace('|', '-')
            
            t_status_id = t.get('status')
            date_mod = t.get('date_mod', 'N/A').split(" ")[0] # Just date, no time
            
            status_str = status_map_rev.get(t_status_id, "Unknown")
            
            # Truncate title
            title_short = (title[:25] + '..') if len(title) > 25 else title
            
            message += f"| **{tid}** | {status_str} | {title_short} | {date_mod} |\n"
            
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

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return []

        session_token = get_effective_session_token(tracker)

        file_name = tracker.get_slot("file_name")
        file_data = tracker.get_slot("file_data")
        ticket_id = tracker.get_slot("ticket_id") # context

        if not file_name or not file_data:
            if ticket_id:
                 clean_id = ticket_id.replace("GLPI-", "") if isinstance(ticket_id, str) else ticket_id
                 dispatcher.utter_message(text=f"Please upload the file using the paperclip icon for ticket **{clean_id}**.")
            else:
                 dispatcher.utter_message(text="Please drag and drop a file or use the attachment icon to upload.")
            return []

        # Upload
        doc_id = await glpi_service.upload_document(session_token, file_name, file_data)
        
        if doc_id:
            msg = f"✅ **File Uploaded!** (Doc ID: {doc_id})\n"
            
            # Link to ticket if context exists
            if ticket_id:
                # Cleanup ID if it has prefix
                clean_id = ticket_id.replace("GLPI-", "") if isinstance(ticket_id, str) else ticket_id
                clean_id = ticket_id.replace("GLPI-", "").replace("TICKET-", "") if isinstance(ticket_id, str) else ticket_id
                
                success = await glpi_service.link_document_to_ticket(session_token, clean_id, doc_id)
                if success:
                    msg += f"🔗 Successfully attached to Ticket **TICKET-{clean_id}**."
                else:
                    msg += f"⚠️ Uploaded, but **failed to link** to Ticket TICKET-{clean_id}."
            else:
                 msg += "ℹ️ File is in documents, but **not attached** to any ticket.\nTip: Open or create a ticket first to attach files automatically."

            dispatcher.utter_message(text=msg)
            return [SlotSet("file_name", None), SlotSet("file_data", None)]
        dispatcher.utter_message(text="❌ Failed to upload file.")
        return []


class ActionListAttachments(Action):
    def name(self) -> Text:
        return "action_list_attachments"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        logger.info("DEBUG: ActionListAttachments started")

        # Check if user is logged in
        if not await check_user_login(tracker, dispatcher):
            return []

        session_token = get_effective_session_token(tracker)

        ticket_id_slot = tracker.get_slot("ticket_id")
        logger.info(f"DEBUG: Ticket ID slot is {ticket_id_slot}")
        if not ticket_id_slot:
            logger.info("DEBUG: No ticket_id slot")
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []
        
        try:
            ticket_number = int(ticket_id_slot.upper().replace('GLPI-', '').replace('TICKET-', ''))
            logger.info(f"DEBUG: Ticket number parsed: {ticket_number}")
        except Exception as e:
            logger.error(f"DEBUG: Failed to parse ticket number: {e}")
            dispatcher.utter_message(text=f"Invalid ticket ID format: {ticket_id_slot}")
            return []
        
        # Call service
        try:
            docs = await glpi_service.get_ticket_documents(session_token, ticket_number)
            logger.info(f"DEBUG: Docs returned: {docs}")
        except Exception as e:
             logger.error(f"DEBUG: API Call Failed: {e}")
             dispatcher.utter_message(text="Failed to retrieve attachments due to an error.")
             return []
        
        if not docs:
             logger.info("DEBUG: No docs found")
             dispatcher.utter_message(text=f"No attachments found for ticket **{ticket_id_slot}**.")
             return []
        
        message = f"**📎 Attachments for {ticket_id_slot}:**\n\n"
        message += "| ID | Name | Type | Action |\n"
        message += "| :--- | :--- | :--- | :--- |\n"
        
        for d in docs:
            doc_id = d.get('id')
            name = d.get('name', 'Document')
            filename = d.get('filename', '')
            mime = d.get('mime', 'application/octet-stream')
            
            # Simple Type Display
            if "image" in mime:
                type_icon = "🖼️ Image"
            elif "pdf" in mime:
                type_icon = "📄 PDF"
            else:
                type_icon = "📁 File"
                
            
            # Use config to get base URL
            config = get_glpi_config()
            api_url = config.get('api_url', '')
            base_url = api_url.replace('/apirest.php', '')
            download_link = f"[Download]({base_url}/front/document.send.php?docid={doc_id})"
            
            message += f"| {doc_id} | {filename or name} | {type_icon} | {download_link} |\n"

        logger.info(f"DEBUG: Sending message: {message}")
        dispatcher.utter_message(text=message)
        
        # Secondary pass: Show inline images if any
        # Note: This might fail if the user isn't logged into GLPI in their browser, 
        # as the image needs auth. Safe to skip or warn? 
        # Let's try to show the first image as a preview if possible, but safely.
        
        # Actually, without a public token, inline images usually break. 
        # Better to stick to the table for stability.
        
        return []

# --- 11. Custom Action: Clear Session ---


class ActionShowTicketGraph(Action):
    """Generates a pie chart showing tickets grouped by status."""
    
    def name(self) -> Text:
        return "action_show_ticket_graph"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        session_token = get_effective_session_token(tracker)
        if not session_token:
            dispatcher.utter_message(text="❌ Please log in first to view your ticket graph.")
            return []
        
        # Get app_id for entity filtering
        app_id = tracker.get_slot("app_id")
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)
        
        # Fetch all tickets (not just active)
        tickets = glpi_service.get_user_tickets(session_token, active_only=False, entity_id=entity_id)
        
        if not tickets:
            dispatcher.utter_message(text="📊 No tickets found to generate a graph.")
            return []
        
        # Count tickets by status
        status_map = {
            1: "New", 2: "Processing", 3: "Planned", 
            4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
        }
        status_counts = {}
        
        for t in tickets:
            status_id = t.get('status', 0)
            status_name = status_map.get(status_id, "Unknown")
            status_counts[status_name] = status_counts.get(status_name, 0) + 1
        
        # Prepare chart data
        labels = list(status_counts.keys())
        values = list(status_counts.values())
        
        # Status colors
        color_map = {
            "New": "#3B82F6",        # Blue
            "Processing": "#F59E0B", # Amber
            "Planned": "#8B5CF6",    # Purple
            "Pending": "#EF4444",    # Red
            "Solved": "#10B981",     # Green
            "Closed": "#6B7280",     # Gray
            "Approved": "#06B6D4",   # Cyan
            "Unknown": "#9CA3AF"     # Light gray
        }
        colors = [color_map.get(label, "#9CA3AF") for label in labels]
        
        chart_data = {
            "type": "pie",
            "title": f"Tickets by Status ({sum(values)} total)",
            "labels": labels,
            "datasets": [
                {
                    "data": values,
                    "backgroundColor": colors,
                    "borderColor": "#ffffff",
                    "borderWidth": 2
                }
            ]
        }
        
        # Generate summary text
        summary = f"**📊 Ticket Status Summary ({sum(values)} tickets)**\n\n"
        for label, value in zip(labels, values):
            pct = round((value / sum(values)) * 100, 1)
            summary += f"- **{label}**: {value} ({pct}%)\n"
        
        dispatcher.utter_message(
            text=summary,
            json_message={"chart": chart_data}
        )
        
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
        
        session_token = get_effective_session_token(tracker)
        if not session_token:
            dispatcher.utter_message(text="Session is not active. Please start over.")
            return []

        # Parse JSON payload from message text
        # Format: /submit_ticket_form{"title": "...", ...}
        message_text = tracker.latest_message.get("text", "")
        logger.info(f"[TicketForm] Raw message length: {len(message_text)}")
        try:
            json_start = message_text.find("{")
            if json_start == -1:
                raise ValueError("No JSON data found")

            form_data = json.loads(message_text[json_start:])
        except Exception as e:
            logger.error(f"Failed to parse ticket form data: {e}")
            dispatcher.utter_message(text="❌ Error processing form data.")
            return []

        title = form_data.get("title")
        detail = form_data.get("detail", "")
        priority = form_data.get("priority", "Medium")
        urgency = form_data.get("urgency", "Medium")
        category = form_data.get("category", "Hardware")
        attachment = form_data.get("attachment")  # { name, doc_id } after pre-upload, or None
        logger.info(f"[TicketForm] attachment present: {attachment is not None}, doc_id={attachment.get('doc_id') if attachment else None}")

        # Map Form Values to GLPI IDs
        urgency_map = {"Low": 1, "Medium": 3, "High": 5}
        
        # Context-Aware Category Mapping (Simplified for now)
        app_id = tracker.get_slot("app_id") or "General"
        
        if app_id == "Accounting":
            category_id_map = {
                "Hardware": 10, 
                "Software": 11, 
                "Network": 12,
                "Other": 2     
            }
        else: # Default (IT)
            category_id_map = {"Hardware": 4, "Software": 6, "Network": 8, "Other": 1}

        ticket_data = {
            "name": f"[{app_id}] {title}",
            "content": detail,
            "urgency": urgency_map.get(urgency, 3),
            "itilcategories_id": category_id_map.get(category, 1),
            "users_id_requester": 1,
        }

        # Embed attachment during creation to avoid separate Document_Item permission issues
        attach_note = ""
        if attachment and attachment.get("doc_id") and attachment.get("name"):
            try:
                doc_id = int(attachment["doc_id"])
                ticket_data["_documents_id"] = [doc_id]
                logger.info(f"[TicketForm] Embedding doc_id={doc_id} in ticket creation payload")
                attach_note = f"\n📎 Attachment **{attachment['name']}** linked."
            except Exception as e:
                logger.error(f"[TicketForm] Could not embed attachment: {e}")

        # Entity Mapping
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)

        # Create Ticket
        new_ticket_id = await glpi_service.create_ticket(session_token, ticket_data, entity_id)

        if new_ticket_id:
            ticket_ref = f"TICKET-{new_ticket_id}"

            dispatcher.utter_message(
                text=f"✅ Success! Ticket **{ticket_ref}** created.{attach_note}",
                buttons=[
                    {"title": "🔍 View Ticket", "payload": "/check_status"},
                    {"title": "📋 List Tickets", "payload": "/list_tickets"},
                ]
            )
            return [ SlotSet("ticket_id", ticket_ref) ]
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


