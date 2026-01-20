
import logging
import requests
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

class GlpiService:
    def __init__(self, api_uri: str, app_token: str, user_token: str):
        self.api_uri = api_uri
        self.app_token = app_token
        self.user_token = user_token

    # --- Session Management ---
    def init_session(self) -> Optional[str]:
        """Initializes a session with GLPI and returns the session token."""
        url = f"{self.api_uri}/initSession"
        headers = {
            "App-Token": self.app_token,
            "Authorization": f"user_token {self.user_token}",
        }
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            session_token = response.json().get("session_token")
            return session_token
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI initSession failed: {e}")
            return None

    def login_with_credentials(self, username: str, password: str) -> Dict[str, Any]:
        """
        Authenticate user with GLPI using username and password.
        Uses HTTP Basic Auth to initSession.
        Returns dict with 'success', 'session_token', 'user_id', 'user_name', 'error'
        """
        import base64
        
        url = f"{self.api_uri}/initSession"
        
        # Create Basic Auth header
        credentials = f"{username}:{password}"
        encoded_credentials = base64.b64encode(credentials.encode()).decode()
        
        headers = {
            "App-Token": self.app_token,
            "Authorization": f"Basic {encoded_credentials}",
        }
        
        try:
            response = requests.get(url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                session_token = data.get("session_token")
                
                # Get user info from the session
                user_info = self._get_current_user(session_token)
                
                return {
                    "success": True,
                    "session_token": session_token,
                    "user_id": user_info.get("id") if user_info else None,
                    "user_name": user_info.get("name") if user_info else username,
                    "user_firstname": user_info.get("firstname") if user_info else "",
                    "error": None
                }
            else:
                error_msg = "Invalid username or password"
                try:
                    error_data = response.json()
                    if isinstance(error_data, list) and len(error_data) > 1:
                        error_msg = error_data[1]
                    elif isinstance(error_data, dict):
                        error_msg = error_data.get("message", error_msg)
                except:
                    pass
                
                return {
                    "success": False,
                    "session_token": None,
                    "user_id": None,
                    "user_name": None,
                    "error": error_msg
                }
                
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI login_with_credentials failed: {e}")
            return {
                "success": False,
                "session_token": None,
                "user_id": None,
                "user_name": None,
                "error": f"Connection error: {str(e)}"
            }

    def _get_current_user(self, session_token: str) -> Optional[Dict[str, Any]]:
        """Get current logged-in user info."""
        url = f"{self.api_uri}/getFullSession"
        headers = {
            "App-Token": self.app_token,
            "Session-Token": session_token,
        }
        try:
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                data = response.json()
                session = data.get("session", {})
                return {
                    "id": session.get("glpiID"),
                    "name": session.get("glpiname"),
                    "firstname": session.get("glpifirstname"),
                    "realname": session.get("glpirealname")
                }
        except:
            pass
        return None

    def kill_session(self, session_token: str):
        """Kills the current session."""
        url = f"{self.api_uri}/killSession"
        headers = {
            "App-Token": self.app_token,
            "Session-Token": session_token,
        }
        try:
            requests.get(url, headers=headers, timeout=5)
        except requests.exceptions.RequestException as e:
            logger.warning(f"GLPI killSession failed (might already be expired): {e}")

    def change_active_entities(self, session_token: str, entity_id: int, is_recursive: bool = True) -> bool:
        """Changes the active entity for the current session."""
        url = f"{self.api_uri}/changeActiveEntities"
        # Do NOT pass entity_id to headers - this call SETS the entity context
        headers = self._get_execution_headers(session_token)
        payload = {
            "entities_id": entity_id,
            "is_recursive": is_recursive
        }
        try:
            # Note: Usually POST, sometimes PUT depending on version. POST is safer default.
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI changeActiveEntities failed: {e}")
            if 'response' in locals() and response is not None:
                 logger.error(f"GLPI Response: {response.text}")
            return False

    # --- Helper Methods ---
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
            logger.info(f"GLPI: headers: {headers}")    
        return headers

    # --- Ticket API ---
    def create_ticket(self, session_token: str, ticket_data: Dict[str, Any], entity_id: int = None) -> Optional[str]:
        """Creates a ticket and returns the new Ticket ID (or None on failure)."""
        logger.info(f"GLPI: Creating ticket with data: {ticket_data}")
        url = f"{self.api_uri}/Ticket"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": ticket_data}
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            logger.info(f"GLPI: Ticket created successfully. Response: {response.text}")
            return response.json().get("id")
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI create_ticket failed: {e}")
            return None

    def get_ticket(self, session_token: str, ticket_id: str, entity_id: int = None) -> Optional[Dict[str, Any]]:
        """Retrieves ticket details by ID."""
        url = f"{self.api_uri}/Ticket/{ticket_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_ticket failed: {e}")
            return None

    def add_ticket_followup(self, session_token: str, ticket_id: int, content: str, entity_id: int = None) -> bool:
        """Adds a text follow-up (comment) to a ticket."""
        url = f"{self.api_uri}/ITILFollowup"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {
            "input": {
                "items_id": ticket_id,
                "itemtype": "Ticket",
                "content": content
            }
        }
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI add_ticket_followup failed: {e}")
            return False

    def get_ticket_followups(self, session_token: str, ticket_id: int, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves follow-ups (comments) for a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}/ITILFollowup"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_ticket_followups failed: {e}")
            return []

        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_ticket_followups failed: {e}")
            return []

    def get_user_tickets(self, session_token: str, active_only: bool = True, entity_id: int = None, status_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves tickets for the current user, optionally filtering for active only or specific status."""
        # Build URL with criteria
        # Field 80 is entities_id in GLPI
        url = f"{self.api_uri}/Ticket?range=0-50&sort=date_mod&order=DESC"
        
        criteria_idx = 0
        
        if entity_id is not None:
            url += f"&criteria[{criteria_idx}][field]=80&criteria[{criteria_idx}][searchtype]=equals&criteria[{criteria_idx}][value]={entity_id}"
            criteria_idx += 1
            
        if status_id is not None:
             url += f"&criteria[{criteria_idx}][field]=12&criteria[{criteria_idx}][searchtype]=equals&criteria[{criteria_idx}][value]={status_id}"
             criteria_idx += 1
             
        logger.info(f"GLPI: URL: {url}")
        logger.info(f"DEBUG: get_user_tickets entity_id={entity_id} status_id={status_id} criteria_idx={criteria_idx}")    
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            all_tickets = response.json()
            
            if status_id is not None:
                # Strict client-side filtering to ensure accuracy
                filtered_tickets = [t for t in all_tickets if t.get('status') == status_id]
                logger.info(f"DEBUG: Client-side filtered from {len(all_tickets)} to {len(filtered_tickets)} tickets for status {status_id}")
                return filtered_tickets
            elif active_only:
                # Filter for active tickets (Status != 6 (Closed))
                return [t for t in all_tickets if t.get('status') != 6]
            else:
                return all_tickets
                
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_user_tickets failed: {e}")
            return []

    def update_ticket_status(self, session_token: str, ticket_id: int, status_id: int, entity_id: int = None) -> bool:
        """Updates the status of a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {
            "input": {
                "id": ticket_id,
                "status": status_id
            }
        }
        try:
            response = requests.put(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI update_ticket_status failed: {e}")
            if response is not None:
                logger.error(f"GLPI Response: {response.text}")
            return False

    # --- User API ---
    def get_all_users(self, session_token: str, range_start: int = 0, range_limit: int = 50, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves a list of users."""
        url = f"{self.api_uri}/User"
        headers = self._get_execution_headers(session_token, entity_id)
        params = {"range": f"{range_start}-{range_start + range_limit}"}
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_all_users failed: {e}")
            return []

    def get_user(self, session_token: str, user_id: int, entity_id: int = None) -> Optional[Dict[str, Any]]:
        """Retrieves a specific user by ID."""
        url = f"{self.api_uri}/User/{user_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_user failed: {e}")
            return None

    def create_user(self, session_token: str, user_data: Dict[str, Any], entity_id: int = None) -> Optional[int]:
        """Creates a new user and returns their ID."""
        url = f"{self.api_uri}/User"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": user_data}
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return response.json().get("id")
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI create_user failed: {e}")
            return None

    def update_user(self, session_token: str, user_id: int, user_data: Dict[str, Any], entity_id: int = None) -> bool:
        """Updates an existing user."""
        url = f"{self.api_uri}/User/{user_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": user_data}
        try:
            response = requests.put(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI update_user failed: {e}")
            return False

    def delete_user(self, session_token: str, user_id: int, force_purge: bool = False, entity_id: int = None) -> bool:
        """Deletes (or purges) a user."""
        url = f"{self.api_uri}/User/{user_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        params = {"force_purge": 1} if force_purge else {}
        try:
            response = requests.delete(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI delete_user failed: {e}")
            return False

    # --- Profile API ---
    def get_all_profiles(self, session_token: str, range_start: int = 0, range_limit: int = 50, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves a list of profiles."""
        url = f"{self.api_uri}/Profile"
        headers = self._get_execution_headers(session_token, entity_id)
        params = {"range": f"{range_start}-{range_start + range_limit}"}
        try:
            response = requests.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_all_profiles failed: {e}")
            return []

    def get_profile(self, session_token: str, profile_id: int, entity_id: int = None) -> Optional[Dict[str, Any]]:
        """Retrieves a specific profile by ID."""
        url = f"{self.api_uri}/Profile/{profile_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_profile failed: {e}")
            return None

    def create_profile(self, session_token: str, profile_data: Dict[str, Any], entity_id: int = None) -> Optional[int]:
        """Creates a new profile and returns its ID."""
        url = f"{self.api_uri}/Profile"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": profile_data}
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return response.json().get("id")
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI create_profile failed: {e}")
            return None

    def update_profile(self, session_token: str, profile_id: int, profile_data: Dict[str, Any], entity_id: int = None) -> bool:
        """Updates an existing profile."""
        url = f"{self.api_uri}/Profile/{profile_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {"input": profile_data}
        try:
            response = requests.put(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI update_profile failed: {e}")
            return False

    def delete_profile(self, session_token: str, profile_id: int, force_purge: bool = False, entity_id: int = None) -> bool:
        """Deletes (or purges) a profile."""
        url = f"{self.api_uri}/Profile/{profile_id}"
        headers = self._get_execution_headers(session_token, entity_id)
        params = {"force_purge": 1} if force_purge else {}
        try:
            response = requests.delete(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI delete_profile failed: {e}")
            return False

    # --- Document API ---
    def upload_document(self, session_token: str, file_name: str, file_content_base64: str) -> Optional[int]:
        """Uploads a document to GLPI using multipart/form-data and uploadManifest."""
        url = f"{self.api_uri}/Document"
        headers = {
            "App-Token": self.app_token,
            "Session-Token": session_token
        }
        
        import base64
        import json
        
        try:
            file_bytes = base64.b64decode(file_content_base64)
        except Exception as e:
            logger.error(f"Base64 decode failed: {e}")
            return None

        # Manifest tells GLPI about the file
        manifest = {
            "input": {
                "name": file_name,
                "_filename": [file_name]
            }
        }
        
        # Multipart payload
        files = {
            'filename[]': (file_name, file_bytes) 
        }
        data = {
            'uploadManifest': json.dumps(manifest)
        }

        try:
            # Note: Do NOT set Content-Type header manually when using 'files', requests does it.
            response = requests.post(url, headers=headers, files=files, data=data, timeout=30)
            response.raise_for_status()
            
            # Response: {"id": 123, "message": ...}
            doc_id = response.json().get("id")
            logger.info(f"GLPI: Uploaded Document ID {doc_id}")
            return doc_id
            
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI upload_document failed: {e}")
            if 'response' in locals() and response is not None:
                 logger.error(f"GLPI Response: {response.text}")
            return None

    def link_document_to_ticket(self, session_token: str, ticket_id: int, document_id: int, entity_id: int = None) -> bool:
        """Links a document to a ticket."""
        url = f"{self.api_uri}/Document_Item"
        headers = self._get_execution_headers(session_token, entity_id)
        payload = {
            "input": {
                "documents_id": document_id,
                "items_id": ticket_id,
                "itemtype": "Ticket"
            }
        }
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=10)
            response.raise_for_status()
            return True
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI link_document_to_ticket failed: {e}")
            return False

    def get_ticket_documents(self, session_token: str, ticket_id: int, entity_id: int = None) -> List[Dict[str, Any]]:
        """Retrieves documents linked to a ticket."""
        url = f"{self.api_uri}/Ticket/{ticket_id}/Document_Item"
        headers = self._get_execution_headers(session_token, entity_id)
        try:
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            # The response is usually a list of Document_Item links. 
            # We might need to fetch the actual Document details for each.
            # But let's see what we get. Often it includes 'documents_id'.
            items = response.json()
            
            # Enrich with Document names and types by fetching the Document object
            # We need to iterate and get details for each 'documents_id'
            detailed_docs = []
            for item in items:
                doc_id = item.get('documents_id')
                if doc_id:
                    # Fetch Document details
                    doc_url = f"{self.api_uri}/Document/{doc_id}"
                    try:
                        doc_resp = requests.get(doc_url, headers=headers, timeout=5)
                        if doc_resp.status_code == 200:
                            doc_data = doc_resp.json()
                            
                            # Flatten useful fields
                            detailed_docs.append({
                                "id": doc_id,
                                "name": doc_data.get("name", "Unknown"),
                                "filename": doc_data.get("filename", ""),
                                "mime": doc_data.get("mime", ""),
                                # Construct a download link if possible. GLPI standard link:
                                # /front/document.send.php?docid=ID
                                # But through API, maybe simpler?
                                "link": doc_data.get("link", "") 
                            })
                        else:
                            detailed_docs.append(item) # Fallback
                    except:
                        detailed_docs.append(item) # Fallback

            return detailed_docs
        except requests.exceptions.RequestException as e:
            logger.error(f"GLPI get_ticket_documents failed: {e}")
            return []
