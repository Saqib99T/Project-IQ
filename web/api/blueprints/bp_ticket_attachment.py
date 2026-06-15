"""
Ticket attachment endpoint.

Attachments are managed in the ITSM portal via itsm-service's presigned-upload
flow (POST /tickets/{id}/attachments → client PUTs to object storage). The legacy
chat/widget pre-upload path used GLPI and was never linked to ITSM tickets, so it
has been removed. These routes remain for backward compatibility and return a
clear, non-GLPI response directing users to the portal.
"""
import logging
from flask import Blueprint, request, jsonify

bp = Blueprint('ticket_attachment', __name__)
logger = logging.getLogger(__name__)

_PORTAL_MSG = "Please add attachments from the ticket in the ITSM portal."


@bp.route('/api/ticket-attachment', methods=['POST'])
def upload_ticket_attachment():
    """Legacy pre-upload endpoint — no longer stores files (attach via the portal)."""
    f = request.files.get('file')
    name = (f.filename if f else '') or 'attachment'
    return jsonify({'doc_id': None, 'name': name, 'unsupported': True, 'message': _PORTAL_MSG}), 200


@bp.route('/api/ticket-attachment', methods=['GET'])
def download_ticket_attachment():
    """Legacy download proxy — attachments are served by the ITSM portal now."""
    return jsonify({'error': _PORTAL_MSG}), 410
