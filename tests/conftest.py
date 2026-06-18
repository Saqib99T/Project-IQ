"""
Shared pytest fixtures for the Project IQ service test suites.

These suites cover the core services that live in this repository:
  • Web API (Flask)        — tests/test_web_api.py
  • Action Server (NLU)    — tests/test_action_server.py
  • Common / Platform / IAM— tests/test_common.py
  • NLU / Conversation data— tests/test_nlu.py

(The standalone ITSM microservice has its own async pytest suite in the
itsm-service repository — 175 tests.)

Lightweight fakes stand in for the Rasa Tracker/Dispatcher and the Socket.IO
server so the units run with no live database, Rasa or Keycloak.
"""
import os
import sys

# Ensure the repository root is importable (common/, web/, action_server/, core/).
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest


class FakeTracker:
    """Minimal stand-in for a rasa_sdk Tracker (slots + latest_message metadata)."""
    def __init__(self, slots=None, metadata=None, sender_id="iam-abc-greenloop"):
        self._slots = dict(slots or {})
        self.sender_id = sender_id
        self.latest_message = {"metadata": dict(metadata or {})}

    def get_slot(self, name):
        return self._slots.get(name)


class FakeDispatcher:
    """Captures every utter_message() call so tests can assert on bot replies."""
    def __init__(self):
        self.messages = []

    def utter_message(self, **kwargs):
        self.messages.append(kwargs)


@pytest.fixture
def make_tracker():
    def _make(slots=None, metadata=None, sender_id="iam-abc-greenloop"):
        return FakeTracker(slots=slots, metadata=metadata, sender_id=sender_id)
    return _make


@pytest.fixture
def dispatcher():
    return FakeDispatcher()
