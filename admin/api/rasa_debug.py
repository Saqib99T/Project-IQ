"""
Rasa Debug Module
Real-time debugging and inspection of Rasa conversations
"""
import requests
import json
import os
from typing import Dict, List, Optional, Any
from datetime import datetime


# Rasa endpoints — read from profile config, fall back to env var
try:
    from common.config_manager import get_rasa_config as _get_rasa_config
    RASA_URL = _get_rasa_config()['api_url']
except Exception:
    RASA_URL = os.getenv("RASA_URL", "http://localhost:5005")


def parse_message(text: str, sender_id: str = "debug_user") -> Dict:
    """
    Parse a message through Rasa NLU and return intent/entity analysis.
    This calls the Rasa /model/parse endpoint.
    """
    try:
        response = requests.post(
            f"{RASA_URL}/model/parse",
            json={"text": text, "message_id": f"debug_{datetime.now().timestamp()}"},
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "text": text,
                "intent": data.get("intent", {}),
                "intent_ranking": data.get("intent_ranking", [])[:5],
                "entities": data.get("entities", []),
                "response_selector": data.get("response_selector", {}),
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {
                "success": False,
                "error": f"Rasa returned status {response.status_code}",
                "text": text
            }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "Could not connect to Rasa Core. Is it running on port 5005?",
            "text": text
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "text": text
        }


def get_tracker(sender_id: str) -> Dict:
    """
    Get the conversation tracker for a sender ID.
    This retrieves slot values, events, and conversation state.
    """
    try:
        response = requests.get(
            f"{RASA_URL}/conversations/{sender_id}/tracker",
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            
            # Extract relevant info
            slots = data.get("slots", {})
            events = data.get("events", [])
            active_loop = data.get("active_loop", {})
            latest_message = data.get("latest_message", {})
            
            return {
                "success": True,
                "sender_id": sender_id,
                "slots": slots,
                "active_loop": active_loop,
                "latest_message": latest_message,
                "event_count": len(events),
                "latest_action": data.get("latest_action_name"),
                "paused": data.get("paused", False)
            }
        else:
            return {
                "success": False,
                "error": f"Tracker not found or Rasa error: {response.status_code}",
                "sender_id": sender_id
            }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "Could not connect to Rasa Core",
            "sender_id": sender_id
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "sender_id": sender_id
        }


def get_conversation_debug(sender_id: str) -> Dict:
    """
    Get detailed debug information for a conversation.
    Includes NLU results, slot changes, and action history.
    """
    try:
        response = requests.get(
            f"{RASA_URL}/conversations/{sender_id}/tracker",
            params={"include_events": "ALL"},
            timeout=5
        )
        
        if response.status_code != 200:
            return {"success": False, "error": f"Status {response.status_code}"}
        
        data = response.json()
        events = data.get("events", [])
        
        # Process events into turns
        turns = []
        current_turn = None
        slots_state = {}
        
        for event in events:
            event_type = event.get("event")
            timestamp = event.get("timestamp", 0)
            
            if event_type == "user":
                # Start new turn
                if current_turn:
                    turns.append(current_turn)
                
                parse_data = event.get("parse_data", {})
                current_turn = {
                    "type": "user",
                    "timestamp": datetime.fromtimestamp(timestamp).strftime("%H:%M:%S"),
                    "text": event.get("text", ""),
                    "intent": parse_data.get("intent", {}),
                    "intent_ranking": parse_data.get("intent_ranking", [])[:3],
                    "entities": parse_data.get("entities", []),
                    "slots_before": dict(slots_state),
                    "slots_after": {},
                    "actions": [],
                    "bot_responses": []
                }
                
            elif event_type == "slot" and current_turn:
                slot_name = event.get("name")
                slot_value = event.get("value")
                slots_state[slot_name] = slot_value
                current_turn["slots_after"] = dict(slots_state)
                
            elif event_type == "action" and current_turn:
                action_name = event.get("name")
                if action_name and not action_name.startswith("action_listen"):
                    current_turn["actions"].append({
                        "name": action_name,
                        "policy": event.get("policy"),
                        "confidence": event.get("confidence")
                    })
                    
            elif event_type == "bot" and current_turn:
                current_turn["bot_responses"].append({
                    "text": event.get("text", ""),
                    "data": event.get("data", {})
                })
        
        if current_turn:
            turns.append(current_turn)
        
        return {
            "success": True,
            "sender_id": sender_id,
            "turns": turns[-20:],  # Last 20 turns
            "current_slots": slots_state,
            "active_loop": data.get("active_loop"),
            "total_events": len(events)
        }
        
    except requests.exceptions.ConnectionError:
        return {"success": False, "error": "Could not connect to Rasa Core"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def predict_next_action(sender_id: str, message: str = None) -> Dict:
    """
    Predict what action Rasa would take next.
    Optionally send a message first.
    """
    try:
        if message:
            # Send message first
            requests.post(
                f"{RASA_URL}/conversations/{sender_id}/messages",
                json={"text": message, "sender": sender_id},
                timeout=5
            )
        
        # Get prediction
        response = requests.post(
            f"{RASA_URL}/conversations/{sender_id}/predict",
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "sender_id": sender_id,
                "scores": data.get("scores", [])[:5],
                "policy": data.get("policy"),
                "confidence": data.get("confidence")
            }
        else:
            return {"success": False, "error": f"Status {response.status_code}"}
            
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_domain_info() -> Dict:
    """
    Get information about the loaded Rasa domain.
    """
    try:
        response = requests.get(f"{RASA_URL}/domain", timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "intents": list(data.get("intents", [])),
                "entities": list(data.get("entities", [])),
                "slots": list(data.get("slots", {}).keys()),
                "actions": list(data.get("actions", [])),
                "responses": list(data.get("responses", {}).keys()),
                "forms": list(data.get("forms", {}).keys())
            }
        else:
            return {"success": False, "error": f"Status {response.status_code}"}
            
    except Exception as e:
        return {"success": False, "error": str(e)}


def test_story(story_name: str, steps: List[Dict]) -> Dict:
    """
    Test a story by simulating the conversation.
    """
    test_sender = f"story_test_{datetime.now().timestamp()}"
    results = []
    
    try:
        for step in steps:
            if "user" in step:
                # Send user message
                parse_result = parse_message(step["user"], test_sender)
                response = requests.post(
                    f"{RASA_URL}/conversations/{test_sender}/messages",
                    json={"text": step["user"], "sender": test_sender},
                    timeout=5
                )
                
                results.append({
                    "type": "user",
                    "input": step["user"],
                    "intent": parse_result.get("intent", {}),
                    "success": response.status_code == 200
                })
                
            elif "action" in step:
                # Check if action was triggered
                tracker = get_tracker(test_sender)
                action_triggered = tracker.get("latest_action") == step["action"]
                
                results.append({
                    "type": "action", 
                    "expected": step["action"],
                    "actual": tracker.get("latest_action"),
                    "success": action_triggered
                })
        
        success_count = sum(1 for r in results if r.get("success"))
        
        return {
            "success": True,
            "story_name": story_name,
            "results": results,
            "passed": success_count == len(results),
            "score": f"{success_count}/{len(results)}"
        }
        
    except Exception as e:
        return {"success": False, "error": str(e), "story_name": story_name}
