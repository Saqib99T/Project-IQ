"""
common.db._handoff — operators CRUD, queue management, handoff state, consent.
"""
import json
from datetime import datetime
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection
from common.db._config import get_handoff_runtime_config


# ── Operator CRUD ─────────────────────────────────────────────────────────────

def get_operators(include_inactive: bool = False) -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if include_inactive:
            cursor.execute(
                "SELECT id, username, display_name, email, team, app_ids, shift_schedule, "
                "status, max_concurrent, is_active, created_at, last_seen FROM operators ORDER BY display_name"
            )
        else:
            cursor.execute(
                "SELECT id, username, display_name, email, team, app_ids, shift_schedule, "
                "status, max_concurrent, is_active, password_hash "
                "FROM operators WHERE is_active=TRUE ORDER BY display_name"
            )
        result = []
        for row in cursor.fetchall():
            op = dict(row)
            for f in ('created_at', 'last_seen'):
                if op.get(f): op[f] = op[f].isoformat()
            result.append(op)
        return result
    finally:
        _release_connection(conn)


def get_operator(operator_id: int) -> Optional[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, username, display_name, email, team, app_ids, shift_schedule, "
            "status, max_concurrent, is_active, password_hash FROM operators WHERE id=%s",
            (operator_id,)
        )
        row = cursor.fetchone()
        if not row: return None
        op = dict(row)
        for f in ('created_at', 'last_seen'):
            if op.get(f): op[f] = op[f].isoformat()
        return op
    finally:
        _release_connection(conn)


def get_operator_by_iam_sub(iam_sub: str) -> Optional[Dict]:
    """Look up an operator by their Keycloak subject UUID (iam_sub column)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        # iam_sub column added by migration; fall back gracefully if missing
        try:
            cursor.execute(
                "SELECT id, username, display_name, email, team, app_ids, "
                "status, max_concurrent, is_active "
                "FROM operators WHERE iam_sub=%s AND is_active=TRUE",
                (iam_sub,)
            )
            row = cursor.fetchone()
            return dict(row) if row else None
        except Exception:
            return None
    finally:
        _release_connection(conn)


def get_operator_by_email(email: str) -> Optional[Dict]:
    """Look up an operator by email address (used to link IAM sub on first login)."""
    if not email:
        return None
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, username, display_name, email, team, app_ids, "
            "status, max_concurrent, is_active, iam_sub "
            "FROM operators WHERE LOWER(email)=LOWER(%s) AND is_active=TRUE",
            (email,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def update_operator_iam_sub(operator_id: int, iam_sub: str) -> None:
    """Persist the Keycloak sub on an existing operator record (first IAM login)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE operators SET iam_sub=%s WHERE id=%s",
            (iam_sub, operator_id)
        )
        conn.commit()
    finally:
        _release_connection(conn)


def get_operator_by_username(username: str) -> Optional[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, username, display_name, email, team, app_ids, shift_schedule, "
            "status, max_concurrent, is_active, password_hash "
            "FROM operators WHERE username=%s AND is_active=TRUE",
            (username,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def create_operator(username: str, display_name: str, password_hash: str,
                    email: str = None, team: str = None, app_ids: List[str] = None,
                    max_concurrent: int = None, shift_schedule: Dict = None,
                    iam_sub: str = None) -> int:
    conn = _get_connection()
    try:
        cfg = get_handoff_runtime_config()
        default_max = cfg['operators']['default_max_concurrent']
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        # iam_sub column is optional — inserted only when provided
        if iam_sub:
            cursor.execute(
                "INSERT INTO operators (username, display_name, password_hash, email, team, app_ids, "
                "max_concurrent, shift_schedule, iam_sub) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (username, display_name, password_hash, email, team, app_ids or [],
                 max_concurrent if max_concurrent is not None else default_max,
                 json.dumps(shift_schedule) if shift_schedule else None, iam_sub)
            )
        else:
            cursor.execute(
                "INSERT INTO operators (username, display_name, password_hash, email, team, app_ids, "
                "max_concurrent, shift_schedule) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (username, display_name, password_hash, email, team, app_ids or [],
                 max_concurrent if max_concurrent is not None else default_max,
                 json.dumps(shift_schedule) if shift_schedule else None)
            )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_operator(operator_id: int, **kwargs) -> bool:
    allowed = {'display_name', 'email', 'team', 'app_ids', 'max_concurrent',
               'shift_schedule', 'status', 'is_active', 'password_hash', 'is_admin'}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates: return False
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        set_parts, params = [], []
        for col, val in updates.items():
            set_parts.append(f"{col}=%s")
            params.append(json.dumps(val) if col == 'shift_schedule' and isinstance(val, dict) else val)
        params.append(operator_id)
        cursor.execute(f"UPDATE operators SET {', '.join(set_parts)} WHERE id=%s", params)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def update_operator_last_seen(operator_id: int, status: str = None) -> bool:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        if status:
            cursor.execute("UPDATE operators SET last_seen=%s, status=%s WHERE id=%s",
                           (datetime.now(), status, operator_id))
        else:
            cursor.execute("UPDATE operators SET last_seen=%s WHERE id=%s",
                           (datetime.now(), operator_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def get_operator_current_load(operator_id: int) -> int:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM handoff_queue WHERE operator_id=%s AND status='assigned'",
            (operator_id,)
        )
        return cursor.fetchone()[0]
    finally:
        _release_connection(conn)


def get_operator_stats(operator_id: int) -> Dict:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT COUNT(*) AS total_handled, ROUND(AVG(handle_time_secs)) AS avg_handle_time_secs, "
            "ROUND(AVG(wait_time_secs)) AS avg_wait_time_secs, ROUND(AVG(agent_rating),2) AS avg_context_rating, "
            "COUNT(*) FILTER (WHERE return_to_bot=TRUE) AS returned_to_bot, "
            "COUNT(*) FILTER (WHERE return_to_bot=FALSE) AS closed_by_operator "
            "FROM handoff_queue WHERE operator_id=%s AND status='resolved'",
            (operator_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else {}
    finally:
        _release_connection(conn)


# ── Queue & availability ──────────────────────────────────────────────────────

def _is_within_shift(shift_schedule) -> bool:
    import pytz
    from datetime import time as dtime
    try:
        if isinstance(shift_schedule, str):
            shift_schedule = json.loads(shift_schedule)
        tz = pytz.timezone(shift_schedule.get('timezone', 'UTC'))
        now_local = datetime.now(tz)
        day_name = now_local.strftime('%A').lower()
        hours_str = shift_schedule.get(day_name, '00:00-23:59')
        if hours_str.upper() == 'OFF': return False
        start_str, end_str = hours_str.split('-')
        sh, sm = map(int, start_str.split(':'))
        eh, em = map(int, end_str.split(':'))
        cur = now_local.time().replace(second=0, microsecond=0)
        return dtime(sh, sm) <= cur <= dtime(eh, em)
    except Exception:
        return True


def get_available_operators(app_id: str = None) -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = (
            "SELECT o.id, o.display_name, o.team, o.app_ids, o.max_concurrent, o.shift_schedule, "
            "o.status, o.last_seen, "
            "(SELECT COUNT(*) FROM handoff_queue hq WHERE hq.operator_id=o.id AND hq.status='assigned') AS current_load "
            "FROM operators o WHERE o.is_active=TRUE "
            "AND o.last_seen > NOW() - INTERVAL '120 seconds' "
            "AND o.status NOT IN ('offline','away')"
        )
        params = []
        if app_id:
            query += " AND (o.app_ids='{}' OR %s=ANY(o.app_ids))"; params.append(app_id)
        cursor.execute(query, params)
        eligible = []
        for row in cursor.fetchall():
            op = dict(row)
            if op['current_load'] >= op['max_concurrent']: continue
            if op.get('shift_schedule') and not _is_within_shift(op['shift_schedule']): continue
            eligible.append(op)
        return eligible
    finally:
        _release_connection(conn)


def enqueue_handoff(conversation_id: int, sender_id: str, app_id: str,
                    trigger_reason: str, trigger_detail: Dict = None,
                    priority: int = None, context_package: Dict = None,
                    target_team: str = None, required_skill: str = None,
                    user_org_id: str = None, support_org_id: str = None,
                    product_id: str = None, channel: str = None) -> Optional[Dict]:
    conn = _get_connection()
    try:
        cfg = get_handoff_runtime_config()
        if priority is None: priority = cfg['queue']['default_priority']
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT * FROM handoff_queue WHERE sender_id=%s AND status IN ('waiting','assigned') "
            "ORDER BY queued_at DESC LIMIT 1", (sender_id,)
        )
        existing = cursor.fetchone()
        if existing: return dict(existing)
        cursor.execute(
            "SELECT COUNT(*) AS depth FROM handoff_queue WHERE app_id=%s AND status='waiting'", (app_id,)
        )
        if cursor.fetchone()['depth'] >= cfg['queue']['max_queue_depth']: return None
        cursor.execute(
            "INSERT INTO handoff_queue (conversation_id, sender_id, app_id, priority, trigger_reason, "
            "trigger_detail, target_team, required_skill, context_package, "
            "user_org_id, support_org_id, product_id, channel) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (conversation_id, sender_id, app_id, priority, trigger_reason,
             json.dumps(trigger_detail) if trigger_detail else None,
             target_team, required_skill,
             json.dumps(context_package) if context_package else None,
             user_org_id or '', support_org_id or '', product_id or '', channel or 'internal')
        )
        row = dict(cursor.fetchone())
        cursor.execute(
            "UPDATE conversations SET handoff_state='queued', handoff_count=handoff_count+1 WHERE id=%s",
            (conversation_id,)
        )
        cursor.execute(
            "INSERT INTO handoff_state_log (conversation_id, from_state, to_state, triggered_by, note) "
            "VALUES (%s,'bot_active','queued',%s,%s)",
            (conversation_id, trigger_reason, json.dumps(trigger_detail) if trigger_detail else None)
        )
        conn.commit()
        _recalculate_queue_positions(app_id)
        cursor.execute("SELECT * FROM handoff_queue WHERE id=%s", (row['id'],))
        updated = cursor.fetchone()
        return dict(updated) if updated else row
    except Exception as e:
        print(f"Error enqueuing handoff: {e}"); conn.rollback(); return None
    finally:
        _release_connection(conn)


def _recalculate_queue_positions(app_id: str):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM handoff_queue WHERE app_id=%s AND status='waiting' "
            "ORDER BY priority DESC, queued_at ASC", (app_id,)
        )
        for pos, row in enumerate(cursor.fetchall(), start=1):
            cursor.execute("UPDATE handoff_queue SET queue_position=%s WHERE id=%s", (pos, row[0]))
        conn.commit()
    finally:
        _release_connection(conn)


def get_queue(app_id: str = None, team: str = None, status: str = 'waiting') -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = (
            "SELECT hq.*, c.sender_id, c.user_name, c.user_id, c.low_conf_streak, c.frustration_score "
            "FROM handoff_queue hq JOIN conversations c ON c.id=hq.conversation_id WHERE 1=1"
        )
        params = []
        if status: query += " AND hq.status=%s"; params.append(status)
        if app_id: query += " AND hq.app_id=%s"; params.append(app_id)
        if team: query += " AND (hq.target_team=%s OR hq.target_team IS NULL)"; params.append(team)
        query += " ORDER BY hq.priority DESC, hq.queued_at ASC"
        cursor.execute(query, params)
        result = []
        for row in cursor.fetchall():
            item = dict(row)
            for ts in ('queued_at', 'assigned_at', 'resolved_at', 'abandoned_at'):
                if item.get(ts): item[ts] = item[ts].isoformat()
            result.append(item)
        return result
    finally:
        _release_connection(conn)


def log_handoff_consent(sender_id: str, conversation_id: int,
                        consented: bool, ip_hash: str = None) -> int:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "INSERT INTO handoff_consent_log (sender_id, conversation_id, consented, ip_hash) "
            "VALUES (%s,%s,%s,%s) RETURNING id",
            (sender_id, conversation_id, consented, ip_hash)
        )
        new_id = cursor.fetchone()['id']
        if consented:
            cursor.execute("UPDATE conversations SET consent_given=TRUE WHERE id=%s", (conversation_id,))
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)
