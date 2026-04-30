
import re
import logging
import aiohttp
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

class GlpiService:
    async def remove_glpi_from_kb(self, session_token: str) -> int:
        """Find all GLPI KB items and replace 'glpi' with '' in their content/title/answer fields."""
        updated_count = 0
        kb_items = await self.get_all_knowbase_items(session_token)
        for item in kb_items:
            item_id = item.get('id')
            if not item_id:
                continue
            updated = False
            update_data = {}
            # Check and replace in 'name', 'content', 'answer' fields
            for field in ['name', 'content', 'answer']:
                val = item.get(field)
                if isinstance(val, str) and 'glpi' in val.lower():
                    update_data[field] = re.sub(r'(?i)glpi', '', val)
                    updated = True
            if updated:
                await self.update_knowbase_item(session_token, item_id, update_data)
                updated_count += 1
        return updated_count

    async def create_knowbase_item(self, session_token: str, title: str, content: str,
                                    category: str = '') -> Optional[int]:
        """Create a new knowledge base article in GLPI. Returns the new item ID or None."""
        url = f"{self.api_uri}/KnowbaseItem"
        headers = self._get_execution_headers(session_token)
        payload = {"input": {"name": title, "answer": content}}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=15) as response:
                    response.raise_for_status()
                    data = await response.json()
                    return data.get("id")
        except Exception as e:
            logger.error(f"GLPI create_knowbase_item failed: {e}")
            return None

    async def update_knowbase_item(self, session_token: str, item_id: int, update_data: Dict[str, Any]) -> bool:
        """Update a knowledge base item in GLPI."""
        url = f"{self.api_uri}/KnowbaseItem/{item_id}"
        headers = self._get_execution_headers(session_token)
        payload = {"input": update_data}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.put(url, headers=headers, json=payload, timeout=15) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI update_knowbase_item failed: {e}")
            return False

    async def delete_knowbase_item(self, session_token: str, item_id: int) -> bool:
        """Delete a knowledge base item in GLPI."""
        url = f"{self.api_uri}/KnowbaseItem/{item_id}"
        headers = self._get_execution_headers(session_token)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.delete(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI delete_knowbase_item failed: {e}")
            return False
    def __init__(self, api_uri: str, app_token: str, user_token: str):
        self.api_uri = api_uri
        self.app_token = app_token
        self.user_token = user_token

    # --- Session Management ---
    async def init_session(self) -> Optional[str]:
        """Initializes a session with GLPI and returns the session token."""
        url = f"{self.api_uri}/initSession"
        headers = {
            "App-Token": self.app_token,
            "Authorization": f"user_token {self.user_token}",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    data = await response.json()
                    return data.get("session_token")
        except Exception as e:
            logger.error(f"GLPI initSession failed: {e}")
            return None

    async def login_with_credentials(self, username: str, password: str) -> Dict[str, Any]:
        """Authenticate user with GLPI using username and password."""
        import base64
        
        url = f"{self.api_uri}/initSession"
        credentials = f"{username}:{password}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            "App-Token": self.app_token,
            "Authorization": f"Basic {encoded_credentials}",
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        session_token = data.get("session_token")
                        
                        # Get user info from the session
                        user_info = await self._get_current_user(session_token)
                        
                        return {
                            "success": True,
                            "session_token": session_token,
                            "user_id": user_info.get("id") if user_info else None,
                            "user_name": user_info.get("name") if user_info else username,
                            "user_firstname": user_info.get("firstname") if user_info else "",
                            "profile_id": user_info.get("profile_id") if user_info else None,
                            "profile_name": user_info.get("profile_name") if user_info else "",
                            "error": None
                        }
                    else:
                        error_msg = "Invalid username or password"
                        try:
                            error_data = await response.json()
                            if isinstance(error_data, list) and len(error_data) > 1:
                                error_msg = error_data[1]
                            elif isinstance(error_data, dict):
                                error_msg = error_data.get("message", error_msg)
                        except:
                            pass
                        
                        return {
                            "success": False,
                            "session_token": None,
                            "error": error_msg
                        }
        except Exception as e:
            import traceback
            logger.error(f"GLPI login_with_credentials failed: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "error": f"Connection error: {str(e)}"}

    async def _get_current_user(self, session_token: str) -> Optional[Dict[str, Any]]:
        """Get current logged-in user info including profile."""
        url = f"{self.api_uri}/getFullSession"
        headers = {
            "App-Token": self.app_token,
            "Session-Token": session_token,
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        session_data = data.get("session", {})
                        profile = session_data.get("glpiactiveprofile", {})
                        return {
                            "id": session_data.get("glpiID"),
                            "name": session_data.get("glpiname"),
                            "firstname": session_data.get("glpifirstname"),
                            "realname": session_data.get("glpirealname"),
                            "profile_id": profile.get("id"),
                            "profile_name": profile.get("name")
                        }
        except:
            pass
        return None

    async def kill_session(self, session_token: str):
        """Kills the current session."""
        url = f"{self.api_uri}/killSession"
        headers = {"App-Token": self.app_token, "Session-Token": session_token}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=5) as response:
                    pass
        except Exception as e:
            logger.warning(f"GLPI killSession failed: {e}")

    async def change_active_entities(self, session_token: str, entity_id: int, is_recursive: bool = True) -> bool:
        """Changes the active entity for the current session."""
        url = f"{self.api_uri}/changeActiveEntities"
        headers = self._get_execution_headers(session_token)
        payload = {"entities_id": entity_id, "is_recursive": is_recursive}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=10) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI changeActiveEntities failed: {e}")
            return False

    def _get_execution_headers(self, session_token: str, entity_id: int = None) -> Dict[str, str]:
        if not session_token:
            raise ValueError("Session token is required for API calls.")
        headers = {
            "App-Token": self.app_token,
            "Session-Token": session_token,
            "Content-Type": "application/json",
        }
        if entity_id is not None:
            headers["GLPI-Entity"] = str(entity_id)
        return headers

    # --- Ticket API ---
    async def create_ticket(self, session_token: str, ticket_data: Dict[str, Any], entity_id: int = None) -> Optional[str]:
        """Creates a ticket and returns the new Ticket ID."""
        logger.info(f"GLPI: Creating ticket with data: {ticket_data}")
        url = f"{self.api_uri}/Ticket"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": ticket_data}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=10) as response:
                    response.raise_for_status()
                    data = await response.json()
                    return data.get("id")
        except Exception as e:
            logger.error(f"GLPI create_ticket failed: {e}")
            return None

    async def get_ticket(self, session_token: str, ticket_id: str, entity_id: int = None) -> Optional[Dict[str, Any]]:
        """Retrieves ticket details by ID."""
        url = f"{self.api_uri}/Ticket/{ticket_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    return await response.json()
        except Exception as e:
            logger.error(f"GLPI get_ticket failed: {e}")
            return None

    async def add_ticket_followup(self, session_token: str, ticket_id: int, content: str, entity_id: int = None) -> bool:
        """Adds a text follow-up (comment) to a ticket."""
        url = f"{self.api_uri}/ITILFollowup"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": {"items_id": ticket_id, "itemtype": "Ticket", "content": content}}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=10) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI add_ticket_followup failed: {e}")
            return False

    async def get_ticket_followups(self, session_token: str, ticket_id: int, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves follow-ups (comments) for a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}/ITILFollowup"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    return await response.json()
        except Exception as e:
            logger.error(f"GLPI get_ticket_followups failed: {e}")
            return []

    async def get_user_tickets(self, session_token: str, active_only: bool = True, entity_id: int = None, status_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves tickets for the current user."""
        url = f"{self.api_uri}/Ticket?range=0-50&sort=date_mod&order=DESC"
        
        criteria_idx = 0
        if entity_id is not None:
            url += f"&criteria[{criteria_idx}][field]=80&criteria[{criteria_idx}][searchtype]=equals&criteria[{criteria_idx}][value]={entity_id}"
            criteria_idx += 1
        if status_id is not None:
             url += f"&criteria[{criteria_idx}][field]=12&criteria[{criteria_idx}][searchtype]=equals&criteria[{criteria_idx}][value]={status_id}"
        
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    all_tickets = await response.json()
                    
                    if status_id is not None:
                        return [t for t in all_tickets if t.get('status') == status_id]
                    elif active_only:
                        return [t for t in all_tickets if t.get('status') != 6]
                    else:
                        return all_tickets
        except Exception as e:
            logger.error(f"GLPI get_user_tickets failed: {e}")
            return []

    async def update_ticket_status(self, session_token: str, ticket_id: int, status_id: int, entity_id: int = None) -> bool:
        """Updates the status of a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": {"id": ticket_id, "status": status_id}}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.put(url, headers=headers, json=payload, timeout=10) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI update_ticket_status failed: {e}")
            return False

    # --- Document API ---
    async def upload_document(self, session_token: str, file_name: str, file_content_base64: str) -> Optional[int]:
        """Uploads a document to GLPI."""
        url = f"{self.api_uri}/Document"
        headers = {"App-Token": self.app_token, "Session-Token": session_token}
        
        import base64
        import json
        
        try:
            file_bytes = base64.b64decode(file_content_base64)
            manifest = {"input": {"name": file_name, "_filename": [file_name]}}
            
            data = aiohttp.FormData()
            data.add_field('uploadManifest', json.dumps(manifest))
            data.add_field('filename[]', file_bytes, filename=file_name)

            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, data=data, timeout=30) as response:
                    response.raise_for_status()
                    res_data = await response.json()
                    return res_data.get("id")
        except Exception as e:
            logger.error(f"GLPI upload_document failed: {e}")
            return None

    async def link_document_to_ticket(self, session_token: str, ticket_id: int, document_id: int, entity_id: int = None) -> bool:
        """Links a document to a ticket."""
        url = f"{self.api_uri}/Document_Item"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": {"documents_id": document_id, "items_id": ticket_id, "itemtype": "Ticket"}}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, headers=headers, json=payload, timeout=10) as response:
                    response.raise_for_status()
                    return True
        except Exception as e:
            logger.error(f"GLPI link_document_to_ticket failed: {e}")
            return False

    async def get_ticket_documents(self, session_token: str, ticket_id: int, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves documents linked to a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}/Document_Item"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, timeout=10) as response:
                    response.raise_for_status()
                    items = await response.json()
                    
                    detailed_docs = []
                    # We need to fetch details for each doc in parallel for speed
                    # But kept simple here
                    for item in items:
                        doc_id = item.get('documents_id')
                        if doc_id:
                            doc_url = f"{self.api_uri}/Document/{doc_id}"
                            try:
                                async with session.get(doc_url, headers=headers, timeout=5) as doc_resp:
                                    if doc_resp.status == 200:
                                        doc_data = await doc_resp.json()
                                        detailed_docs.append({
                                            "id": doc_id,
                                            "name": doc_data.get("name", "Unknown"),
                                            "filename": doc_data.get("filename", ""),
                                            "mime": doc_data.get("mime", ""),
                                            "link": doc_data.get("link", "")
                                        })
                                    else:
                                        detailed_docs.append(item)
                            except:
                                detailed_docs.append(item)
                    return detailed_docs
        except Exception as e:
            logger.error(f"GLPI get_ticket_documents failed: {e}")
            return []

    # --- Knowledge Base API ---
    async def get_all_knowbase_items(self, session_token: str, range_start: int = 0, range_limit: int = 0) -> List[Dict[str, Any]]:
        """Retrieves ALL knowledge base items from GLPI by handling pagination."""
        all_items = []
        current_start = 0
        step = 100
        
        try:
            async with aiohttp.ClientSession() as session:
                while True:
                    url = f"{self.api_uri}/KnowbaseItem"
                    headers = self._get_execution_headers(session_token)
                    current_end = current_start + step
                    params = {"range": f"{current_start}-{current_end - 1}"}
                    
                    async with session.get(url, headers=headers, params=params, timeout=30) as response:
                        if response.status == 416: break
                        response.raise_for_status()
                        items = await response.json()
                        
                        if not items or not isinstance(items, list): break
                        
                        all_items.extend(items)
                        
                        if len(items) < step: break
                        current_start += step
            return all_items
        except Exception as e:
            logger.error(f"GLPI get_all_knowbase_items failed: {e}")
            return all_items

    async def get_user_groups(self, session_token: str, user_id: int) -> List[Dict[str, Any]]:
        """
        Return the list of groups a GLPI user belongs to.
        Uses the Group_User endpoint: GET /Group_User?searchText[users_id]=<user_id>
        Each item has: id, groups_id, group_name (if expanded), users_id.
        Falls back to an empty list on any error so callers can decide.
        """
        url = f"{self.api_uri}/Group_User"
        headers = self._get_execution_headers(session_token)
        params = {
            "searchText[users_id]": str(user_id),
            "expand_dropdowns": "true",
            "range": "0-999",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, params=params, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data if isinstance(data, list) else []
                    return []
        except Exception as e:
            logger.warning(f"GLPI get_user_groups failed for user {user_id}: {e}")
            return []

    async def search_knowbase_items(self, session_token: str, query: str) -> List[Dict[str, Any]]:
        """Search knowledge base items using GLPI search API."""
        url = f"{self.api_uri}/search/KnowbaseItem"
        headers = self._get_execution_headers(session_token)
        params = {
            "criteria[0][field]": "6", "criteria[0][searchtype]": "contains", "criteria[0][value]": query,
            "criteria[1][link]": "OR", "criteria[1][field]": "4", "criteria[1][searchtype]": "contains", "criteria[1][value]": query,
            "forcedisplay[0]": "1", "forcedisplay[1]": "6", "forcedisplay[2]": "4",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, params=params, timeout=15) as response:
                    response.raise_for_status()
                    result = await response.json()
                    return result.get('data', [])
        except Exception as e:
            logger.error(f"GLPI search_knowbase_items failed: {e}")
            return []
