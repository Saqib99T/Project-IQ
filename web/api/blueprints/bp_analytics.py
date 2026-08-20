"""
Analytics blueprint.
Routes: /admin/analytics/*, /analytics/satisfaction, /admin/analytics/satisfaction
"""
import logging
from flask import Blueprint, request, jsonify
from common.analytics_store import get_analytics_summary, get_recent_conversations, get_deflection_metrics
from common.conversation_db import get_app_list
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('analytics', __name__)


@bp.route('/admin/analytics/apps', methods=['GET'])
@_s.require_iam_token
def list_apps():
    """Product filter options = real products present in the caller's (scoped) data.
    Tenant admin → their org; super admin → all tenants, or the switched tenant
    (X-Org-Id). Replaces the legacy chat_apps catalog (IT Support / Accounting…)."""
    try:
        from common.conversation_db import _get_connection, _release_connection
        from psycopg2.extras import RealDictCursor
        from web.api.blueprints.bp_chat import _product_label
        scope_org = _s.caller_org_scope()
        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(
                "SELECT DISTINCT app_id FROM conversations "
                "WHERE app_id IS NOT NULL AND app_id <> '' AND (%s IS NULL OR org_id = %s)",
                (scope_org, scope_org),
            )
            slugs = sorted({r['app_id'] for r in cur.fetchall() if r.get('app_id')})
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({"success": True,
                        "apps": [{"app_id": s, "name": _product_label(s)} for s in slugs]})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/summary', methods=['GET'])
@_s.require_iam_token
def analytics_summary():
    try:
        app_id  = request.args.get('app_id') or None
        summary = get_analytics_summary(app_id=app_id, org_id=_s.caller_org_scope(),
                                        days=request.args.get('days', type=int))
        return jsonify({"success": True, "data": summary})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


_DEFLECTION_WINDOWS = {'7 days', '30 days', '90 days'}

@bp.route('/admin/analytics/deflection', methods=['GET'])
@_s.require_iam_token
def deflection_metrics():
    """Bot-resolved vs escalated + KB deflection over a vetted window."""
    try:
        window = request.args.get('window', '30 days')
        if window not in _DEFLECTION_WINDOWS:
            window = '30 days'
        data = get_deflection_metrics(
            window=window,
            org_id=_s.caller_org_scope(),
            app_id=request.args.get('app_id') or None,
        )
        return jsonify({"success": True, "window": window, "data": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/conversations', methods=['GET'])
@_s.require_iam_token
def recent_conversations():
    try:
        app_id        = request.args.get('app_id') or None
        user_search   = request.args.get('user') or None
        ticket_status = request.args.get('ticket_status') or None
        date_filter   = request.args.get('date') or None
        convs = get_recent_conversations(
            limit=request.args.get('limit', 50, type=int),
            app_id=app_id if app_id != 'all' else None,
            user_search=user_search,
            ticket_status=ticket_status if ticket_status != 'all' else None,
            date_filter=date_filter if date_filter != 'all' else None,
            date_from=request.args.get('date_from'),
            date_to=request.args.get('date_to'),
            org_id=_s.caller_org_scope(),
        )
        return jsonify({"success": True, "data": convs, "count": len(convs)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/intents', methods=['GET'])
@_s.require_iam_token
def intent_distribution():
    try:
        summary = get_analytics_summary(app_id=request.args.get('app_id') or None,
                                        org_id=_s.caller_org_scope(),
                                        days=request.args.get('days', type=int))
        return jsonify({"success": True, "data": {
            "intents": summary.get("intent_distribution", {}),
            "top_intents": summary.get("top_intents", [])
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/feedback', methods=['GET'])
@_s.require_iam_token
def feedback_metrics():
    try:
        summary = get_analytics_summary(app_id=request.args.get('app_id') or None,
                                        org_id=_s.caller_org_scope(),
                                        days=request.args.get('days', type=int))
        return jsonify({"success": True, "data": {
            "positive":       summary.get("feedback_positive", 0),
            "negative":       summary.get("feedback_negative", 0),
            "resolution_rate": summary.get("resolution_rate", 0)
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/analytics/satisfaction', methods=['GET'])
@bp.route('/admin/analytics/satisfaction', methods=['GET'])
@_s.require_iam_token
def satisfaction_ratings():
    try:
        days = request.args.get('days', '30')
        scope_org = _s.caller_org_scope()
        from common.conversation_db import _get_read_connection, _release_read_connection
        conn, is_replica = _get_read_connection()
        try:
            cur = conn.cursor()
            date_clause = ''
            if days != 'all':
                try:
                    date_clause = f"AND f.timestamp >= NOW() - INTERVAL '{int(days)} days'"
                except ValueError:
                    pass
            # feedback has no org column → scope via conversations join for tenants.
            org_join   = "JOIN conversations c ON c.id = f.conversation_id" if scope_org else ""
            org_clause = "AND c.org_id = %s" if scope_org else ""
            org_params = [scope_org] if scope_org else []
            cur.execute(f"""
                SELECT CASE
                    WHEN f.feedback_text LIKE '%%5 stars%%' THEN 5
                    WHEN f.feedback_text LIKE '%%4 stars%%' THEN 4
                    WHEN f.feedback_text LIKE '%%3 stars%%' THEN 3
                    WHEN f.feedback_text LIKE '%%2 stars%%' THEN 2
                    WHEN f.feedback_text LIKE '%%1 star%%'  THEN 1
                    ELSE 0 END AS rating,
                    COUNT(*) AS cnt
                FROM feedback f {org_join}
                WHERE f.feedback_text LIKE '%%Satisfaction%%' {date_clause} {org_clause}
                GROUP BY rating ORDER BY rating DESC
            """, tuple(org_params))
            rows         = cur.fetchall()
            ratings      = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
            total        = 0
            weighted_sum = 0
            for rating, cnt in rows:
                if rating > 0:
                    ratings[rating] = cnt
                    total        += cnt
                    weighted_sum += rating * cnt
        finally:
            _release_read_connection(conn, is_replica)
        return jsonify({"success": True, "data": {
            "ratings": ratings, "total": total,
            "average": round(weighted_sum / total, 2) if total else 0
        }})
    except Exception as e:
        logger.error("[Analytics] satisfaction error: %s", e)
        return jsonify({"success": True, "data": {
            "ratings": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}, "total": 0, "average": 0
        }})
