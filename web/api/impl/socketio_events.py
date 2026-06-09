"""
Socket.IO event handlers and background worker threads.

Call register_sio_events(sio) after the SocketIO instance is created,
then call start_background_workers() once per process (guarded by worker-id).
"""
import time as _time
import threading as _threading
import os as _os
import traceback

import web.api.shared as _s
from web.api.shared import emit_to_user, emit_queue_overview
from common.conversation_db import _get_connection, _release_connection


def register_sio_events(sio) -> None:
    """Register all Socket.IO event handlers on the given sio instance."""

    from flask_socketio import emit, join_room, leave_room

    @sio.on('connect')
    def _sio_connect():
        pass

    @sio.on('disconnect')
    def _sio_disconnect():
        pass

    @sio.on('user_end_session')
    def _sio_user_end_session(data):
        sender_id = (data or {}).get('sender_id', '')
        if not sender_id:
            return
        try:
            from datetime import datetime as _dt
            from psycopg2.extras import RealDictCursor as _RRC
            conn = _get_connection()
            try:
                cur = conn.cursor(cursor_factory=_RRC)
                cur.execute(
                    "SELECT hq.id, hq.status, hq.conversation_id, hq.operator_id "
                    "FROM handoff_queue hq "
                    "JOIN conversations c ON c.id = hq.conversation_id "
                    "WHERE c.sender_id = %s AND hq.status IN ('waiting', 'assigned') "
                    "ORDER BY hq.queued_at DESC LIMIT 1",
                    (sender_id,)
                )
                row = cur.fetchone()
                if not row:
                    return

                queue_id     = row['id']
                conv_id      = row['conversation_id']
                op_id        = row['operator_id']
                was_assigned = row['status'] == 'assigned'

                if was_assigned:
                    cur.execute(
                        "UPDATE handoff_queue "
                        "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User ended session', "
                        "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT "
                        "WHERE id = %s",
                        (_dt.now(), queue_id)
                    )
                    new_state = 'closed'
                else:
                    cur.execute(
                        "UPDATE handoff_queue "
                        "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User left queue' "
                        "WHERE id = %s",
                        (_dt.now(), queue_id)
                    )
                    new_state = 'bot_active'

                cur.execute(
                    "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL "
                    "WHERE id = %s",
                    (new_state, conv_id)
                )
                cur.execute(
                    "INSERT INTO handoff_state_log "
                    "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                    "VALUES (%s, %s, %s, 'user', NULL, 'User ended session')",
                    (conv_id, 'assigned' if was_assigned else 'queued', new_state)
                )
                conn.commit()
            finally:
                _release_connection(conn)

            if was_assigned and op_id:
                sio.emit('user_left', {
                    'conversation_id': conv_id,
                    'sender_id':       sender_id,
                    'message':         'The user has ended the conversation.',
                }, room=_s._room_operator(op_id))

            sio.emit('queue_item_removed', {'queue_id': queue_id, 'status': 'abandoned'},
                     room='queue_overview')
            emit_queue_overview()

        except Exception as _e:
            print(f"[SIO user_end_session] error (non-fatal): {_e}")

    @sio.on('handoff_queued')
    def _sio_handoff_queued(data):
        """Notify user they joined the queue, and alert all available operators."""
        sender_id = (data or {}).get('sender_id', '')
        app_id    = (data or {}).get('app_id')
        if sender_id:
            from web.api.impl.notify import notify_user, notify_admins
            notify_user(
                user_id=sender_id, type='handoff_queued', app_id=app_id,
                title='You\'re in the queue',
                body='An agent will be with you shortly.',
                payload={'sender_id': sender_id},
            )
            # Alert all operators that someone is waiting
            notify_admins(
                type='queue_new_user',
                title='New user in queue',
                body=f'A user is waiting for support{" (" + app_id + ")" if app_id else ""}.',
                payload={'sender_id': sender_id, 'app_id': app_id},
            )

    @sio.on('handoff_assigned')
    def _sio_handoff_assigned(data):
        """Operator panel emits this when accepting a session; notify the user."""
        sender_id     = (data or {}).get('sender_id', '')
        operator_name = (data or {}).get('operator_name', 'An agent')
        app_id        = (data or {}).get('app_id')
        if sender_id:
            from web.api.impl.notify import notify_user
            notify_user(
                user_id=sender_id, type='handoff_assigned', app_id=app_id,
                title='Agent connected',
                body=f'{operator_name} has joined your session.',
                payload={'sender_id': sender_id, 'operator_name': operator_name},
            )

    @sio.on('handoff_ended')
    def _sio_handoff_ended(data):
        """Operator resolves/abandons the session; notify the user."""
        sender_id = (data or {}).get('sender_id', '')
        app_id    = (data or {}).get('app_id')
        if sender_id:
            from web.api.impl.notify import notify_user
            notify_user(
                user_id=sender_id, type='handoff_ended', app_id=app_id,
                title='Session closed',
                body='Your support session has ended. Rate your experience below.',
                payload={'sender_id': sender_id},
            )

    @sio.on('join_user')
    def _sio_join_user(data):
        sender_id = (data or {}).get('sender_id', '')
        if sender_id:
            join_room(_s._room_user(sender_id))

    @sio.on('leave_user')
    def _sio_leave_user(data):
        sender_id = (data or {}).get('sender_id', '')
        if sender_id:
            leave_room(_s._room_user(sender_id))

    @sio.on('join_operator')
    def _sio_join_operator(data):
        try:
            from web.api.shared import jwt_decode, get_operator_jwt_secret
            token   = (data or {}).get('token', '')
            payload = jwt_decode(token, get_operator_jwt_secret())
            op_id   = payload.get('sub') or payload.get('operator_id')
            if not op_id:
                return
            join_room(_s._room_operator(op_id))
            join_room('queue_overview')
            emit('joined_operator', {'operator_id': op_id, 'room': _s._room_operator(op_id)})
        except Exception:
            pass

    @sio.on('leave_operator')
    def _sio_leave_operator(data):
        op_id = (data or {}).get('operator_id')
        if op_id:
            leave_room(_s._room_operator(op_id))
            leave_room('queue_overview')

    @sio.on('join_portal_operator')
    def _sio_join_portal_operator(data):
        """Portal SPA operators join their room using the Keycloak Bearer token."""
        try:
            from common.iam_service import verify_iam_token, IamTokenError
            token = (data or {}).get('token', '')
            if not token:
                return
            try:
                claims = verify_iam_token(token)
            except IamTokenError:
                return
            email = claims.get('email', '')
            if not email:
                return
            # Resolve operators.id by email (username = email for IAM users)
            from common.conversation_db import _get_connection, _release_connection
            from psycopg2.extras import RealDictCursor as _PRDC
            conn = _get_connection()
            try:
                cur = conn.cursor(cursor_factory=_PRDC)
                cur.execute("SELECT id FROM operators WHERE username = %s", (email,))
                row = cur.fetchone()
            finally:
                _release_connection(conn)
            if not row:
                return
            op_id = row['id']
            join_room(_s._room_operator(op_id))
            join_room('queue_overview')
            emit('joined_operator', {'operator_id': op_id, 'room': _s._room_operator(op_id)})
        except Exception as _e:
            print(f"[SIO join_portal_operator] error (non-fatal): {_e}")

    @sio.on('join_admin_live')
    def _sio_join_admin_live(data):
        join_room('admin_live')
        join_room('queue_overview')

    @sio.on('join_admin_watch')
    def _sio_join_admin_watch(data):
        conv_id = (data or {}).get('conversation_id')
        if conv_id:
            join_room(_s._room_admin_watch(conv_id))

    @sio.on('leave_admin_watch')
    def _sio_leave_admin_watch(data):
        conv_id = (data or {}).get('conversation_id')
        if conv_id:
            leave_room(_s._room_admin_watch(conv_id))

    @sio.on('user_typing')
    def _sio_user_typing(data):
        try:
            conv_id = (data or {}).get('conversation_id')
            if not conv_id:
                return
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _RDC2
                cur = conn.cursor(cursor_factory=_RDC2)
                cur.execute(
                    "SELECT assigned_operator_id FROM conversations WHERE id = %s",
                    (conv_id,)
                )
                row = cur.fetchone()
            finally:
                _release_connection(conn)
            if row and row.get('assigned_operator_id'):
                sio.emit('user_typing', {
                    'conversation_id': conv_id,
                    'typing': data.get('typing', False),
                }, room=_s._room_operator(row['assigned_operator_id']))
        except Exception:
            pass

    @sio.on('operator_typing')
    def _sio_operator_typing(data):
        sender_id = (data or {}).get('sender_id')
        if sender_id:
            sio.emit('operator_typing', {
                'conversation_id': data.get('conversation_id'),
                'typing': data.get('typing', False),
            }, room=_s._room_user(sender_id))


# ── Background workers ────────────────────────────────────────────────────────

def _ensure_sla_column():
    """Add sla_alerted_at column to handoff_queue if it doesn't exist yet."""
    try:
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                ALTER TABLE handoff_queue
                ADD COLUMN IF NOT EXISTS sla_alerted_at TIMESTAMPTZ
            """)
            conn.commit()
        finally:
            _release_connection(conn)
    except Exception as e:
        print(f"[SLA] column migration skipped: {e}")


def _queue_timeout_worker():
    _time.sleep(10)
    _ensure_sla_column()
    while True:
        try:
            from common.conversation_db import get_handoff_runtime_config
            cfg           = get_handoff_runtime_config()
            ask_after     = int(cfg.get('queue', {}).get('ask_user_after_mins', 10))
            timeout_total = int(cfg.get('queue', {}).get('timeout_total_mins', 30))

            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _QTRC
                cur = conn.cursor(cursor_factory=_QTRC)
                # ── SLA alert threshold (default 20 mins) ─────────────────
                sla_alert_mins = int(cfg.get('queue', {}).get('sla_alert_mins', 20))

                cur.execute("""
                    SELECT hq.id, hq.conversation_id, c.sender_id, c.app_id,
                           EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 AS wait_mins
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                      AND hq.queued_at IS NOT NULL
                      AND hq.sla_alerted_at IS NULL
                      AND EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 >= %s
                """, (sla_alert_mins,))
                sla_rows = cur.fetchall() or []
                for row in sla_rows:
                    cur.execute(
                        "UPDATE handoff_queue SET sla_alerted_at = NOW() WHERE id = %s",
                        (row['id'],)
                    )
                    conn.commit()
                    from web.api.impl.notify import notify_admins
                    notify_admins(
                        type='sla_breach',
                        title=f'SLA Alert — user waiting {round(row["wait_mins"]):.0f} min',
                        body=f'A user has been in the queue for {round(row["wait_mins"]):.0f} minutes with no agent assigned.',
                        payload={'sender_id': row['sender_id'], 'app_id': row.get('app_id'),
                                 'conversation_id': row['conversation_id'],
                                 'wait_mins': round(row['wait_mins'], 1)},
                    )

                # ── Ask user if they want to keep waiting ─────────────────
                cur.execute("""
                    SELECT hq.id, hq.conversation_id, c.sender_id,
                           EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 AS wait_mins
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                      AND hq.queued_at IS NOT NULL
                      AND (hq.timeout_asked_at IS NULL)
                      AND EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 >= %s
                """, (ask_after,))
                rows = cur.fetchall() or []
                for row in rows:
                    cur.execute(
                        "UPDATE handoff_queue SET timeout_asked_at = NOW() WHERE id = %s",
                        (row['id'],)
                    )
                    conn.commit()
                    emit_to_user(row['sender_id'], 'handoff_timeout_choice', {
                        'conversation_id': row['conversation_id'],
                        'wait_mins':       round(row['wait_mins'], 1),
                        'message': (
                            f"⏳ You've been waiting for {round(row['wait_mins'], 0):.0f} minutes. "
                            "Would you like to keep waiting or leave your email so an agent can follow up?"
                        ),
                        'options': [
                            {'label': '🕐 Remain in Queue',  'value': 'remain'},
                            {'label': '📧 Leave my email',   'value': 'leave_email'},
                        ],
                    })

                cur.execute("""
                    SELECT hq.id, hq.conversation_id, c.sender_id
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                      AND hq.queued_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 >= %s
                """, (timeout_total,))
                expired = cur.fetchall() or []
                for row in expired:
                    cur.execute(
                        "UPDATE handoff_queue SET status = 'abandoned' WHERE id = %s",
                        (row['id'],)
                    )
                    cur.execute(
                        "UPDATE conversations SET handoff_state = 'bot_active', assigned_operator_id = NULL "
                        "WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    cur.execute(
                        "INSERT INTO handoff_state_log "
                        "(conversation_id, from_state, to_state, triggered_by, note) "
                        "VALUES (%s, 'queued', 'bot_active', 'system', 'queue timeout')",
                        (row['conversation_id'],)
                    )
                    conn.commit()
                    emit_to_user(row['sender_id'], 'handoff_abandoned', {
                        'conversation_id': row['conversation_id'],
                        'message': (
                            "⚠️ The queue wait exceeded our limit. "
                            "I'm returning you to the bot. You can create a ticket and an agent will follow up."
                        ),
                    })
                    emit_queue_overview()

                # Always close the transaction — the SELECTs above leave one open
                # even when no rows matched, which would otherwise leak an
                # "idle in transaction" connection back to the pool.
                conn.commit()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(30)


def _wait_refresh_worker():
    _time.sleep(15)
    while True:
        try:
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _WRRC
                cur = conn.cursor(cursor_factory=_WRRC)
                cur.execute("""
                    SELECT hq.id, hq.queue_position, c.sender_id,
                           ROUND(EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60) AS wait_mins
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                """)
                rows = cur.fetchall() or []
                # Read-only, but psycopg2 still leaves a transaction open after
                # the SELECT — close it before returning the connection to the pool.
                conn.rollback()
            finally:
                _release_connection(conn)

            from common.conversation_db import get_handoff_runtime_config
            cfg        = get_handoff_runtime_config()
            avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))

            for row in rows:
                pos = int(row['queue_position'] or 1)
                est = round(pos * avg_handle)
                emit_to_user(row['sender_id'], 'wait_update', {
                    'queue_position':     pos,
                    'wait_estimate_mins': est,
                    'actual_wait_mins':   int(row['wait_mins'] or 0),
                })
        except Exception:
            traceback.print_exc()
        _time.sleep(60)


def _priority_boost_worker():
    _time.sleep(20)
    while True:
        try:
            conn = _get_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE handoff_queue
                    SET priority = LEAST(priority + 1, 9)
                    WHERE status = 'waiting'
                      AND queued_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - queued_at)) / 60 >= 5
                      AND priority < 9
                """)
                conn.commit()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(300)


def _heartbeat_watchdog():
    _time.sleep(30)
    while True:
        try:
            from common.config_manager import get_handoff_config
            timeout_secs = int(get_handoff_config().get('operator_heartbeat_timeout_secs', 90))
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _HWRC
                cur = conn.cursor(cursor_factory=_HWRC)
                cur.execute("""
                    UPDATE operators
                    SET status = 'offline'
                    WHERE status IN ('available', 'busy', 'away')
                      AND last_seen IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - last_seen)) > %s
                    RETURNING id, display_name
                """, (timeout_secs,))
                gone_offline = cur.fetchall() or []
                conn.commit()
                for op in gone_offline:
                    print(f"[Heartbeat watchdog] Operator {op['display_name']} set offline (missed heartbeat)")
                    _s.sio.emit('capacity_update', {
                        'operator_id': op['id'],
                        'status': 'offline',
                    }, room='queue_overview')
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(30)


def _orphan_state_healer():
    _time.sleep(60)
    while True:
        try:
            conn = _get_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE conversations
                    SET handoff_state = 'bot_active', assigned_operator_id = NULL
                    WHERE handoff_state = 'queued'
                      AND NOT EXISTS (
                          SELECT 1 FROM handoff_queue hq
                          WHERE hq.conversation_id = conversations.id
                            AND hq.status = 'waiting'
                      )
                """)
                healed_queued = cur.rowcount
                cur.execute("""
                    UPDATE conversations
                    SET handoff_state = 'bot_active', assigned_operator_id = NULL
                    WHERE handoff_state = 'assigned'
                      AND NOT EXISTS (
                          SELECT 1 FROM handoff_queue hq
                          WHERE hq.conversation_id = conversations.id
                            AND hq.status = 'assigned'
                      )
                """)
                healed_assigned = cur.rowcount
                if healed_queued or healed_assigned:
                    conn.commit()
                    print(f"[OrphanHealer] Healed {healed_queued} queued + {healed_assigned} assigned orphans")
                else:
                    conn.rollback()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(300)


def start_background_workers() -> None:
    """Start all background threads. Call once — guarded externally by GUNICORN_WORKER_ID."""
    worker_id = int(_os.environ.get('GUNICORN_WORKER_ID', '0'))
    if worker_id != 0:
        print(f'[Admin] Background workers skipped (worker_id={worker_id}, primary handles them)')
        return

    _threading.Thread(target=_queue_timeout_worker,  daemon=True, name='sio-queue-timeout').start()
    _threading.Thread(target=_wait_refresh_worker,   daemon=True, name='sio-wait-refresh').start()
    _threading.Thread(target=_priority_boost_worker, daemon=True, name='sio-priority-boost').start()
    _threading.Thread(target=_heartbeat_watchdog,    daemon=True, name='sio-heartbeat-watchdog').start()
    _threading.Thread(target=_orphan_state_healer,   daemon=True, name='sio-orphan-healer').start()
    print(f'[Admin] Background workers started (worker_id={worker_id})')
