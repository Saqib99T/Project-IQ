"""
Ticket attachment upload blueprint.
Route: POST /api/ticket-attachment
Accepts a file upload, pushes it directly to GLPI, returns the GLPI document ID.
The doc_id is passed through Rasa when the ticket form is submitted, and the
action server links the pre-uploaded document to the new ticket.
"""
import json
import logging

import requests as _req
from flask import Blueprint, request, jsonify, Response, stream_with_context
from common.config_manager import get_glpi_config

bp = Blueprint('ticket_attachment', __name__)
logger = logging.getLogger(__name__)

MAX_BYTES = 1 * 1024 * 1024  # 1 MB


def _glpi_session(config, session_token=None):
    """Return a valid GLPI session token. Uses provided token or opens a service-account session."""
    if session_token:
        return session_token
    resp = _req.get(
        f"{config['api_url']}/initSession",
        headers={
            "App-Token": config['app_token'],
            "Authorization": f"user_token {config['user_token']}",
        },
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json().get("session_token")


def _glpi_upload(config, session_token, file_name, file_bytes, mime_type):
    """Upload file bytes to GLPI Documents and return the document id."""
    manifest = {"input": {"name": file_name, "_filename": [file_name]}}
    resp = _req.post(
        f"{config['api_url']}/Document",
        headers={
            "App-Token": config['app_token'],
            "Session-Token": session_token,
        },
        files={
            "uploadManifest": (None, json.dumps(manifest), "application/json"),
            "filename[]":     (file_name, file_bytes, mime_type),
        },
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        logger.error(f"[TicketAttachment] GLPI upload HTTP {resp.status_code}: {resp.text[:300]}")
        return None
    data = resp.json()
    doc_id = data.get("id")
    logger.info(f"[TicketAttachment] Uploaded '{file_name}' -> doc_id={doc_id}")
    return doc_id


@bp.route('/api/ticket-attachment', methods=['GET'])
def download_ticket_attachment():
    """
    Proxy GLPI document download so the user doesn't need a GLPI session.
    Query param: doc_id (int)
    """
    doc_id = request.args.get('doc_id', type=int)
    if not doc_id:
        return jsonify({'error': 'doc_id required'}), 400
    try:
        config = get_glpi_config()
        token = _glpi_session(config)
        if not token:
            return jsonify({'error': 'Could not obtain GLPI session'}), 503

        headers = {"App-Token": config['app_token'], "Session-Token": token}

        # Fetch metadata to get filename + mime
        meta_resp = _req.get(f"{config['api_url']}/Document/{doc_id}", headers=headers, timeout=10)
        if meta_resp.status_code != 200:
            return jsonify({'error': 'Document not found'}), 404
        meta = meta_resp.json()
        filename = meta.get('filename') or meta.get('name', f'attachment_{doc_id}')
        mime = meta.get('mime') or 'application/octet-stream'

        # Download file content
        dl_resp = _req.get(
            f"{config['api_url']}/Document/{doc_id}",
            headers={**headers, "Accept": mime},
            params={"alt": "media"},
            stream=True,
            timeout=30,
        )
        if dl_resp.status_code != 200:
            return jsonify({'error': 'Download failed'}), 502

        return Response(
            stream_with_context(dl_resp.iter_content(chunk_size=8192)),
            content_type=mime,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except Exception as e:
        logger.error(f"[TicketAttachment] Download error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@bp.route('/api/ticket-attachment', methods=['POST'])
def upload_ticket_attachment():
    """
    Expects multipart/form-data with a 'file' field.
    Optional form field: session_token (user's GLPI session — falls back to service account).
    Returns: { doc_id: int, name: str }
    """
    try:
        f = request.files.get('file')
        if not f:
            return jsonify({'error': 'No file provided'}), 400

        file_bytes = f.read()
        if len(file_bytes) > MAX_BYTES:
            mb = len(file_bytes) / 1024 / 1024
            return jsonify({'error': f'File too large ({mb:.1f} MB). Max 1 MB.'}), 413

        file_name = f.filename or 'attachment'
        mime_type = f.content_type or 'application/octet-stream'
        session_token = request.form.get('session_token')

        config = get_glpi_config()

        token = _glpi_session(config, session_token)
        if not token:
            return jsonify({'error': 'Could not obtain GLPI session'}), 503

        doc_id = _glpi_upload(config, token, file_name, file_bytes, mime_type)
        if not doc_id:
            return jsonify({'error': 'GLPI document upload failed'}), 502

        return jsonify({'doc_id': doc_id, 'name': file_name})

    except Exception as e:
        logger.error(f"[TicketAttachment] Unexpected error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500
