"""
Ticket attachment pre-upload endpoint.

The chat widget / mobile app upload a file here *before* the ticket exists (the
bot creates the ticket via itsm-service). itsm-service attachments are
ticket-scoped (presigned PUT to object storage keyed by ticket id), so we can't
push to itsm yet. Instead we stash the bytes in a short-lived host-local store
and return a `doc_id` token. After the bot creates the ticket, the
`action_create_ticket_from_form` action loads the stashed file by token and
uploads it to itsm-service via the presigned flow (server-side — object storage
is never exposed to browsers).
"""
import logging

from flask import Blueprint, request, jsonify

from common import attachment_store

bp = Blueprint('ticket_attachment', __name__)
logger = logging.getLogger(__name__)

MAX_BYTES = 25 * 1024 * 1024  # 25 MB — itsm-service default cap


@bp.route('/api/ticket-attachment', methods=['POST'])
def upload_ticket_attachment():
    """Stash an uploaded file and return a doc_id token for ticket creation."""
    f = request.files.get('file')
    if not f or not f.filename:
        return jsonify({'error': 'No file provided'}), 400

    data = f.read()
    if not data:
        return jsonify({'error': 'Empty file'}), 400
    if len(data) > MAX_BYTES:
        return jsonify({'error': 'File too large (max 25 MB)'}), 413

    token = attachment_store.save(
        data,
        filename=f.filename,
        mime_type=f.mimetype or 'application/octet-stream',
    )
    logger.info("[Attachment] stashed '%s' (%d bytes) as %s", f.filename, len(data), token)
    return jsonify({'doc_id': token, 'name': f.filename}), 200


@bp.route('/api/ticket-attachment', methods=['GET'])
def download_ticket_attachment():
    """Downloads are served by itsm-service (ticket detail → presigned GET)."""
    return jsonify({'error': 'Attachments are served from the ticket detail view.'}), 410
