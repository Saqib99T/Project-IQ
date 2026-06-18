"""
Object-storage (MinIO/S3) reverse-proxy blueprint.

WHY: itsm-service hands out *presigned* upload/download URLs for ticket & KB
attachments. Those URLs point at STORAGE_PUBLIC_ENDPOINT. In production the
MinIO port (9000) is NOT reachable from the end-user's browser (only the web
app's port 8181 is open in the cloud firewall), so presigned PUT (upload) and
GET (download) both fail — uploads never land in the bucket and attachments
render as a broken/empty box.

FIX: point STORAGE_PUBLIC_ENDPOINT at this app (…:8181) and let this route
forward `/<bucket>/<key>?<presigned-query>` to MinIO on the loopback-published
port (127.0.0.1:9000, reachable from the host).

AWS SigV4 presigned URLs sign `SignedHeaders=host`, so MinIO re-validates the
signature against the **Host header it receives**. We therefore forward the
ORIGINAL Host header (the public endpoint boto3 signed against) and the RAW,
unmodified query string — re-encoding either would break the signature.

The proxy itself is unauthenticated, but harmless: MinIO still enforces the
presigned signature (returns 403 for missing/invalid/expired signatures), and
only the single configured bucket path is forwarded — never the MinIO admin API.
"""
import requests
from flask import Blueprint, request, Response
from common.config_manager import get_all_config

bp = Blueprint('storage_proxy', __name__)

# Bucket whose object paths we forward. Matches itsm-service STORAGE_BUCKET.
_BUCKET = 'itsm-files'
_DROP_RESPONSE_HEADERS = {'content-encoding', 'transfer-encoding', 'connection', 'keep-alive'}


def _minio_target() -> str:
    # Host-reachable MinIO endpoint. The itsm-service uses the docker hostname
    # (minio:9000) which is NOT resolvable from this host process, so default to
    # the loopback-published port. Overridable via STORAGE_PROXY_TARGET.
    try:
        return (get_all_config().get('STORAGE_PROXY_TARGET') or 'http://127.0.0.1:9000').rstrip('/')
    except Exception:
        return 'http://127.0.0.1:9000'


@bp.route(f'/{_BUCKET}/<path:key>', methods=['GET', 'HEAD', 'PUT', 'POST'])
def proxy_storage(key):
    raw_qs = request.query_string.decode('latin-1')
    target = f"{_minio_target()}/{_BUCKET}/{key}" + (f"?{raw_qs}" if raw_qs else "")

    # Preserve the signed Host header; forward content-type for signed uploads.
    fwd_headers = {'Host': request.headers.get('Host', '')}
    if request.headers.get('Content-Type'):
        fwd_headers['Content-Type'] = request.headers['Content-Type']

    body = request.get_data() if request.method in ('PUT', 'POST') else None

    try:
        upstream = requests.request(
            method=request.method,
            url=target,
            data=body,
            headers=fwd_headers,
            stream=True,
            timeout=60,
        )
    except requests.RequestException as e:
        return Response(f'storage unreachable: {e.__class__.__name__}', status=502)

    resp_headers = [(k, v) for k, v in upstream.headers.items()
                    if k.lower() not in _DROP_RESPONSE_HEADERS]
    return Response(
        upstream.iter_content(chunk_size=64 * 1024),
        status=upstream.status_code,
        headers=resp_headers,
    )
