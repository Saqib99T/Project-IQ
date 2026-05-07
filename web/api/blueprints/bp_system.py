"""
System health and simple observability blueprint.
Routes: /health, /admin/health, /health/rasa, /health/actions, /health/database
"""
import requests
from flask import Blueprint, jsonify, request
import web.api.shared as _s

bp = Blueprint('system', __name__)


@bp.route('/health', methods=['GET'])
@bp.route('/admin/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "service": "admin-api"})


@bp.route('/health/rasa', methods=['GET'])
def health_rasa():
    try:
        r = requests.get(f"{_s.RASA_URL}/status", timeout=3)
        return jsonify({"status": "ok" if r.status_code == 200 else "degraded",
                        "rasa_status": r.status_code})
    except Exception as e:
        return jsonify({"status": "down", "error": str(e)}), 503


@bp.route('/health/actions', methods=['GET'])
def health_actions():
    try:
        action_health = _s.ACTION_URL.replace('/webhook', '/health')
        r = requests.get(action_health, timeout=3)
        return jsonify({"status": "ok" if r.status_code == 200 else "degraded"})
    except Exception as e:
        return jsonify({"status": "down", "error": str(e)}), 503


@bp.route('/health/database', methods=['GET'])
def health_database():
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            return jsonify({"status": "ok"})
        finally:
            _release_connection(conn)
    except Exception as e:
        return jsonify({"status": "down", "error": str(e)}), 503


@bp.route('/api/rasa/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy_rasa(path):
    """Proxy requests to Rasa Core (avoids CORS issues in admin panel)."""
    rasa_url = f"{_s.RASA_URL}/{path}"
    try:
        headers = {'Accept': 'application/json'}
        if request.method == 'GET':
            resp = requests.get(rasa_url, params=request.args, headers=headers)
        elif request.method == 'POST':
            resp = requests.post(rasa_url, json=request.get_json(), headers=headers)
        elif request.method == 'PUT':
            resp = requests.put(rasa_url, json=request.get_json(), headers=headers)
        else:
            resp = requests.delete(rasa_url, headers=headers)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": f"Rasa proxy error: {e}"}), 500
