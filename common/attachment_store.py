"""Short-lived, host-local store for chat-uploaded files awaiting a ticket.

itsm-service attachments are ticket-scoped (presigned PUT keyed by ticket id),
but the chat widget / mobile app upload a file *before* the ticket exists. So
the web app stashes the bytes here and returns a `doc_id` token; after the bot
creates the ticket, the ticket-create action loads the file by token and pushes
it to itsm-service via the presigned flow (server-side — object storage is never
exposed to browsers).

The web app (project-iq-admin) and action server (project-iq-actions) run on the
same host and share this temp directory. Files are pruned after PRUNE_SECONDS.
"""
import json
import os
import tempfile
import time
import uuid
from typing import Optional, Tuple

ATTACH_DIR = os.path.join(tempfile.gettempdir(), "itsm_attachments")
PRUNE_SECONDS = 3600


def _prune() -> None:
    """Best-effort removal of stale files (older than PRUNE_SECONDS)."""
    try:
        now = time.time()
        for fn in os.listdir(ATTACH_DIR):
            fp = os.path.join(ATTACH_DIR, fn)
            try:
                if now - os.path.getmtime(fp) > PRUNE_SECONDS:
                    os.remove(fp)
            except OSError:
                pass
    except FileNotFoundError:
        pass


def save(data: bytes, filename: str, mime_type: str) -> str:
    """Stash bytes + metadata; return a doc_id token."""
    os.makedirs(ATTACH_DIR, exist_ok=True)
    _prune()
    token = uuid.uuid4().hex
    with open(os.path.join(ATTACH_DIR, token + ".bin"), "wb") as fh:
        fh.write(data)
    meta = {
        "filename": filename or "attachment",
        "mime_type": mime_type or "application/octet-stream",
        "size": len(data),
    }
    with open(os.path.join(ATTACH_DIR, token + ".json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh)
    return token


def _valid(token: str) -> bool:
    """Token must be plain hex (uuid4().hex) — guards against path traversal."""
    return bool(token) and len(token) <= 64 and all(c in "0123456789abcdef" for c in token)


def load(token: str) -> Optional[Tuple[bytes, str, str]]:
    """Return (bytes, filename, mime_type) for a token, or None if missing/invalid."""
    if not _valid(token):
        return None
    bin_path = os.path.join(ATTACH_DIR, token + ".bin")
    meta_path = os.path.join(ATTACH_DIR, token + ".json")
    if not (os.path.exists(bin_path) and os.path.exists(meta_path)):
        return None
    with open(bin_path, "rb") as fh:
        data = fh.read()
    with open(meta_path, "r", encoding="utf-8") as fh:
        meta = json.load(fh)
    return data, meta.get("filename", "attachment"), meta.get("mime_type", "application/octet-stream")


def discard(token: str) -> None:
    """Best-effort cleanup after a successful (or abandoned) upload."""
    if not _valid(token):
        return
    for ext in (".bin", ".json"):
        try:
            os.remove(os.path.join(ATTACH_DIR, token + ext))
        except OSError:
            pass
