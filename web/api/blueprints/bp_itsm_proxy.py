"""
ITSM-service proxy blueprint.

Forwards /itsm-api/<path> to the itsm-service REST API (api/v1/<path>),
keeping the browser same-origin (no CORS config needed in itsm-service).

Forwards through:
  - Authorization  (Bearer JWT — itsm-service validates it against the
                    same Keycloak realm and resolves tenant from claims)
  - X-Tenant-ID    (set by the frontend when a platform/super_admin user
                    is inspecting a specific tenant's data)

Stack traces are never echoed to the client — only itsm-service's own
JSON error bodies (or a generic proxy-error message) are returned.
"""
import requests
from flask import Blueprint, request, jsonify, Response
from common.config_manager import get_itsm_config

bp = Blueprint('itsm_proxy', __name__)

# Compared case-insensitively: Werkzeug normalises incoming header names to
# title-case (e.g. the browser's "X-Tenant-ID" arrives as "X-Tenant-Id"), so a
# case-sensitive match would silently drop X-Tenant-ID and break ALL
# platform/super_admin tenant-scoped calls ("Tenant context required").
_FORWARD_REQUEST_HEADERS = {'authorization', 'x-tenant-id', 'content-type', 'accept'}
_DROP_RESPONSE_HEADERS   = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}


def _itsm_base_url() -> str:
    return get_itsm_config().get('service_url', 'http://127.0.0.1:8000').rstrip('/')


@bp.route('/itsm-api/<path:path>', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
def proxy_itsm(path):
    target = f"{_itsm_base_url()}/api/v1/{path}"
    headers = {k: v for k, v in request.headers.items() if k.lower() in _FORWARD_REQUEST_HEADERS}

    try:
        upstream = requests.request(
            method=request.method,
            url=target,
            params=request.args,
            data=request.get_data() if request.method in ('POST', 'PUT', 'PATCH') else None,
            headers=headers,
            timeout=30,
        )
    except requests.RequestException as e:
        return jsonify({'error': f'itsm-service unreachable: {e.__class__.__name__}'}), 502

    response_headers = [
        (k, v) for k, v in upstream.headers.items()
        if k.lower() not in _DROP_RESPONSE_HEADERS
    ]
    return Response(upstream.content, status=upstream.status_code, headers=response_headers)
