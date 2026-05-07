"""
Analytics blueprint.
Routes: /admin/analytics/*, /analytics/satisfaction, /admin/analytics/satisfaction
"""
from flask import Blueprint, request, jsonify
from common.analytics_store import get_analytics_summary, get_recent_conversations
from common.conversation_db import get_app_list

bp = Blueprint('analytics', __name__)


@bp.route('/admin/analytics/apps', methods=['GET'])
def list_apps():
    try:
        return jsonify({"success": True, "apps": get_app_list()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/summary', methods=['GET'])
def analytics_summary():
    try:
        app_id  = request.args.get('app_id') or None
        summary = get_analytics_summary(app_id=app_id)
        return jsonify({"success": True, "data": summary})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/conversations', methods=['GET'])
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
        )
        return jsonify({"success": True, "data": convs, "count": len(convs)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/intents', methods=['GET'])
def intent_distribution():
    try:
        summary = get_analytics_summary(app_id=request.args.get('app_id') or None)
        return jsonify({"success": True, "data": {
            "intents": summary.get("intent_distribution", {}),
            "top_intents": summary.get("top_intents", [])
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/analytics/feedback', methods=['GET'])
def feedback_metrics():
    try:
        summary = get_analytics_summary(app_id=request.args.get('app_id') or None)
        return jsonify({"success": True, "data": {
            "positive":       summary.get("feedback_positive", 0),
            "negative":       summary.get("feedback_negative", 0),
            "resolution_rate": summary.get("resolution_rate", 0)
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/analytics/satisfaction', methods=['GET'])
@bp.route('/admin/analytics/satisfaction', methods=['GET'])
def satisfaction_ratings():
    try:
        days = request.args.get('days', '30')
        from common.conversation_db import _get_read_connection, _release_read_connection
        conn, is_replica = _get_read_connection()
        try:
            cur = conn.cursor()
            date_clause = ''
            if days != 'all':
                try:
                    date_clause = f"AND timestamp >= NOW() - INTERVAL '{int(days)} days'"
                except ValueError:
                    pass
            cur.execute(f"""
                SELECT CASE
                    WHEN feedback_text LIKE '%%5 stars%%' THEN 5
                    WHEN feedback_text LIKE '%%4 stars%%' THEN 4
                    WHEN feedback_text LIKE '%%3 stars%%' THEN 3
                    WHEN feedback_text LIKE '%%2 stars%%' THEN 2
                    WHEN feedback_text LIKE '%%1 star%%'  THEN 1
                    ELSE 0 END AS rating,
                    COUNT(*) AS cnt
                FROM feedback
                WHERE feedback_text LIKE '%%Satisfaction%%' {date_clause}
                GROUP BY rating ORDER BY rating DESC
            """)
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
        print(f"[Analytics] satisfaction error: {e}")
        return jsonify({"success": True, "data": {
            "ratings": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}, "total": 0, "average": 0
        }})
