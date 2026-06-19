"""
Admin operations blueprint.
Routes: /admin/operators/*, /admin/handoff/*, /admin/monitor/*,
        /admin/observability/*, /admin/health/<service>, /api/status,
        /observability/*
"""
from flask import Blueprint

from web.api.impl import admin_ops as _ao
from web.api.impl import observability as _obs
from web.api import shared as _s

bp = Blueprint('admin_ops', __name__)

# ── Operator CRUD ──────────────────────────────────────────────────────────────

@bp.route('/admin/operators', methods=['GET'])
def list_operators():
    return _ao.list_operators()

@bp.route('/admin/operators', methods=['POST'])
def create_operator():
    return _ao.create_operator_endpoint()

@bp.route('/admin/operators/<int:operator_id>', methods=['GET'])
def get_operator(operator_id):
    return _ao.get_operator_endpoint(operator_id)

@bp.route('/admin/operators/<int:operator_id>', methods=['PUT'])
def update_operator(operator_id):
    return _ao.update_operator_endpoint(operator_id)

@bp.route('/admin/operators/<int:operator_id>', methods=['DELETE'])
def delete_operator(operator_id):
    return _ao.delete_operator_endpoint(operator_id)

@bp.route('/admin/operators/<int:operator_id>/stats', methods=['GET'])
def operator_stats(operator_id):
    return _ao.operator_stats_endpoint(operator_id)

@bp.route('/admin/client-users', methods=['GET'])
def list_client_users():
    return _ao.list_client_users()

@bp.route('/admin/client-users', methods=['POST'])
def create_client_user():
    return _ao.create_client_user()

@bp.route('/admin/client-users/<username>', methods=['PUT'])
def update_client_user(username):
    return _ao.update_client_user(username)


# ── Handoff config ─────────────────────────────────────────────────────────────

@bp.route('/admin/handoff/config', methods=['GET'])
def get_handoff_config():
    return _ao.get_handoff_config_endpoint()

@bp.route('/admin/handoff/config', methods=['PUT'])
def update_handoff_config():
    return _ao.update_handoff_config_endpoint()

@bp.route('/admin/handoff/routing', methods=['GET'])
def get_routing_rules():
    return _ao.get_routing_rules()

@bp.route('/admin/handoff/routing', methods=['POST'])
def create_routing_rule():
    return _ao.create_routing_rule()

@bp.route('/admin/handoff/routing/<int:rule_id>', methods=['PUT'])
def update_routing_rule(rule_id):
    return _ao.update_routing_rule(rule_id)

@bp.route('/admin/handoff/routing/<int:rule_id>', methods=['DELETE'])
def delete_routing_rule(rule_id):
    return _ao.delete_routing_rule(rule_id)

@bp.route('/admin/handoff/routing/test', methods=['POST'])
def test_routing_rule():
    return _ao.test_routing_rule()

@bp.route('/admin/handoff/force', methods=['POST'])
def admin_force_handoff():
    return _ao.admin_force_handoff()

@bp.route('/admin/handoff/analytics', methods=['GET'])
@_s.require_iam_token
def handoff_analytics():
    return _ao.handoff_analytics()


# ── Notification send ─────────────────────────────────────────────────────────

@bp.route('/admin/notifications/send', methods=['POST'])
def admin_send_notification():
    return _ao.admin_send_notification()


# ── Monitor ───────────────────────────────────────────────────────────────────

@bp.route('/admin/monitor/queue', methods=['GET'])
@_s.require_iam_token
def admin_monitor_queue():
    return _ao.admin_monitor_queue()


# ── Observability ─────────────────────────────────────────────────────────────

@bp.route('/api/status', methods=['GET'])
def system_status():
    return _obs.system_status()

@bp.route('/admin/observability/metrics', methods=['GET'])
def get_system_metrics():
    return _obs.get_system_metrics()

@bp.route('/admin/observability/database/stats', methods=['GET'])
def get_database_stats():
    return _obs.get_db_stats()

@bp.route('/admin/observability/logs', methods=['GET'])
def get_logs():
    return _obs.get_recent_logs()

@bp.route('/admin/health/<service>', methods=['GET'])
def admin_health_service(service):
    return _obs.service_health(service)

# ── Diagnostics (super-admin): server logs (journald + docker) ──────────────────
def _require_platform_admin():
    """Return an error response if the caller isn't a platform/super admin, else None."""
    from flask import g, jsonify
    if not getattr(g, 'is_platform_admin', False):
        return jsonify({'error': 'super admin required'}), 403
    return None

@bp.route('/admin/diagnostics/logs/sources', methods=['GET'])
@_s.require_iam_token
def diagnostics_log_sources():
    return _require_platform_admin() or _obs.diagnostics_log_sources()

@bp.route('/admin/diagnostics/logs', methods=['GET'])
@_s.require_iam_token
def diagnostics_logs():
    return _require_platform_admin() or _obs.diagnostics_logs()

@bp.route('/admin/firecrawl/service', methods=['POST'])
@_s.require_iam_token
def firecrawl_service_control():
    return _require_platform_admin() or _obs.firecrawl_service_control()

@bp.route('/observability/metrics', methods=['GET'])
def observability_metrics():
    return _obs.observability_metrics()

@bp.route('/observability/logs', methods=['GET'])
def observability_logs():
    return _obs.observability_logs()

@bp.route('/observability/processes', methods=['GET'])
def observability_processes():
    return _obs.observability_processes()

@bp.route('/observability/metrics/history', methods=['GET'])
def observability_metrics_history():
    return _obs.observability_metrics_history()

@bp.route('/observability/logs/filtered', methods=['GET'])
def observability_logs_filtered():
    return _obs.observability_logs_filtered()

@bp.route('/observability/logs/search', methods=['GET'])
def observability_logs_search():
    return _obs.observability_logs_search()

@bp.route('/observability/logs/stats', methods=['GET'])
def observability_logs_stats():
    return _obs.observability_logs_stats()

@bp.route('/observability/database/stats', methods=['GET'])
def observability_database_stats():
    return _obs.observability_database_stats()
