"""Extensions blueprint — one generic set of admin routes for every plugin
under extensions/ (knowledge-base sources, the website crawler, commerce
providers), instead of a bespoke blueprint per integration.

Also merges in the outbound-notification catalog that already lives in
itsm-service (`GET /api/v1/integrations/catalog`) so the admin UI has one
list of "what's connected to this tenant" instead of checking two systems.
That merge is best-effort — if itsm-service is unreachable, the local
extension catalog still returns, it just won't include destination entries.

Existing per-integration surfaces (bp_shopify.py, /admin/connectors/* in
bp_kb.py) are untouched by this file — this is additive, not a replacement.
"""
import logging

import requests
from flask import Blueprint, jsonify, request

from common.config_manager import get_itsm_config
from common.db._extensions import (
    get_install,
    list_installs,
    record_run,
    remove_install,
    upsert_install,
)
from extensions import get_extension, list_manifests
from extensions.base import ExtensionKind
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('extensions', __name__)


def _manifest_dict(m) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "kind": m.kind.value,
        "description": m.description,
        "icon": m.icon,
        "category": m.category,
        "config_schema": [vars(f) for f in m.config_schema],
        "capabilities": m.capabilities,
        "manage_url": m.manage_url,
    }


def _itsm_destination_entries() -> list:
    """Best-effort fetch of itsm-service's outbound-webhook catalog, reshaped
    into the same entry shape as a local manifest so the admin UI can render
    one merged list."""
    base_url = get_itsm_config().get('service_url', '').rstrip('/')
    if not base_url:
        return []
    try:
        resp = requests.get(
            f"{base_url}/api/v1/integrations/catalog",
            headers={'Authorization': request.headers.get('Authorization', '')},
            timeout=5,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.info("[Extensions] itsm-service outbound catalog unavailable: %s", e)
        return []

    entries = []
    for item in data.get('integrations', []):
        entries.append({
            "id": item.get("key"),
            "name": item.get("name"),
            "kind": "destination",
            "description": item.get("description", ""),
            "icon": item.get("icon", "\U0001F9E9"),
            "category": item.get("category", "Notifications"),
            "config_schema": item.get("config_schema", []),
            "capabilities": ["outbound_webhook"],
            "manage_url": "/admin/integrations",  # existing marketplace page owns this flow
            "managed_by": "itsm-service",
        })
    return entries


@bp.route('/admin/extensions/catalog', methods=['GET'])
@_s.require_iam_token
def extensions_catalog():
    local = [_manifest_dict(m) for m in list_manifests()]
    remote = _itsm_destination_entries()
    return jsonify({"extensions": local + remote})


@bp.route('/admin/extensions/<extension_id>/status', methods=['GET'])
@_s.require_iam_token
def extension_status(extension_id):
    org_id = _s.caller_org_scope()
    row = get_install(org_id, extension_id)
    if row is not None:
        row.pop("secrets", None)
    ext = get_extension(extension_id)
    result = {"install": row}
    if ext is not None and hasattr(ext, "status"):
        try:
            result["provider_status"] = ext.status(org_id)
        except Exception as e:
            result["provider_status"] = {"error": str(e)}
    return jsonify(result)


@bp.route('/admin/extensions', methods=['GET'])
@_s.require_iam_token
def list_org_extensions():
    org_id = _s.caller_org_scope()
    installs = list_installs(org_id)
    for row in installs:
        row.pop("secrets", None)
    return jsonify({"installs": installs})


@bp.route('/admin/extensions/<extension_id>/install', methods=['POST'])
@_s.require_iam_token
def install_extension(extension_id):
    ext = get_extension(extension_id)
    if ext is None:
        return jsonify({'error': f'Unknown extension: {extension_id}'}), 404

    org_id = _s.caller_org_scope()
    data = request.get_json(silent=True) or {}
    config = data.get('config', {}) or {}
    secrets = data.get('secrets', {}) or {}

    merged = {**config, **secrets}
    missing = [f.name for f in ext.manifest.config_schema if f.required and not merged.get(f.name)]
    if missing:
        return jsonify({'error': f'Missing required field(s): {", ".join(missing)}'}), 400

    upsert_install(org_id, extension_id, config, secrets or None, external_id=data.get('external_id'))
    return jsonify({'status': 'installed'})


@bp.route('/admin/extensions/<extension_id>/test', methods=['POST'])
@_s.require_iam_token
def test_extension(extension_id):
    """Connectivity check — either against config supplied in the request
    body (testing before saving) or, if omitted, the tenant's already-saved
    install."""
    ext = get_extension(extension_id)
    if ext is None:
        return jsonify({'error': f'Unknown extension: {extension_id}'}), 404

    org_id = _s.caller_org_scope()
    data = request.get_json(silent=True) or {}
    if data.get('config') or data.get('secrets'):
        config = {**(data.get('config') or {}), **(data.get('secrets') or {})}
    else:
        row = get_install(org_id, extension_id)
        if row is None:
            return jsonify({'error': f"'{extension_id}' is not installed for this tenant yet"}), 400
        config = {**row.get('config', {}), **row.get('secrets', {})}

    try:
        result = ext.test(config)
    except Exception as e:
        logger.exception("[Extensions] test failed for %s (org=%s)", extension_id, org_id)
        return jsonify({'status': 'error', 'error': str(e)}), 502

    return jsonify({'status': result.status, **result.detail})


@bp.route('/admin/extensions/<extension_id>/run', methods=['POST'])
@_s.require_iam_token
def run_extension(extension_id):
    ext = get_extension(extension_id)
    if ext is None:
        return jsonify({'error': f'Unknown extension: {extension_id}'}), 404
    if ext.manifest.kind != ExtensionKind.SOURCE:
        return jsonify({'error': f"'{extension_id}' is not a source extension and has no run action"}), 400

    org_id = _s.caller_org_scope()
    row = get_install(org_id, extension_id)
    if row is None:
        return jsonify({'error': f"'{extension_id}' is not installed for this tenant yet"}), 400

    config = {**row.get('config', {}), **row.get('secrets', {})}
    streams = (request.get_json(silent=True) or {}).get('streams')

    try:
        result = ext.run(config, streams)
    except Exception as e:
        logger.exception("[Extensions] run failed for %s (org=%s)", extension_id, org_id)
        result_dict = {'status': 'error', 'error': str(e)}
        record_run(org_id, extension_id, result_dict)
        return jsonify(result_dict), 502

    result_dict = {'status': result.status, **result.detail}
    record_run(org_id, extension_id, result_dict)
    return jsonify(result_dict)


@bp.route('/admin/extensions/<extension_id>/push', methods=['POST'])
@_s.require_iam_token
def push_extension(extension_id):
    """Deliver one event through a DESTINATION extension — either from the
    caller (a real event) or a body-supplied test payload."""
    ext = get_extension(extension_id)
    if ext is None:
        return jsonify({'error': f'Unknown extension: {extension_id}'}), 404
    if ext.manifest.kind != ExtensionKind.DESTINATION:
        return jsonify({'error': f"'{extension_id}' is not a destination extension and has no push action"}), 400

    org_id = _s.caller_org_scope()
    row = get_install(org_id, extension_id)
    if row is None:
        return jsonify({'error': f"'{extension_id}' is not installed for this tenant yet"}), 400

    config = {**row.get('config', {}), **row.get('secrets', {})}
    event = (request.get_json(silent=True) or {}).get('event', {})

    try:
        result = ext.push(config, event)
    except Exception as e:
        logger.exception("[Extensions] push failed for %s (org=%s)", extension_id, org_id)
        result_dict = {'status': 'error', 'error': str(e)}
        record_run(org_id, extension_id, result_dict)
        return jsonify(result_dict), 502

    result_dict = {'status': result.status, **result.detail}
    record_run(org_id, extension_id, result_dict)
    return jsonify(result_dict)


@bp.route('/admin/extensions/<extension_id>', methods=['DELETE'])
@_s.require_iam_token
def uninstall_extension(extension_id):
    org_id = _s.caller_org_scope()
    ok = remove_install(org_id, extension_id)
    return jsonify({'removed': ok})
