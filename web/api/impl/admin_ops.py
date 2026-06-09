"""
Admin operations implementations.

Covers: operator CRUD, handoff config, routing rules,
        force handoff, analytics, and queue monitor.
"""
from flask import request, jsonify

import web.api.shared as _s
from web.api.shared import hash_password, emit_queue_overview
from web.api.impl.operator import (
    get_handoff_runtime_config_for_api,
    _apply_routing_rules,
    _build_context_package,
)
from common.conversation_db import _get_connection, _release_connection


# ── Operator CRUD ──────────────────────────────────────────────────────────────

def list_operators():
    try:
        from common.conversation_db import get_operators, get_operator_current_load
        include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
        ops = get_operators(include_inactive=include_inactive)
        for op in ops:
            op['current_load'] = get_operator_current_load(op['id'])
        return jsonify({'success': True, 'operators': ops, 'count': len(ops)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def create_operator_endpoint():
    try:
        from common.conversation_db import create_operator
        data = request.get_json(silent=True) or {}
        username     = (data.get('username') or '').strip().lower()
        display_name = (data.get('display_name') or '').strip()
        password     = data.get('password') or ''
        if not username or not display_name:
            return jsonify({'error': 'username and display_name are required'}), 400
        if password and len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400

        new_id = create_operator(
            username=username,
            display_name=display_name,
            password_hash=hash_password(password) if password else 'iam-managed',
            email=data.get('email'),
            team=data.get('team'),
            app_ids=data.get('app_ids', []),
            max_concurrent=data.get('max_concurrent'),
            shift_schedule=data.get('shift_schedule'),
            iam_sub=data.get('iam_sub'),
        )
        if data.get('is_admin'):
            from common.conversation_db import update_operator
            update_operator(new_id, is_admin=True)
        return jsonify({'success': True, 'operator_id': new_id}), 201
    except Exception as e:
        if 'unique' in str(e).lower():
            return jsonify({'error': 'Username already exists'}), 409
        return jsonify({'error': str(e)}), 500


def get_operator_endpoint(operator_id):
    try:
        from common.conversation_db import get_operator, get_operator_current_load, get_operator_stats
        op = get_operator(operator_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        op['current_load'] = get_operator_current_load(operator_id)
        op['stats'] = get_operator_stats(operator_id)
        return jsonify({'success': True, 'operator': op})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_operator_endpoint(operator_id):
    try:
        from common.conversation_db import update_operator, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        data = request.get_json(silent=True) or {}
        updates = {}
        for field in ('display_name', 'email', 'team', 'app_ids',
                      'max_concurrent', 'shift_schedule', 'is_active', 'is_admin'):
            if field in data:
                updates[field] = data[field]
        if 'new_password' in data:
            if len(data['new_password']) < 8:
                return jsonify({'error': 'Password must be at least 8 characters'}), 400
            updates['password_hash'] = hash_password(data['new_password'])
        if not updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        update_operator(operator_id, **updates)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def delete_operator_endpoint(operator_id):
    try:
        from common.conversation_db import update_operator, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        update_operator(operator_id, is_active=False, status='offline')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def operator_stats_endpoint(operator_id):
    try:
        from common.conversation_db import get_operator_stats, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        stats = get_operator_stats(operator_id)
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Handoff config ─────────────────────────────────────────────────────────────

def get_handoff_config_endpoint():
    try:
        cfg = get_handoff_runtime_config_for_api()
        return jsonify({'success': True, 'config': cfg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_handoff_config_endpoint():
    try:
        from common.conversation_db import (
            get_handoff_runtime_config, set_handoff_runtime_config, _deep_merge
        )
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'JSON body required'}), 400
        current = get_handoff_runtime_config()
        merged  = _deep_merge(current, data)
        set_handoff_runtime_config(merged)
        from common.redis_cache import invalidate_handoff_config as _ihc
        from common.ttl_cache import handoff_config_cache as _hcc
        _ihc(); _hcc.delete('cfg')
        return jsonify({'success': True, 'config': merged})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Routing rules ──────────────────────────────────────────────────────────────

def get_routing_rules():
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT * FROM handoff_routing_rules ORDER BY sort_order ASC, created_at ASC"
            )
            rules = [dict(r) for r in cursor.fetchall()]
            for r in rules:
                if r.get('created_at'):
                    r['created_at'] = r['created_at'].isoformat()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'rules': rules, 'count': len(rules)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def create_routing_rule():
    try:
        data = request.get_json(silent=True) or {}
        rule_name   = (data.get('rule_name') or '').strip()
        match_type  = data.get('match_type', '')
        match_value = (data.get('match_value') or '').strip()
        if not rule_name or not match_type or not match_value:
            return jsonify({'error': 'rule_name, match_type, and match_value are required'}), 400
        if match_type not in ('intent', 'keyword', 'app_id', 'entity'):
            return jsonify({"error": "match_type must be intent, keyword, app_id, or entity"}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "INSERT INTO handoff_routing_rules "
                "(rule_name, match_type, match_value, target_team, required_skill, "
                "priority_boost, sort_order) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    rule_name, match_type, match_value,
                    data.get('target_team'), data.get('required_skill'),
                    data.get('priority_boost', 0), data.get('sort_order', 99)
                )
            )
            new_id = cursor.fetchone()['id']
            conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'rule_id': new_id}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_routing_rule(rule_id):
    try:
        data = request.get_json(silent=True) or {}
        allowed = ('rule_name', 'match_type', 'match_value', 'target_team',
                   'required_skill', 'priority_boost', 'sort_order', 'is_active')
        updates = {k: data[k] for k in allowed if k in data}
        if not updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            set_parts = ', '.join(f"{k} = %s" for k in updates)
            params = list(updates.values()) + [rule_id]
            cursor.execute(
                f"UPDATE handoff_routing_rules SET {set_parts} WHERE id = %s", params
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Rule not found'}), 404
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def delete_routing_rule(rule_id):
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM handoff_routing_rules WHERE id = %s", (rule_id,)
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Rule not found'}), 404
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def test_routing_rule():
    try:
        data = request.get_json(silent=True) or {}
        app_id  = data.get('app_id', 'General')
        message = data.get('message', '')
        intent  = data.get('intent', '')
        trigger_detail = {'last_message': message, 'intent': intent}
        target_team, required_skill, priority_boost = _apply_routing_rules(app_id, trigger_detail)
        return jsonify({
            'success': True,
            'result': {
                'target_team':    target_team or '(default pool)',
                'required_skill': required_skill,
                'priority_boost': priority_boost,
                'final_priority': min(9, 5 + priority_boost)
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Force handoff ──────────────────────────────────────────────────────────────

def admin_force_handoff():
    try:
        from common.conversation_db import enqueue_handoff, log_handoff_consent
        data         = request.get_json(silent=True) or {}
        sender_id    = data.get('sender_id')
        priority     = data.get('priority', 7)
        reason_note  = data.get('reason', 'Admin escalation')
        skip_consent = data.get('skip_consent', False)
        app_id       = data.get('app_id', 'General')

        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id, handoff_state FROM conversations WHERE sender_id = %s",
                (sender_id,)
            )
            row = cursor.fetchone()
        finally:
            conn.rollback()
            _release_connection(conn)

        if not row:
            return jsonify({'error': 'Conversation not found'}), 404
        if row['handoff_state'] in ('queued', 'assigned'):
            return jsonify({'error': 'Conversation is already in handoff'}), 409

        conversation_id = row['id']
        if skip_consent:
            log_handoff_consent(sender_id, conversation_id, True, None)

        context_package = _build_context_package(
            sender_id, conversation_id, 'admin_forced',
            {'reason': reason_note, 'admin': data.get('admin_username', 'admin')}
        )
        target_team, required_skill, _ = _apply_routing_rules(app_id, {})
        entry = enqueue_handoff(
            conversation_id=conversation_id,
            sender_id=sender_id,
            app_id=app_id,
            trigger_reason='admin_forced',
            trigger_detail={'reason': reason_note},
            priority=min(9, priority),
            context_package=context_package,
            target_team=data.get('target_team') or target_team,
            required_skill=data.get('required_skill') or required_skill
        )
        if not entry:
            return jsonify({'error': 'Queue is full or enqueue failed'}), 503

        try:
            _s.sio.emit('new_queue_item', {
                'queue_id':       entry['id'],
                'queue_position': entry.get('queue_position', 1),
                'app_id':         app_id,
                'trigger_reason': 'admin_forced',
                'queued_at':      entry.get('queued_at', ''),
            }, room='queue_overview')
            emit_queue_overview()
            _s.sio.emit('conversation_state_change', {
                'sender_id':  sender_id,
                'from_state': 'bot_active',
                'to_state':   'queued',
                'triggered_by': 'admin',
            }, room='admin_live')
        except Exception as _afe:
            print(f"[SIO admin_force] notify error (non-fatal): {_afe}")

        return jsonify({'success': True, 'queue_id': entry['id'],
                        'position': entry.get('queue_position', 1)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Handoff analytics ──────────────────────────────────────────────────────────

def handoff_analytics():
    try:
        from psycopg2.extras import RealDictCursor
        days   = min(int(request.args.get('days', 7)), 90)
        app_id = request.args.get('app_id') or None

        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            app_filter  = "AND c.app_id = %s" if app_id else ""
            params_base = [days, app_id] if app_id else [days]

            cur.execute(f"""
                SELECT
                    COUNT(*)                                                  AS total_handoffs,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')           AS resolved,
                    COUNT(*) FILTER (WHERE hq.status = 'abandoned')          AS abandoned,
                    ROUND(AVG(hq.wait_time_secs)   FILTER (WHERE hq.wait_time_secs   IS NOT NULL) / 60.0, 1) AS avg_wait_mins,
                    ROUND(AVG(hq.handle_time_secs) FILTER (WHERE hq.handle_time_secs IS NOT NULL) / 60.0, 1) AS avg_handle_mins,
                    ROUND(AVG(hq.agent_rating)     FILTER (WHERE hq.agent_rating      IS NOT NULL), 2)       AS avg_csat,
                    COUNT(*) FILTER (WHERE hq.agent_rating IS NOT NULL)      AS csat_responses
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
            """, params_base)
            kpis = dict(cur.fetchone() or {})
            total    = kpis.get('total_handoffs') or 0
            resolved = kpis.get('resolved') or 0
            kpis['resolution_rate'] = round(resolved / total * 100, 1) if total else 0

            cur.execute(f"""
                SELECT
                    DATE(hq.queued_at) AS day,
                    COUNT(*)           AS total,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')  AS resolved,
                    COUNT(*) FILTER (WHERE hq.status = 'abandoned') AS abandoned,
                    ROUND(AVG(hq.wait_time_secs) / 60.0, 1)        AS avg_wait_mins
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
                GROUP BY DATE(hq.queued_at)
                ORDER BY day ASC
            """, params_base)
            daily = [dict(r) for r in cur.fetchall()]
            for d in daily:
                if d.get('day'):
                    d['day'] = d['day'].isoformat()

            cur.execute(f"""
                SELECT
                    o.display_name,
                    o.team,
                    COUNT(hq.id)                                                AS handled,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')             AS resolved,
                    ROUND(AVG(hq.handle_time_secs) / 60.0, 1)                  AS avg_handle_mins,
                    ROUND(AVG(hq.wait_time_secs)   / 60.0, 1)                  AS avg_wait_mins,
                    ROUND(AVG(hq.agent_rating) FILTER (WHERE hq.agent_rating IS NOT NULL), 2) AS avg_csat,
                    COUNT(hq.agent_rating)                                      AS csat_count
                FROM handoff_queue hq
                JOIN operators o ON o.id = hq.operator_id
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  AND hq.operator_id IS NOT NULL
                  {app_filter}
                GROUP BY o.id, o.display_name, o.team
                ORDER BY handled DESC
            """, params_base)
            operators = [dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT hq.trigger_reason, COUNT(*) AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
                GROUP BY hq.trigger_reason
                ORDER BY count DESC
            """, params_base)
            triggers = [dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT m.intent, COUNT(*) AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                JOIN LATERAL (
                    SELECT intent FROM messages
                    WHERE conversation_id = hq.conversation_id
                      AND sender = 'user' AND intent IS NOT NULL
                    ORDER BY timestamp DESC LIMIT 1
                ) m ON TRUE
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  {app_filter}
                  AND m.intent IS NOT NULL
                GROUP BY m.intent
                ORDER BY count DESC
                LIMIT 10
            """, params_base)
            top_intents = [dict(r) for r in cur.fetchall()]

            cur.execute(f"""
                SELECT hq.agent_rating AS rating, COUNT(*) AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  AND hq.agent_rating IS NOT NULL
                  {app_filter}
                GROUP BY hq.agent_rating
                ORDER BY hq.agent_rating
            """, params_base)
            csat_dist = [dict(r) for r in cur.fetchall()]

        finally:
            conn.rollback()
            _release_connection(conn)

        return jsonify({
            'success':     True,
            'days':        days,
            'app_id':      app_id,
            'kpis':        kpis,
            'daily':       daily,
            'operators':   operators,
            'triggers':    triggers,
            'top_intents': top_intents,
            'csat_dist':   csat_dist,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Queue monitor ──────────────────────────────────────────────────────────────

def admin_monitor_queue():
    try:
        from common.conversation_db import (
            get_queue, get_operators, get_operator_current_load
        )
        app_id   = request.args.get('app_id')
        waiting  = get_queue(app_id=app_id, status='waiting')
        assigned = get_queue(app_id=app_id, status='assigned')
        ops      = get_operators()
        op_list  = []
        for op in ops:
            load = get_operator_current_load(op['id'])
            op_list.append({
                'id':             op['id'],
                'display_name':   op['display_name'],
                'team':           op.get('team'),
                'status':         op.get('status', 'offline'),
                'current_load':   load,
                'max_concurrent': op.get('max_concurrent', 3),
                'last_seen':      op.get('last_seen')
            })

        avg_wait = None
        if waiting:
            from datetime import datetime as _dt
            waits = []
            for item in waiting:
                if item.get('queued_at'):
                    try:
                        qt = _dt.fromisoformat(item['queued_at'])
                        waits.append((_dt.now() - qt).total_seconds())
                    except Exception:
                        pass
            avg_wait = round(sum(waits) / len(waits) / 60, 1) if waits else 0

        return jsonify({
            'success':        True,
            'waiting_count':  len(waiting),
            'assigned_count': len(assigned),
            'avg_wait_mins':  avg_wait,
            'waiting':        waiting,
            'assigned':       assigned,
            'operators':      op_list
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Admin send notification ────────────────────────────────────────────────────

def admin_send_notification():
    """
    Send a manual notification from the admin panel.
    Body: { target: 'user'|'operator'|'all', user_id?: str, operator_id?: int,
            title: str, body?: str, type?: str }
    """
    data     = request.get_json(silent=True) or {}
    target   = data.get('target', 'user')
    title    = (data.get('title') or '').strip()
    body_txt = (data.get('body') or '').strip()
    notif_type = data.get('type', 'admin_message')

    if not title:
        return jsonify({'error': 'title is required'}), 400

    try:
        from web.api.impl.notify import notify_user, notify_operator, notify_admins

        if target == 'all':
            notify_admins(type=notif_type, title=title, body=body_txt or None)
            return jsonify({'success': True, 'sent_to': 'all operators/admins'})

        if target == 'operator':
            op_id = data.get('operator_id')
            if not op_id:
                return jsonify({'error': 'operator_id required'}), 400
            notify_operator(int(op_id), type=notif_type, title=title, body=body_txt or None)
            return jsonify({'success': True, 'sent_to': f'operator:{op_id}'})

        # target == 'user'
        user_id = (data.get('user_id') or '').strip()
        if not user_id:
            return jsonify({'error': 'user_id required for target=user'}), 400
        notify_user(user_id=user_id, type=notif_type, title=title, body=body_txt or None)
        return jsonify({'success': True, 'sent_to': user_id})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Client Users ───────────────────────────────────────────────────────────────

def _fetch_glpi_users_sync():
    """Fetch all active users from GLPI API. Returns list of dicts."""
    import asyncio, aiohttp as _aio

    async def _run():
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        cfg  = get_glpi_config()
        glpi = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])
        sess = await glpi.init_session()
        if not sess:
            return []
        try:
            hdrs = {'App-Token': cfg['app_token'], 'Session-Token': sess}
            url  = f"{cfg['api_url']}/User"
            async with _aio.ClientSession() as http:
                async with http.get(url, headers=hdrs,
                                    params={'range': '0-1000', 'is_deleted': 0},
                                    timeout=_aio.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        return await resp.json()
                    return []
        finally:
            await glpi.kill_session(sess)

    try:
        return asyncio.run(_run())
    except Exception as e:
        import logging; logging.getLogger(__name__).error(f"GLPI users fetch: {e}")
        return []


# System-level GLPI accounts that should never appear in the Client Users list
_GLPI_SYSTEM_ACCOUNTS = {
    'admin', 'post-only', 'tech', 'normal', 'glpi-system',
    'botuser1', 'glpi', 'glpi-api',
}


def list_client_users():
    """Return client users from GLPI, supplemented with conversation stats."""
    try:
        search = (request.args.get('search') or '').strip().lower()
        app_id = (request.args.get('app_id') or '').strip()

        # ── 1. Get operator usernames to exclude ───────────────────────────
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute("SELECT username FROM operators WHERE username IS NOT NULL")
            operator_names = {r['username'] for r in cur.fetchall()}

            # ── 2. Conversation stats per user_name ────────────────────────
            cur.execute("""
                SELECT
                    user_name,
                    MAX(NULLIF(user_id, ''))   AS user_id,
                    ARRAY_AGG(DISTINCT app_id) AS apps,
                    COUNT(*)                   AS conv_count,
                    MAX(last_activity)         AS last_active,
                    MIN(started_at)            AS first_seen
                FROM conversations
                WHERE user_name IS NOT NULL AND user_name <> ''
                GROUP BY user_name
            """)
            conv_stats = {r['user_name']: r for r in cur.fetchall()}
        finally:
            conn.rollback()
            _release_connection(conn)

        # ── 3. Fetch GLPI users ────────────────────────────────────────────
        glpi_rows = _fetch_glpi_users_sync()
        exclude   = operator_names | _GLPI_SYSTEM_ACCOUNTS

        users = []
        for g in glpi_rows:
            un = (g.get('name') or '').strip()
            if not un or un in exclude:
                continue
            if search and search not in un.lower() \
                      and search not in (g.get('firstname') or '').lower() \
                      and search not in (g.get('realname') or '').lower() \
                      and search not in (g.get('email') or '').lower():
                continue

            stats = conv_stats.get(un, {})
            apps  = list(stats.get('apps') or [])
            if app_id and app_id not in apps:
                continue

            la = stats.get('last_active')
            fs = stats.get('first_seen')
            users.append({
                'user_name':   un,
                'firstname':   g.get('firstname') or '',
                'lastname':    g.get('realname')  or '',
                'email':       g.get('email') or (g.get('_useremails') or [{}])[0].get('email', '') if isinstance(g.get('_useremails'), list) else '',
                'glpi_id':     g.get('id'),
                'user_id':     stats.get('user_id') or '',
                'apps':        apps,
                'conv_count':  stats.get('conv_count') or 0,
                'last_active': la.isoformat() if la else None,
                'first_seen':  fs.isoformat() if fs else None,
            })

        # Users with conversations first (newest), then no-conv users alphabetically
        with_conv    = sorted([u for u in users if u['last_active']], key=lambda u: u['last_active'], reverse=True)
        without_conv = sorted([u for u in users if not u['last_active']], key=lambda u: u['user_name'])
        users = with_conv + without_conv

        return jsonify({'success': True, 'users': users, 'count': len(users)})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def create_client_user():
    """Create a new client user in GLPI."""
    import asyncio, aiohttp as _aio
    data = request.get_json(silent=True) or {}
    username  = (data.get('username') or '').strip()
    firstname = (data.get('firstname') or '').strip()
    lastname  = (data.get('lastname')  or '').strip()
    email     = (data.get('email')     or '').strip()
    password  = data.get('password') or ''
    if not username:
        return jsonify({'error': 'username is required'}), 400
    if not password:
        return jsonify({'error': 'password is required'}), 400

    async def _run():
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        cfg  = get_glpi_config()
        glpi = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])
        sess = await glpi.init_session()
        if not sess:
            raise RuntimeError('Could not connect to GLPI')
        try:
            hdrs    = {'App-Token': cfg['app_token'], 'Session-Token': sess, 'Content-Type': 'application/json'}
            payload = {'input': {'name': username, 'firstname': firstname, 'realname': lastname,
                                 'password': password, 'password2': password,
                                 '_useremails': [{'email': email}] if email else []}}
            async with _aio.ClientSession() as http:
                async with http.post(f"{cfg['api_url']}/User", json=payload, headers=hdrs,
                                     timeout=_aio.ClientTimeout(total=10)) as resp:
                    body = await resp.json()
                    if resp.status in (200, 201):
                        return body
                    raise RuntimeError(body if isinstance(body, str) else str(body))
        finally:
            await glpi.kill_session(sess)

    try:
        result = asyncio.run(_run())
        return jsonify({'success': True, 'glpi_id': result.get('id') if isinstance(result, dict) else result})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def update_client_user(username):
    """Update an existing client user in GLPI."""
    import asyncio, aiohttp as _aio
    data = request.get_json(silent=True) or {}
    if not username:
        return jsonify({'error': 'username is required'}), 400

    async def _run():
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        cfg  = get_glpi_config()
        glpi = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])
        sess = await glpi.init_session()
        if not sess:
            raise RuntimeError('Could not connect to GLPI')
        try:
            hdrs = {'App-Token': cfg['app_token'], 'Session-Token': sess, 'Content-Type': 'application/json'}
            # Find user ID by username
            async with _aio.ClientSession() as http:
                async with http.get(f"{cfg['api_url']}/User", headers=hdrs,
                                    params={'searchText[name]': username, 'range': '0-5'},
                                    timeout=_aio.ClientTimeout(total=10)) as resp:
                    users = await resp.json() if resp.status == 200 else []
                glpi_id = next((u['id'] for u in (users if isinstance(users, list) else []) if u.get('name') == username), None)
                if not glpi_id:
                    raise RuntimeError(f'User "{username}" not found in GLPI')

                # Build update payload
                inp = {}
                if data.get('firstname'): inp['firstname'] = data['firstname'].strip()
                if data.get('lastname'):  inp['realname']  = data['lastname'].strip()
                if data.get('email'):
                    inp['_useremails'] = [{'email': data['email'].strip()}]
                if data.get('password'):
                    inp['password']  = data['password']
                    inp['password2'] = data['password']
                if not inp:
                    return {'id': glpi_id}

                async with http.put(f"{cfg['api_url']}/User/{glpi_id}", json={'input': inp}, headers=hdrs,
                                    timeout=_aio.ClientTimeout(total=10)) as resp:
                    body = await resp.json()
                    if resp.status in (200, 201):
                        return body
                    raise RuntimeError(str(body))
        finally:
            await glpi.kill_session(sess)

    try:
        asyncio.run(_run())
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


