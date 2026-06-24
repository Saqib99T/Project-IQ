"""
Portal API — IAM-authenticated endpoints for the React portal SPA.

All routes require a valid Keycloak Bearer token (require_iam_token).
Responses are automatically scoped to the caller's org via
get_org_filter() / get_operator_queue_filter().
"""
from flask import Blueprint, request, jsonify, g
import web.api.shared as _s
from common.db._canned import (
    list_canned_responses, create_canned_response,
    update_canned_response, delete_canned_response,
)

bp = Blueprint('portal_api', __name__, url_prefix='/portal/api')


# ── Timestamp normalization ───────────────────────────────────────────────────
# Storage is inconsistent: messages.timestamp is written host-local (datetime.now)
# while handoff_queue.queued_at/resolved_at are written UTC (datetime.utcnow).
# Both columns are naive, so without normalization the operator UI shows the same
# event up to a tz-offset apart and time-window scoping silently misfires. These
# helpers convert the UTC-naive handoff timestamps onto the host-local basis the
# messages use, so everything the operator sees lines up.
from datetime import datetime as _dtmod, timezone as _tz

def _utc_naive_to_local(dt):
    """A naive-UTC datetime → naive host-local datetime (messages' basis)."""
    if dt is None:
        return None
    return dt.replace(tzinfo=_tz.utc).astimezone().replace(tzinfo=None)

def _utc_iso_to_local(s):
    """An ISO string assumed UTC → naive host-local datetime, or None."""
    if not s:
        return None
    try:
        dt = _dtmod.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_tz.utc)
    return dt.astimezone().replace(tzinfo=None)


# ── Operator provisioning helper ──────────────────────────────────────────────

def _get_or_create_portal_operator(iam_sub: str, name: str, email: str,
                                   org_id: str = '', channel: str = 'internal') -> int:
    """Return the integer operators.id for this IAM user.

    The operator row is a thin IAM-keyed projection: it is keyed by `iam_sub`
    (the IAM identity), NOT by username/email. A legacy row matched only by email
    is linked to its iam_sub on first portal login (one-time migration), so every
    operator ends up reliably tied to one IAM identity. Identity (name/email) is
    refreshed from the token; the row holds operator runtime state (team,
    capacity, presence). Mirrors the iam-login provisioning path."""
    from common.db._handoff import (
        get_operator_by_iam_sub, get_operator_by_email,
        update_operator_iam_sub, update_operator_last_seen, update_operator_org,
    )
    from common.conversation_db import create_operator

    op = get_operator_by_iam_sub(iam_sub)
    if not op and email:
        op = get_operator_by_email(email)
        if op:
            update_operator_iam_sub(op['id'], iam_sub)   # link the legacy row
    if not op:
        op_id = create_operator(
            iam_sub=iam_sub, username=(email or iam_sub),
            display_name=(name or email or iam_sub), password_hash='iam-managed',
            email=email, team='Support', app_ids=[], max_concurrent=3,
        )
    else:
        op_id = op['id']
        update_operator_last_seen(op_id)
    update_operator_org(op_id, org_id or None, channel or 'internal')
    return op_id


# ── Queue ─────────────────────────────────────────────────────────────────────

@bp.route('/queue', methods=['GET'])
@_s.require_iam_token
def portal_queue(**kwargs):
    """Waiting queue items visible to the calling operator/admin."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    scope_sql, scope_params = _s.get_operator_queue_filter()
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            f"""
            SELECT hq.id, hq.sender_id, hq.app_id, hq.priority,
                   hq.trigger_reason, hq.status, hq.queued_at,
                   hq.queue_position, hq.user_org_id, hq.support_org_id,
                   hq.product_id, hq.channel,
                   COALESCE(
                       NULLIF((SELECT c.user_name FROM conversations c
                               WHERE c.id = hq.conversation_id), ''),
                       hq.context_package->'user_profile'->>'display_name'
                   ) AS user_name
            FROM handoff_queue hq
            WHERE hq.status = 'waiting'
              AND {scope_sql}
            ORDER BY hq.priority DESC, hq.queued_at ASC
            LIMIT 100
            """,
            scope_params,
        )
        rows = [dict(r) for r in cur.fetchall()]
        for r in rows:
            qa = r.get('queued_at')
            if qa:
                # queued_at is stored UTC-naive (datetime.utcnow). Emit an explicit
                # 'Z' so the browser parses it as UTC, not local — otherwise clients
                # in non-UTC zones see a constant offset ("5h ago" for a fresh item).
                r['queued_at'] = qa.isoformat() + ('Z' if qa.tzinfo is None else '')
        return jsonify({'queue': rows, 'count': len(rows)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


@bp.route('/queue/claim', methods=['POST'])
@_s.require_iam_token
def portal_queue_claim(**kwargs):
    """Claim a waiting queue item. Creates/updates an operators record for the IAM user."""
    from datetime import datetime as _dt
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user      = g.iam_user
    op_id     = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''),
        name=user.get('name', ''),
        email=user.get('email', ''),
        org_id=user.get('org_id', ''),
        channel=user.get('channel', 'internal'),
    )

    data      = request.get_json(silent=True) or {}
    queue_id  = data.get('queue_id')
    sender_id = data.get('sender_id', '')
    if not queue_id:
        return jsonify({'error': 'queue_id required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            UPDATE handoff_queue
               SET status = 'assigned', operator_id = %s, assigned_at = %s,
                   wait_time_secs = EXTRACT(EPOCH FROM (NOW() - queued_at))::INT
             WHERE id = %s AND status = 'waiting'
            RETURNING id, conversation_id
            """,
            (op_id, _dt.now(), queue_id),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Already claimed or not found'}), 409

        conv_id = row['conversation_id']
        cur.execute(
            "UPDATE conversations SET handoff_state = 'assigned', assigned_operator_id = %s WHERE id = %s",
            (op_id, conv_id),
        )
        cur.execute(
            "INSERT INTO handoff_state_log "
            "(conversation_id, from_state, to_state, triggered_by, triggered_by_id) "
            "VALUES (%s, 'queued', 'assigned', 'operator', %s)",
            (conv_id, str(op_id)),
        )
        conn.commit()

        op_name = user.get('name') or user.get('email', 'An agent')
        _s.emit_to_user(sender_id, 'handoff_assigned', {
            'conversation_id': conv_id,
            'operator_name': op_name,
            'message': f"✅ {op_name} has joined the conversation.",
        })
        _s.sio.emit('queue_item_updated',
                    {'queue_id': queue_id, 'status': 'assigned', 'operator_id': op_id},
                    room='queue_overview')
        _s.emit_queue_overview()

        return jsonify({'success': True, 'conversation_id': conv_id, 'op_id': op_id})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


@bp.route('/queue/resolve', methods=['POST'])
@_s.require_iam_token
def portal_queue_resolve(**kwargs):
    """Resolve (close) an assigned session."""
    from datetime import datetime as _dt
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user     = g.iam_user
    op_id    = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    data          = request.get_json(silent=True) or {}
    queue_id      = data.get('queue_id')
    conv_id_hint  = data.get('conversation_id')
    closing_note  = data.get('closing_note', '')
    return_to_bot = data.get('return_to_bot', True)
    if not queue_id and not conv_id_hint:
        return jsonify({'error': 'queue_id or conversation_id required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        if queue_id:
            cur.execute(
                """
                UPDATE handoff_queue
                   SET status = 'resolved', resolved_at = %s, closing_note = %s,
                       return_to_bot = %s,
                       handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT
                 WHERE id = %s AND operator_id = %s AND status = 'assigned'
                RETURNING id AS queue_id, conversation_id
                """,
                (_dt.now(), closing_note, return_to_bot, queue_id, op_id),
            )
        else:
            cur.execute(
                """
                UPDATE handoff_queue
                   SET status = 'resolved', resolved_at = %s, closing_note = %s,
                       return_to_bot = %s,
                       handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT
                 WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'
                RETURNING id AS queue_id, conversation_id
                """,
                (_dt.now(), closing_note, return_to_bot, conv_id_hint, op_id),
            )
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Not found or not assigned to you'}), 409
        queue_id = row['queue_id']

        conv_id   = row['conversation_id']
        new_state = 'bot_active' if return_to_bot else 'closed'
        cur.execute(
            "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL WHERE id = %s",
            (new_state, conv_id),
        )
        cur.execute(
            "INSERT INTO handoff_state_log "
            "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
            "VALUES (%s, 'assigned', %s, 'operator', %s, %s)",
            (conv_id, new_state, str(op_id), closing_note),
        )
        cur.execute("SELECT sender_id FROM conversations WHERE id = %s", (conv_id,))
        cr = cur.fetchone()
        conn.commit()

        if cr:
            msg = (
                "✅ The agent has closed the session. I'm back to assist you."
                if return_to_bot else "The session has been closed."
            )
            _s.emit_to_user(cr['sender_id'], 'handoff_resolved', {
                'conversation_id': conv_id,
                'queue_id': queue_id,
                'message': msg,
                'return_to_bot': return_to_bot,
                'request_feedback': True,
            })

        _s.sio.emit('queue_item_removed',
                    {'queue_id': queue_id, 'status': 'resolved'}, room='queue_overview')
        _s.emit_queue_overview()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


@bp.route('/queue/release', methods=['POST'])
@_s.require_iam_token
def portal_queue_release(**kwargs):
    """Release an assigned session back to the queue."""
    from datetime import datetime as _dt
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    data         = request.get_json(silent=True) or {}
    queue_id     = data.get('queue_id')
    conv_id_hint = data.get('conversation_id')
    note         = data.get('note', '')
    if not queue_id and not conv_id_hint:
        return jsonify({'error': 'queue_id or conversation_id required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        if queue_id:
            cur.execute(
                """
                UPDATE handoff_queue
                   SET status = 'waiting', operator_id = NULL, assigned_at = NULL
                 WHERE id = %s AND operator_id = %s AND status = 'assigned'
                RETURNING id AS queue_id, conversation_id, app_id
                """,
                (queue_id, op_id),
            )
        else:
            cur.execute(
                """
                UPDATE handoff_queue
                   SET status = 'waiting', operator_id = NULL, assigned_at = NULL
                 WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'
                RETURNING id AS queue_id, conversation_id, app_id
                """,
                (conv_id_hint, op_id),
            )
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Not found or not assigned to you'}), 409
        queue_id = row['queue_id']

        conv_id = row['conversation_id']
        cur.execute(
            "UPDATE conversations SET handoff_state = 'queued', assigned_operator_id = NULL WHERE id = %s",
            (conv_id,),
        )
        cur.execute(
            "INSERT INTO handoff_state_log "
            "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
            "VALUES (%s, 'assigned', 'queued', 'operator', %s, %s)",
            (conv_id, str(op_id), note),
        )
        cur.execute("SELECT sender_id FROM conversations WHERE id = %s", (conv_id,))
        cr = cur.fetchone()
        conn.commit()

        if cr:
            _s.emit_to_user(cr['sender_id'], 'handoff_queued', {
                'conversation_id': conv_id,
                'message': "⏳ The agent returned your chat to the queue. You'll be connected to the next available agent.",
            })

        _s.sio.emit('queue_item_updated',
                    {'queue_id': queue_id, 'status': 'waiting'}, room='queue_overview')
        _s.emit_queue_overview()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


# ── Sessions (my assigned conversations) ─────────────────────────────────────

@bp.route('/sessions', methods=['GET'])
@_s.require_iam_token
def portal_sessions(**kwargs):
    """List conversations currently assigned to the calling operator."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT hq.id AS queue_id, hq.sender_id, hq.app_id, hq.priority,
                   hq.trigger_reason, hq.assigned_at, hq.queued_at,
                   hq.user_org_id, hq.product_id, hq.channel,
                   c.id AS conversation_id, c.last_activity,
                   COALESCE(NULLIF(c.user_name, ''),
                            hq.context_package->'user_profile'->>'display_name') AS user_name
            FROM handoff_queue hq
            JOIN conversations c ON c.id = hq.conversation_id
            WHERE hq.status = 'assigned' AND hq.operator_id = %s
            ORDER BY hq.assigned_at DESC
            """,
            (op_id,),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            for k in ('assigned_at', 'queued_at', 'last_activity'):
                v = d.get(k)
                if v:
                    # Naive datetimes are UTC → emit explicit 'Z' so clients in
                    # non-UTC zones don't show a constant offset.
                    d[k] = v.isoformat() + ('Z' if getattr(v, 'tzinfo', None) is None else '')
            rows.append(d)
        return jsonify({'sessions': rows, 'count': len(rows), 'op_id': op_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Conversation messages ─────────────────────────────────────────────────────

@bp.route('/conversation/<int:conversation_id>', methods=['GET'])
@_s.require_iam_token
def portal_conversation(conversation_id, **kwargs):
    """Return messages for a conversation the operator is assigned to."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Verify this operator is assigned (or is admin)
        if not (g.is_platform_admin or g.is_client_admin):
            cur.execute(
                "SELECT id FROM handoff_queue "
                "WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'",
                (conversation_id, op_id),
            )
            if not cur.fetchone():
                return jsonify({'error': 'Not assigned to this conversation'}), 403

        # Context & Info meta first — gives us queued_at to scope the transcript
        # to THIS handoff session (not the whole bot conversation history).
        meta = None
        queued_at = None
        try:
            cur.execute(
                """
                SELECT hq.id AS queue_id, hq.sender_id, hq.app_id, hq.priority,
                       hq.trigger_reason, hq.status, hq.queued_at, hq.assigned_at,
                       hq.user_org_id, hq.support_org_id, hq.product_id, hq.channel,
                       hq.context_package,
                       COALESCE(NULLIF(c.user_name, ''),
                                hq.context_package->'user_profile'->>'display_name') AS user_name,
                       EXTRACT(EPOCH FROM (NOW() - hq.queued_at))::INT AS waiting_secs
                FROM handoff_queue hq
                LEFT JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.conversation_id = %s
                ORDER BY hq.id DESC LIMIT 1
                """,
                (conversation_id,),
            )
            mrow = cur.fetchone()
            if mrow:
                m = dict(mrow)
                # queued_at is UTC-naive → put it on the messages' host-local basis
                queued_at = _utc_naive_to_local(m.get('queued_at'))
                ctx = m.pop('context_package', None) or {}
                m['ai_summary'] = ctx.get('ai_summary') if isinstance(ctx, dict) else None
                m['queued_at'] = queued_at.isoformat() if queued_at else None
                if m.get('assigned_at'):  # assigned_at is already host-local
                    m['assigned_at'] = m['assigned_at'].isoformat()
                meta = m
        except Exception:
            meta = None

        # Each conversation row is ONE chat session, so the operator sees the
        # FULL record (the whole bot conversation that led to the handoff), not
        # just the post-queue window.
        cur.execute(
            "SELECT sender, text, timestamp FROM messages "
            "WHERE conversation_id = %s ORDER BY timestamp ASC LIMIT 300",
            (conversation_id,),
        )
        msgs = []
        for m in cur.fetchall():
            d = dict(m)
            d['timestamp'] = d['timestamp'].isoformat() if d.get('timestamp') else None
            msgs.append(d)

        # Also pull operator messages from operator_messages — but ONLY legacy
        # rows that aren't already in `messages`. Operator sends now write to BOTH
        # tables, so merging blindly returned every operator message twice (the
        # duplicate-bubble bug). Dedup against operator rows already collected,
        # keyed by (text, second) — the two inserts share one request so their
        # timestamps match to the second; genuinely repeated texts are seconds
        # apart and survive.
        try:
            existing_op = {
                (m.get('text'), (m.get('timestamp') or '')[:19])
                for m in msgs if m.get('sender') == 'operator'
            }
            cur.execute(
                "SELECT 'operator' AS sender, message_text AS text, sent_at AS timestamp "
                "FROM operator_messages WHERE conversation_id = %s ORDER BY sent_at ASC",
                (conversation_id,),
            )
            for m in cur.fetchall():
                d = dict(m)
                d['timestamp'] = d['timestamp'].isoformat() if d.get('timestamp') else None
                if (d.get('text'), (d.get('timestamp') or '')[:19]) in existing_op:
                    continue  # already present from the messages table
                msgs.append(d)
            msgs.sort(key=lambda x: x.get('timestamp') or '')
        except Exception:
            pass  # operator_messages table may not exist in all envs

        return jsonify({'messages': msgs, 'meta': meta, 'conversation_id': conversation_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


@bp.route('/conversation/<int:conversation_id>/transcript', methods=['GET'])
@_s.require_iam_token
def portal_conversation_transcript(conversation_id, **kwargs):
    """Read-only transcript of a past session (Interaction History popup).

    Optional from_time / to_time (ISO) scope it to a single past handoff window.
    Operator role suffices — this is a read of an already-completed session,
    not an active claim.
    """
    from datetime import datetime as _dt
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    def _ts(s):
        if not s:
            return None
        try:
            return _dt.fromisoformat(s.replace('Z', '+00:00'))
        except Exception:
            return None

    ft = _ts(request.args.get('from_time'))
    tt = _ts(request.args.get('to_time'))

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        extra, params = "", [conversation_id]
        if ft:
            extra += " AND timestamp >= %s"; params.append(ft)
        if tt:
            extra += " AND timestamp <= %s"; params.append(tt)
        cur.execute(
            f"SELECT sender, text, timestamp FROM messages "
            f"WHERE conversation_id = %s{extra} ORDER BY timestamp ASC LIMIT 500",
            params,
        )
        msgs = []
        for m in cur.fetchall():
            d = dict(m)
            d['timestamp'] = d['timestamp'].isoformat() if d.get('timestamp') else None
            msgs.append(d)

        try:
            op_extra, op_params = "", [conversation_id]
            if ft:
                op_extra += " AND sent_at >= %s"; op_params.append(ft)
            if tt:
                op_extra += " AND sent_at <= %s"; op_params.append(tt)
            cur.execute(
                f"SELECT 'operator' AS sender, message_text AS text, sent_at AS timestamp "
                f"FROM operator_messages WHERE conversation_id = %s{op_extra} ORDER BY sent_at ASC",
                op_params,
            )
            for m in cur.fetchall():
                d = dict(m)
                d['timestamp'] = d['timestamp'].isoformat() if d.get('timestamp') else None
                msgs.append(d)
            msgs.sort(key=lambda x: x.get('timestamp') or '')
        except Exception:
            pass

        return jsonify({'messages': msgs, 'conversation_id': conversation_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Chat ─────────────────────────────────────────────────────────────────────

@bp.route('/chat/send', methods=['POST'])
@_s.require_iam_token
def portal_chat_send(**kwargs):
    """Send a message from the operator to the user."""
    from datetime import datetime as _dt
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    data            = request.get_json(silent=True) or {}
    conversation_id = data.get('conversation_id')
    text            = (data.get('text') or '').strip()
    if not conversation_id or not text:
        return jsonify({'error': 'conversation_id and text required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT id FROM handoff_queue "
            "WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'",
            (conversation_id, op_id),
        )
        q = cur.fetchone()
        if not q:
            return jsonify({'error': 'Not assigned to this conversation'}), 403

        now = _dt.now()
        cur.execute(
            "INSERT INTO messages (conversation_id, sender, text, timestamp) "
            "VALUES (%s, 'operator', %s, %s)",
            (conversation_id, text, now),
        )
        try:
            # Set sent_at to the SAME `now` as the messages-table row so the two
            # copies share an identical timestamp — portal_conversation dedups
            # operator messages by (text, second), so this keeps them collapsed.
            cur.execute(
                "INSERT INTO operator_messages (conversation_id, queue_id, operator_id, message_text, sent_at) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (conversation_id, q['id'], op_id, text, now),
            )
            msg_id = cur.fetchone()['id']
        except Exception:
            msg_id = None

        cur.execute(
            "SELECT sender_id FROM conversations WHERE id = %s", (conversation_id,)
        )
        cr = cur.fetchone()
        cur.execute(
            "UPDATE conversations SET last_activity = %s WHERE id = %s", (now, conversation_id)
        )
        conn.commit()

        if cr:
            ts = now.isoformat()
            _s.emit_to_user(cr['sender_id'], 'operator_message', {
                'conversation_id': conversation_id,
                'message_id':      msg_id,
                'sender_id':       cr['sender_id'],
                'text':            text,
                'timestamp':       ts,
            })
            _s.sio.emit('live_message', {
                'conversation_id': conversation_id,
                'sender':          'operator',
                'operator_id':     op_id,
                'text':            text,
                'timestamp':       ts,
            }, room=_s._room_admin_watch(conversation_id))

        return jsonify({'success': True, 'message_id': msg_id})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


# ── Operator: AI draft (Suggest reply) ────────────────────────────────────────

# ── Canned responses / macros (free co-pilot — saved replies, no LLM) ───────────

@bp.route('/canned', methods=['GET'])
@_s.require_iam_token
def portal_canned_list(**kwargs):
    try:
        return jsonify({'success': True, 'data': list_canned_responses(
            org_id=_s.caller_org_scope(), app_id=request.args.get('app_id') or None)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/canned', methods=['POST'])
@_s.require_iam_token
def portal_canned_create(**kwargs):
    try:
        item = create_canned_response(
            _s.caller_org_scope(), request.get_json(silent=True) or {},
            created_by=(g.iam_user or {}).get('sub', ''))
        return jsonify({'success': True, 'data': item}), 201
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/canned/<int:resp_id>', methods=['PUT'])
@_s.require_iam_token
def portal_canned_update(resp_id, **kwargs):
    try:
        ok = update_canned_response(resp_id, _s.caller_org_scope(), request.get_json(silent=True) or {})
        return jsonify({'success': ok}), (200 if ok else 404)
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/canned/<int:resp_id>', methods=['DELETE'])
@_s.require_iam_token
def portal_canned_delete(resp_id, **kwargs):
    try:
        ok = delete_canned_response(resp_id, _s.caller_org_scope())
        return jsonify({'success': ok}), (200 if ok else 404)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/ai-draft', methods=['POST'])
@_s.require_iam_token
def portal_ai_draft(**kwargs):
    """Generate a suggested reply by asking the bot the user's last message."""
    import requests as _req
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    data            = request.get_json(silent=True) or {}
    conversation_id = data.get('conversation_id')
    if not conversation_id:
        return jsonify({'error': 'conversation_id required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        if not (g.is_platform_admin or g.is_client_admin):
            cur.execute(
                "SELECT id FROM handoff_queue "
                "WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'",
                (conversation_id, op_id),
            )
            if not cur.fetchone():
                return jsonify({'error': 'Not assigned to this conversation'}), 403

        cur.execute(
            "SELECT m.text, c.sender_id FROM messages m "
            "JOIN conversations c ON c.id = m.conversation_id "
            "WHERE m.conversation_id = %s AND m.sender = 'user' "
            "ORDER BY m.timestamp DESC LIMIT 1",
            (conversation_id,),
        )
        row = cur.fetchone()
    finally:
        conn.rollback()
        _release_connection(conn)

    if not row or not row['text']:
        return jsonify({'draft': '', 'no_message': True})

    last_user_msg = row['text']
    sender_id     = row['sender_id']

    user_session_token = None
    try:
        tr = _req.get(f"{_s.RASA_URL}/conversations/{sender_id}/tracker", timeout=3)
        if tr.ok:
            td = tr.json()
            user_session_token = td.get('slots', {}).get('session_token')
            if not user_session_token:
                meta = (td.get('latest_message') or {}).get('metadata') or {}
                user_session_token = meta.get('session_token')
    except Exception:
        pass

    draft_sender = f"__draft__{conversation_id}"
    try:
        resp = _req.post(
            f"{_s.RASA_URL}/webhooks/rest/webhook",
            json={'sender': draft_sender, 'message': last_user_msg,
                  'metadata': {'session_token': user_session_token} if user_session_token else {}},
            timeout=8,
        )
        resp.raise_for_status()
        _skip = ("I'm not sure I understand", "I didn't quite get that", "Login Required",
                 "🔐", "please login", "log in", "To perform ticket")
        filtered = []
        for r in resp.json():
            txt = (r.get('text') or '').strip()
            if not txt or any(s.lower() in txt.lower() for s in _skip):
                continue
            filtered.append(txt)
        draft_text = ' '.join(filtered).strip()
    except Exception:
        draft_text = ''

    return jsonify({'draft': draft_text, 'source_message': last_user_msg})


# ── Operator: user interaction history ─────────────────────────────────────────

@bp.route('/user-history/<path:sender_id>', methods=['GET'])
@_s.require_iam_token
def portal_user_history(sender_id, **kwargs):
    """Past handoff sessions for this user (Interaction History panel)."""
    import re
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    limit = min(int(request.args.get('limit', 11)), 25)

    parts = sender_id.split('-')
    if len(parts) >= 3 and parts[0] == 'user':
        app_id_part = parts[1]
        remaining   = parts[2:]
        if len(remaining) > 1 and re.match(r'^[0-9a-z]{6,12}$', remaining[-1]):
            username_parts = remaining[:-1]
        else:
            username_parts = remaining
        sender_pattern = f"user-{app_id_part}-{'-'.join(username_parts)}%"
        use_pattern    = True
    else:
        sender_pattern = sender_id
        use_pattern    = False

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        where_clause = "c.sender_id LIKE %s" if use_pattern else "c.sender_id = %s"
        cur.execute(
            f"""
            SELECT hq.id AS queue_id, hq.conversation_id, hq.status AS handoff_status,
                   hq.queued_at, hq.resolved_at, hq.abandoned_at, hq.trigger_reason,
                   hq.closing_note, c.app_id, c.sender_id,
                   (SELECT text FROM messages
                     WHERE conversation_id = c.id AND sender = 'user'
                       AND timestamp >= hq.queued_at
                     ORDER BY timestamp ASC LIMIT 1) AS first_user_msg
            FROM handoff_queue hq
            JOIN conversations c ON c.id = hq.conversation_id
            WHERE {where_clause}
            ORDER BY hq.queued_at DESC NULLS LAST
            LIMIT %s
            """,
            (sender_pattern, limit),
        )
        rows = cur.fetchall()
    finally:
        conn.rollback()
        _release_connection(conn)

    history = []
    for r in rows:
        # queued_at/resolved_at are UTC-naive → normalize to host-local so the
        # operator sees the same wall-clock as the chat transcript.
        qa = _utc_naive_to_local(r['queued_at'])
        ra = _utc_naive_to_local(r['resolved_at'])
        history.append({
            'queue_id':        r['queue_id'],
            'conversation_id': r['conversation_id'],
            'app_id':          r['app_id'] or 'General',
            'handoff_status':  r['handoff_status'],
            'queued_at':       qa.isoformat() if qa else None,
            'resolved_at':     ra.isoformat() if ra else None,
            'trigger_reason':  r['trigger_reason'],
            'closing_note':    r['closing_note'],
            'first_user_msg':  (r['first_user_msg'] or '')[:120],
        })
    return jsonify({'history': history, 'count': len(history)})


# ── Operator: transfer ─────────────────────────────────────────────────────────

@bp.route('/operators/online', methods=['GET'])
@_s.require_iam_token
def portal_operators_online(**kwargs):
    """Online operators (excluding self) for the transfer picker."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, display_name, status,
                   (SELECT COUNT(*) FROM handoff_queue hq
                    WHERE hq.operator_id = o.id AND hq.status = 'assigned') AS current_load,
                   max_concurrent
            FROM operators o
            WHERE is_active = TRUE AND status != 'offline'
              AND (last_seen IS NULL OR EXTRACT(EPOCH FROM (NOW() - last_seen)) < 300)
              AND id != %s
            ORDER BY display_name
            """,
            (op_id,),
        )
        ops = [dict(r) for r in cur.fetchall()]
        for o in ops:
            if o.get('last_seen'):
                o['last_seen'] = o['last_seen'].isoformat()
        return jsonify({'operators': ops})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


@bp.route('/queue/transfer', methods=['POST'])
@_s.require_iam_token
def portal_queue_transfer(**kwargs):
    """Transfer an assigned session to another online operator."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )

    data            = request.get_json(silent=True) or {}
    conversation_id = data.get('conversation_id')
    target_op_id    = data.get('target_operator_id')
    if not conversation_id or not target_op_id:
        return jsonify({'error': 'conversation_id and target_operator_id required'}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Reassign directly (portal transfer is immediate, not request/accept).
        cur.execute(
            """
            UPDATE handoff_queue
               SET operator_id = %s, assigned_at = NOW()
             WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'
            RETURNING id AS queue_id, conversation_id, sender_id
            """,
            (target_op_id, conversation_id, op_id),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Not found or not assigned to you'}), 409
        cur.execute(
            "UPDATE conversations SET assigned_operator_id = %s WHERE id = %s",
            (target_op_id, conversation_id),
        )
        cur.execute(
            "INSERT INTO handoff_state_log "
            "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
            "VALUES (%s, 'assigned', 'assigned', 'operator', %s, %s)",
            (conversation_id, str(op_id), f'Transferred from operator {op_id}'),
        )
        cur.execute("SELECT display_name FROM operators WHERE id = %s", (target_op_id,))
        tgt = cur.fetchone()
        conn.commit()

        target_name = (tgt or {}).get('display_name', 'an agent')
        _s.emit_to_operator(target_op_id, 'session_assigned', {
            'conversation_id': row['conversation_id'], 'queue_id': row['queue_id'],
            'sender_id': row['sender_id'],
        })
        _s.emit_to_user(row['sender_id'], 'handoff_assigned', {
            'conversation_id': row['conversation_id'],
            'operator_name': target_name,
            'message': f'✅ You have been transferred to {target_name}.',
        })
        _s.sio.emit('queue_item_updated',
                    {'queue_id': row['queue_id'], 'status': 'assigned'}, room='queue_overview')
        _s.emit_queue_overview()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


# ── Operator: presence heartbeat ───────────────────────────────────────────────

@bp.route('/heartbeat', methods=['POST'])
@_s.require_iam_token
def portal_heartbeat(**kwargs):
    """Keep the calling operator's last_seen fresh so they stay routable."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # Refresh presence and reconcile status: stay 'away' if the operator
        # chose it; otherwise 'busy' when at max concurrent load, else 'available'.
        cur.execute(
            """
            UPDATE operators o SET last_seen = NOW(),
              status = CASE
                WHEN o.status = 'away' THEN 'away'
                WHEN (SELECT COUNT(*) FROM handoff_queue hq
                      WHERE hq.operator_id = o.id AND hq.status = 'assigned')
                     >= o.max_concurrent THEN 'busy'
                ELSE 'available' END
            WHERE o.id = %s
            RETURNING status, max_concurrent,
              (SELECT COUNT(*) FROM handoff_queue hq
               WHERE hq.operator_id = o.id AND hq.status = 'assigned') AS current_load
            """,
            (op_id,),
        )
        row = cur.fetchone() or {}
        conn.commit()
        return jsonify({'success': True, 'op_id': op_id,
                        'status': row.get('status', 'available'),
                        'current_load': row.get('current_load', 0),
                        'max_concurrent': row.get('max_concurrent', 3)})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


@bp.route('/status', methods=['POST'])
@_s.require_iam_token
def portal_set_status(**kwargs):
    """Operator toggles Available / Away (Away takes them out of routing)."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user  = g.iam_user
    op_id = _get_or_create_portal_operator(
        iam_sub=user.get('sub', ''), name=user.get('name', ''),
        email=user.get('email', ''), org_id=user.get('org_id', ''),
    )
    data    = request.get_json(silent=True) or {}
    desired = (data.get('status') or '').strip().lower()
    if desired not in ('available', 'away'):
        return jsonify({'error': "status must be 'available' or 'away'"}), 400

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        # When going available, auto-promote to 'busy' if already at capacity.
        cur.execute(
            """
            UPDATE operators o SET last_seen = NOW(),
              status = CASE
                WHEN %s = 'away' THEN 'away'
                WHEN (SELECT COUNT(*) FROM handoff_queue hq
                      WHERE hq.operator_id = o.id AND hq.status = 'assigned')
                     >= o.max_concurrent THEN 'busy'
                ELSE 'available' END
            WHERE o.id = %s
            RETURNING status
            """,
            (desired, op_id),
        )
        row = cur.fetchone() or {}
        conn.commit()
        return jsonify({'success': True, 'status': row.get('status', desired)})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        _release_connection(conn)


# ── Stats (admin) ─────────────────────────────────────────────────────────────

@bp.route('/stats', methods=['GET'])
@_s.require_iam_token
def portal_stats(**kwargs):
    """Queue + operator stats. Platform admins see per-org breakdown."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user = g.iam_user
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        scope_sql, scope_params = _s.get_operator_queue_filter()
        cur.execute(
            f"SELECT status, COUNT(*) AS cnt FROM handoff_queue "
            f"WHERE status IN ('waiting','assigned') AND {scope_sql} GROUP BY status",
            scope_params,
        )
        counts = {r['status']: r['cnt'] for r in cur.fetchall()}

        cur.execute(
            "SELECT COUNT(*) AS cnt FROM operators "
            "WHERE last_seen > NOW() - INTERVAL '5 minutes'"
        )
        ops_online = cur.fetchone()['cnt']

        cur.execute(
            "SELECT COUNT(*) AS cnt FROM handoff_queue "
            "WHERE status = 'resolved' AND resolved_at::date = CURRENT_DATE"
        )
        resolved = cur.fetchone()['cnt']

        stats = {
            'waiting_count':   counts.get('waiting', 0),
            'assigned_count':  counts.get('assigned', 0),
            'operators_online': ops_online,
            'resolved_today':  resolved,
        }

        if user.get('is_platform_admin'):
            cur.execute(
                """
                SELECT hq.user_org_id AS org_id,
                       COUNT(*) FILTER (WHERE hq.status = 'waiting')  AS waiting,
                       COUNT(*) FILTER (WHERE hq.status = 'assigned') AS assigned
                FROM handoff_queue hq
                WHERE hq.status IN ('waiting','assigned')
                GROUP BY hq.user_org_id
                ORDER BY waiting DESC
                LIMIT 20
                """
            )
            stats['orgs'] = [dict(r) for r in cur.fetchall()]

        return jsonify(stats)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Admin: Analytics ──────────────────────────────────────────────────────────

@bp.route('/admin/analytics', methods=['GET'])
@_s.require_iam_token
def portal_admin_analytics(**kwargs):
    """Daily time-series stats for the past N days (default 7)."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    days = min(int(request.args.get('days', 7)), 90)
    # Tenant isolation: a tenant admin only sees their org's figures; platform
    # admins (scope_org None) see all. handoff_queue→user_org_id, conversations→
    # org_id, messages (no org column)→scoped via conversations join.
    scope_org = _s.caller_org_scope()
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # Handoffs per day
        cur.execute(
            """
            SELECT queued_at::date AS day,
                   COUNT(*) AS handoffs,
                   COUNT(*) FILTER (WHERE status = 'resolved')  AS resolved,
                   COUNT(*) FILTER (WHERE status = 'abandoned') AS abandoned,
                   -- Only average real, completed handles: resolved with a positive
                   -- duration. Abandoned rows carry bogus/negative handle_time_secs
                   -- (legacy tz artifacts) that otherwise skew this to nonsense.
                   ROUND(AVG(handle_time_secs) FILTER (WHERE status = 'resolved' AND handle_time_secs > 0))::INT AS avg_handle_secs
            FROM handoff_queue
            WHERE queued_at >= CURRENT_DATE - (%s || ' days')::INTERVAL
              AND (%s IS NULL OR user_org_id = %s)
            GROUP BY 1 ORDER BY 1 ASC
            """,
            (days, scope_org, scope_org),
        )
        handoff_rows = [dict(r) for r in cur.fetchall()]
        for r in handoff_rows:
            r['day'] = r['day'].isoformat() if r.get('day') else None

        # Conversations started per day
        cur.execute(
            """
            SELECT started_at::date AS day, COUNT(*) AS conversations
            FROM conversations
            WHERE started_at >= CURRENT_DATE - (%s || ' days')::INTERVAL
              AND (%s IS NULL OR org_id = %s)
            GROUP BY 1 ORDER BY 1 ASC
            """,
            (days, scope_org, scope_org),
        )
        conv_rows = [{'day': r['day'].isoformat() if r.get('day') else None,
                      'conversations': r['conversations']}
                     for r in cur.fetchall()]

        # Messages per day (messages have no org column → scope via conversations)
        cur.execute(
            """
            SELECT m.timestamp::date AS day, COUNT(*) AS messages
            FROM messages m
            LEFT JOIN conversations c ON c.id = m.conversation_id
            WHERE m.timestamp >= CURRENT_DATE - (%s || ' days')::INTERVAL
              AND (%s IS NULL OR c.org_id = %s)
            GROUP BY 1 ORDER BY 1 ASC
            """,
            (days, scope_org, scope_org),
        )
        msg_rows = [{'day': r['day'].isoformat() if r.get('day') else None,
                     'messages': r['messages']}
                    for r in cur.fetchall()]

        return jsonify({
            'days':          days,
            'handoffs':      handoff_rows,
            'conversations': conv_rows,
            'messages':      msg_rows,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Admin: Operators ──────────────────────────────────────────────────────────

@bp.route('/admin/operators', methods=['GET'])
@_s.require_iam_token
def portal_admin_operators(**kwargs):
    """List operators scoped to the caller's visibility."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    # Tenant admins → own org; super admin → all, or one tenant via the switcher
    # (X-Org-Id). NULL scope = all tenants.
    scope_org = _s.caller_org_scope()
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, username, display_name, email, org_id, channel,
                   status, max_concurrent, last_seen,
                   (SELECT COUNT(*) FROM handoff_queue hq
                    WHERE hq.operator_id = operators.id AND hq.status = 'assigned') AS active_sessions
            FROM operators
            WHERE is_active = TRUE AND (%s IS NULL OR org_id = %s)
            ORDER BY status ASC, display_name ASC
            """,
            (scope_org, scope_org),
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get('last_seen'):
                d['last_seen'] = d['last_seen'].isoformat()
            rows.append(d)
        return jsonify({'operators': rows, 'count': len(rows)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Admin: whoami (authoritative platform/role flags for frontend gating) ──────

@bp.route('/admin/whoami', methods=['GET'])
@_s.require_iam_token
def portal_whoami(**kwargs):
    """Authoritative identity/role flags. The frontend can't compute
    is_platform_admin itself (it doesn't know the platform org id), so it asks
    here — this is how an org_admin of the PLATFORM org gets the super-admin UI."""
    u = g.iam_user or {}
    return jsonify({
        'email':            u.get('email'),
        'org_id':           u.get('org_id'),
        'org_name':         u.get('org_name'),
        'is_platform_admin': bool(u.get('is_platform_admin')),
        'is_super_admin':    bool(u.get('is_super_admin')),
        'is_client_admin':   bool(u.get('is_client_admin')),
        'is_org_admin':      bool(u.get('is_org_admin')),
        'is_operator':       bool(u.get('is_operator')),
    })


# ── Admin: IAM org directory (super-admin tenant switcher) ─────────────────────

@bp.route('/admin/iam-orgs', methods=['GET'])
@_s.require_iam_token
def portal_admin_iam_orgs(**kwargs):
    """All IAM organizations (id + name) for the super-admin tenant switcher.
    Only platform admins may switch tenants; tenant admins get an empty list."""
    user = g.iam_user
    if not user.get('is_platform_admin'):
        return jsonify({'orgs': []})
    # Cache the IAM org directory (changes rarely) so this isn't a blocking IAM
    # HTTP call on every admin page load — under eventlet that stalls the server.
    import time as _t
    global _IAM_ORGS_CACHE
    now = _t.time()
    cached = globals().get('_IAM_ORGS_CACHE')
    if cached and (now - cached[0] < 300):
        return jsonify({'orgs': cached[1]})
    from common.iam_service import _iam_admin
    try:
        orgs = _iam_admin('GET', '/organizations', params={'max': 500}) or []
        rows = [{'org_id': o.get('id'),
                 'name': o.get('name') or o.get('alias') or o.get('id'),
                 'alias': o.get('alias')}
                for o in (orgs if isinstance(orgs, list) else []) if o.get('id')]
        rows.sort(key=lambda r: (r['name'] or '').lower())
        _IAM_ORGS_CACHE = (now, rows)
        return jsonify({'orgs': rows})
    except Exception as e:
        return jsonify({'orgs': (cached[1] if cached else []), 'error': str(e)})


# ── Admin: Orgs ───────────────────────────────────────────────────────────────

def _iam_org_name_map():
    """Return {org_id: name} from the cached IAM org directory (best-effort)."""
    import time as _t
    global _IAM_ORGS_CACHE
    now = _t.time()
    cached = globals().get('_IAM_ORGS_CACHE')
    if not (cached and (now - cached[0] < 300)):
        try:
            from common.iam_service import _iam_admin
            orgs = _iam_admin('GET', '/organizations', params={'max': 500}) or []
            rows = [{'org_id': o.get('id'),
                     'name': o.get('name') or o.get('alias') or o.get('id'),
                     'alias': o.get('alias')}
                    for o in (orgs if isinstance(orgs, list) else []) if o.get('id')]
            _IAM_ORGS_CACHE = (now, rows)
            cached = _IAM_ORGS_CACHE
        except Exception:
            pass
    return {r['org_id']: r['name'] for r in (cached[1] if cached else [])}


@bp.route('/admin/orgs', methods=['GET'])
@_s.require_iam_token
def portal_admin_orgs(**kwargs):
    """List known orgs derived from handoff_queue data. super_admin sees all."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user = g.iam_user
    if not (user.get('is_platform_admin') or user.get('is_client_admin')):
        return jsonify({'error': 'Forbidden'}), 403

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        if user.get('is_platform_admin'):
            cur.execute(
                """
                SELECT user_org_id AS org_id,
                       COUNT(*) FILTER (WHERE status = 'waiting')  AS waiting,
                       COUNT(*) FILTER (WHERE status = 'assigned') AS assigned,
                       COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_total,
                       COUNT(*) FILTER (WHERE status = 'resolved'
                           AND resolved_at >= NOW() - INTERVAL '7 days') AS resolved_7d,
                       MAX(queued_at) AS last_activity
                FROM handoff_queue
                WHERE user_org_id IS NOT NULL AND user_org_id != ''
                GROUP BY user_org_id
                ORDER BY last_activity DESC NULLS LAST
                LIMIT 100
                """
            )
        else:
            org_id = user.get('org_id', '')
            cur.execute(
                """
                SELECT user_org_id AS org_id,
                       COUNT(*) FILTER (WHERE status = 'waiting')  AS waiting,
                       COUNT(*) FILTER (WHERE status = 'assigned') AS assigned,
                       COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_total,
                       COUNT(*) FILTER (WHERE status = 'resolved'
                           AND resolved_at >= NOW() - INTERVAL '7 days') AS resolved_7d,
                       MAX(queued_at) AS last_activity
                FROM handoff_queue
                WHERE user_org_id = %s
                GROUP BY user_org_id
                """,
                (org_id,),
            )
        name_map = _iam_org_name_map()
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get('last_activity'):
                d['last_activity'] = d['last_activity'].isoformat()
            d['org_name'] = name_map.get(d.get('org_id'), '')
            rows.append(d)
        return jsonify({'orgs': rows, 'count': len(rows)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Admin: History ────────────────────────────────────────────────────────────

@bp.route('/admin/history', methods=['GET'])
@_s.require_iam_token
def portal_admin_history(**kwargs):
    """Paginated resolved/abandoned conversation history."""
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor

    user   = g.iam_user
    page   = max(1, int(request.args.get('page', 1)))
    limit  = min(50, int(request.args.get('limit', 20)))
    offset = (page - 1) * limit
    q      = (request.args.get('q') or '').strip()

    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)

        scope_sql, scope_params = _s.get_operator_queue_filter()
        # Override scope for history to target any completed status
        search_clause = ""
        all_params = dict(scope_params)
        if q:
            search_clause = " AND (hq.sender_id ILIKE %(q_like)s OR hq.user_org_id ILIKE %(q_like)s)"
            all_params['q_like'] = f'%{q}%'
        all_params['limit_val']  = limit
        all_params['offset_val'] = offset

        cur.execute(
            f"""
            SELECT hq.id AS queue_id, hq.sender_id, hq.app_id, hq.status,
                   hq.priority, hq.trigger_reason, hq.user_org_id,
                   hq.product_id, hq.channel, hq.queued_at, hq.assigned_at,
                   hq.resolved_at, hq.handle_time_secs, hq.closing_note,
                   hq.conversation_id,
                   o.display_name AS operator_name
            FROM handoff_queue hq
            LEFT JOIN operators o ON o.id = hq.operator_id
            WHERE hq.status IN ('resolved', 'abandoned')
              AND {scope_sql}
              {search_clause}
            ORDER BY COALESCE(hq.resolved_at, hq.queued_at) DESC
            LIMIT %(limit_val)s OFFSET %(offset_val)s
            """,
            all_params,
        )
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            for k in ('queued_at', 'assigned_at', 'resolved_at'):
                if d.get(k):
                    d[k] = d[k].isoformat()
            rows.append(d)

        count_params = {k: v for k, v in all_params.items()
                        if k not in ('limit_val', 'offset_val')}
        cur.execute(
            f"SELECT COUNT(*) AS cnt FROM handoff_queue hq "
            f"WHERE hq.status IN ('resolved','abandoned') AND {scope_sql} {search_clause}",
            count_params,
        )
        total = cur.fetchone()['cnt']

        return jsonify({
            'items':  rows,
            'total':  total,
            'page':   page,
            'limit':  limit,
            'pages':  (total + limit - 1) // limit,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


# ── Admin: User management (IAM) ─────────────────────────────────────────────

# Assignable project-iq client roles. User/Bot grant chatbot access (see the
# chatbot access gate); Member/Operator/Admin are the portal/ITSM roles.
ALLOWED_CLIENT_ROLES = {'User', 'Bot', 'Operator', 'Admin'}


def _check_admin_or_403():
    """Return iam_user if caller is admin, else abort with 403."""
    from flask import g
    user = g.iam_user
    if not (user.get('is_platform_admin') or user.get('is_client_admin')):
        return None, (jsonify({'error': 'Forbidden'}), 403)
    return user, None


@bp.route('/admin/users', methods=['GET'])
@_s.require_iam_token
def portal_admin_users_list(**kwargs):
    """List the caller's org members with their project-iq client roles + status.

    Uses the backend service account against the Keycloak Admin API (org members
    + per-user client role mappings), so role names and real account status
    (enabled / email-verified) come straight from IAM.
    """
    from common.iam_service import iam_list_org_users, iam_get_user_client_roles, IamTokenError

    user, err = _check_admin_or_403()
    if err:
        return err

    # Super admin may target a tenant via the switcher (?org_id= or X-Org-Id);
    # with no selection they see their own (platform) org. Tenant admins are
    # ALWAYS locked to their own org — the override is ignored (no cross-tenant peek).
    override = request.args.get('org_id') or request.headers.get('X-Org-Id') or ''
    if user.get('is_platform_admin'):
        org_id = override or user.get('org_id', '')
    else:
        org_id = user.get('org_id', '')
    if not org_id:
        return jsonify({'error': 'org_id required (or authenticate as org member)'}), 400

    try:
        members = iam_list_org_users(org_id)
    except IamTokenError as e:
        return jsonify({'error': str(e)}), 502

    result = []
    for m in members:
        sub = m.get('id', '')
        try:
            client_roles = iam_get_user_client_roles(sub)
        except Exception:
            client_roles = []
        result.append({
            'sub':            sub,
            'email':          m.get('email', ''),
            'first_name':     m.get('firstName', ''),
            'last_name':      m.get('lastName', ''),
            'username':       m.get('username', ''),
            'enabled':        m.get('enabled', True),
            'email_verified': m.get('emailVerified', False),
            'client_roles':   client_roles,
        })

    return jsonify({'users': result, 'count': len(result), 'org_id': org_id})


@bp.route('/admin/users/invite', methods=['POST'])
@_s.require_iam_token
def portal_admin_users_invite(**kwargs):
    """Invite a new user to the org via Keycloak (creates account + sends email)."""
    from common.iam_service import iam_invite_user, IamTokenError

    user, err = _check_admin_or_403()
    if err:
        return err

    data       = request.get_json(silent=True) or {}
    email      = (data.get('email') or '').strip().lower()
    first_name = (data.get('first_name') or data.get('firstName') or '').strip()
    last_name  = (data.get('last_name')  or data.get('lastName')  or '').strip()
    roles      = [r for r in (data.get('roles') or ['User']) if r in ALLOWED_CLIENT_ROLES]
    org_id     = data.get('org_id') or user.get('org_id', '')

    if not email:
        return jsonify({'error': 'email required'}), 400
    if not roles:
        roles = ['User']
    # Client admin can only invite into their own org
    if not user.get('is_platform_admin'):
        org_id = user.get('org_id', '')

    try:
        sub = iam_invite_user(email=email, first_name=first_name, last_name=last_name,
                              org_id=org_id, roles=roles)
        return jsonify({'success': True, 'sub': sub, 'email': email})
    except IamTokenError as e:
        status = 409 if 'already exists' in str(e) else 502
        return jsonify({'error': str(e)}), status


@bp.route('/admin/users/<sub>/roles', methods=['PATCH'])
@_s.require_iam_token
def portal_admin_users_set_roles(sub, **kwargs):
    """Replace a user's client roles with the supplied list."""
    from common.iam_service import iam_set_client_roles, IamTokenError

    user, err = _check_admin_or_403()
    if err:
        return err

    data  = request.get_json(silent=True) or {}
    roles = [r for r in (data.get('roles') or []) if r in ALLOWED_CLIENT_ROLES]
    if not roles:
        return jsonify({'error': f'roles required; allowed: {sorted(ALLOWED_CLIENT_ROLES)}'}), 400

    # Prevent client admin from assigning Admin to themselves
    if not user.get('is_platform_admin') and 'Admin' in roles:
        return jsonify({'error': 'Client admins cannot grant the Admin role'}), 403

    try:
        iam_set_client_roles(sub, roles)
        return jsonify({'success': True, 'sub': sub, 'roles': roles})
    except IamTokenError as e:
        return jsonify({'error': str(e)}), 502


@bp.route('/admin/users/<sub>', methods=['DELETE'])
@_s.require_iam_token
def portal_admin_users_delete(sub, **kwargs):
    """Permanently delete a user from Keycloak."""
    from common.iam_service import iam_delete_user, IamTokenError

    user, err = _check_admin_or_403()
    if err:
        return err

    # Prevent self-deletion
    if sub == user.get('sub', ''):
        return jsonify({'error': 'Cannot delete your own account'}), 400

    try:
        iam_delete_user(sub)
        return jsonify({'success': True, 'sub': sub})
    except IamTokenError as e:
        return jsonify({'error': str(e)}), 502
