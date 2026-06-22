"""
Studio and Inspector blueprint.
Routes: /admin/studio/*, /inspector/*, /test/message, /observability/*
"""
import logging
import os
import requests as _requests
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('studio_inspector', __name__)

# ── Shared YAML helpers ──────────────────────────────────────────────────────

def _project_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def _core_dir():
    return os.path.join(_project_root(), 'core')


def _get_stories_and_rules():
    import yaml
    flows = {"stories": [], "rules": []}
    core  = _core_dir()
    for fname, key in [('data/stories.yml', 'stories'), ('data/rules.yml', 'rules')]:
        path = os.path.join(core, fname)
        if os.path.exists(path):
            try:
                with open(path, encoding='utf-8') as f:
                    data = yaml.safe_load(f)
                    if data:
                        flows[key] = data.get(key, [])
            except Exception as e:
                logger.warning("[Studio] Error parsing %s: %s", fname, e)
    return flows


def _get_domain_info():
    import yaml
    domain = {"intents": [], "entities": [], "actions": [], "slots": {}, "responses": []}
    path   = os.path.join(_core_dir(), 'domain.yml')
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            domain['intents']   = data.get('intents', [])
            domain['entities']  = data.get('entities', [])
            domain['actions']   = data.get('actions', [])
            domain['slots']     = data.get('slots', {})
            domain['responses'] = list(data.get('responses', {}).keys())
        except Exception as e:
            logger.warning("[Studio] Error parsing domain.yml: %s", e)
    return domain


# ── Studio routes ─────────────────────────────────────────────────────────────

@bp.route('/admin/studio/flows', methods=['GET'])
def studio_flows():
    try:
        fdata  = _get_stories_and_rules()
        flows  = []
        for story in fdata.get('stories', []):
            steps = []
            for step in story.get('steps', []):
                if isinstance(step, dict):
                    if 'intent' in step:   steps.append(f"intent: {step['intent']}")
                    elif 'action' in step: steps.append(step['action'])
                    elif 'or' in step:     steps.append(f"or: {step['or']}")
            flows.append({'name': story.get('story', 'Unnamed'), 'type': 'story', 'steps': steps})
        for rule in fdata.get('rules', []):
            steps = []
            for step in rule.get('steps', []):
                if isinstance(step, dict):
                    if 'intent' in step:   steps.append(f"intent: {step['intent']}")
                    elif 'action' in step: steps.append(step['action'])
            flows.append({'name': rule.get('rule', 'Unnamed'), 'type': 'rule', 'steps': steps})
        return jsonify({"success": True, "flows": flows})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/responses', methods=['GET'])
def studio_responses():
    try:
        import yaml
        path      = os.path.join(_core_dir(), 'domain.yml')
        responses = []
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            for name, templates in data.get('responses', {}).items():
                text = ''
                if isinstance(templates, list) and templates:
                    text = templates[0].get('text', '') if isinstance(templates[0], dict) else str(templates[0])
                responses.append({'name': name, 'text': text,
                                  'variations': len(templates) if isinstance(templates, list) else 1})
        return jsonify({"success": True, "responses": responses})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/intents', methods=['GET'])
def studio_intents():
    try:
        import yaml
        path    = os.path.join(_core_dir(), 'data', 'nlu.yml')
        intents = []
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            for item in data.get('nlu', []):
                intent_name = item.get('intent', '')
                examples    = item.get('examples', '')
                if isinstance(examples, str):
                    for line in examples.strip().split('\n'):
                        line = line.strip()
                        if line.startswith('- '):
                            intents.append({'intent': intent_name, 'example': line[2:]})
        return jsonify({"success": True, "intents": intents})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/nlu', methods=['GET'])
def studio_nlu():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "data": studio_service.get_nlu_data()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/nlu/example', methods=['POST'])
def studio_add_nlu_example():
    try:
        from web.api.studio_service import studio_service
        data    = request.get_json() or {}
        intent  = data.get('intent', '')
        example = data.get('example', '')
        result  = studio_service.add_nlu_example(intent, example)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/nlu/example', methods=['DELETE'])
def studio_delete_nlu_example():
    try:
        from web.api.studio_service import studio_service
        data    = request.get_json() or {}
        intent  = data.get('intent', '')
        example = data.get('example', '')
        result  = studio_service.delete_nlu_example(intent, example)
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/stories', methods=['GET'])
def studio_stories():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "data": studio_service.get_stories()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/train', methods=['POST'])
def studio_train():
    try:
        from web.api.studio_service import studio_service
        result = studio_service.start_training()
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/train/<job_id>', methods=['GET'])
def studio_train_status(job_id):
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "status": studio_service.get_training_status(job_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/models', methods=['GET'])
def studio_models():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "models": studio_service.list_models()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/files', methods=['GET'])
def studio_files():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "files": studio_service.list_files()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/file', methods=['GET', 'POST'])
def studio_file():
    try:
        from web.api.studio_service import studio_service
        if request.method == 'GET':
            filename = request.args.get('name', '')
            return jsonify({"success": True, "content": studio_service.read_file(filename)})
        data    = request.get_json() or {}
        result  = studio_service.write_file(data.get('name', ''), data.get('content', ''))
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/history', methods=['GET'])
def studio_history():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "history": studio_service.get_history()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@bp.route('/admin/studio/restore', methods=['POST'])
def studio_restore():
    try:
        from web.api.studio_service import studio_service
        data   = request.get_json() or {}
        result = studio_service.restore_version(data.get('version_id', ''))
        return jsonify({"success": True, "data": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/studio/stats', methods=['GET'])
def studio_stats():
    try:
        from web.api.studio_service import studio_service
        return jsonify({"success": True, "data": studio_service.get_stats()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ── Test message ─────────────────────────────────────────────────────────────

@bp.route('/test/message', methods=['POST'])
def test_message():
    try:
        data    = request.get_json() or {}
        message = data.get('message', '')
        sender  = data.get('sender', 'test-user')
        if not message:
            return jsonify({"success": False, "error": "message required"})
        r1  = _requests.post(f"{_s.RASA_URL}/webhooks/rest/webhook",
                             json={"sender": sender, "message": message}, timeout=30)
        r2  = _requests.post(f"{_s.RASA_URL}/model/parse",
                             json={"text": message}, timeout=10)
        return jsonify({"success": True,
                        "responses": r1.json() if r1.status_code == 200 else [],
                        "nlu":       r2.json() if r2.status_code == 200 else {}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ── Inspector routes ──────────────────────────────────────────────────────────

@bp.route('/inspector/conversations', methods=['GET'])
def inspector_list_conversations():
    conn = None
    try:
        limit        = request.args.get('limit', 100, type=int)
        app_flt      = request.args.get('app_id')
        user_flt     = request.args.get('user')
        date_flt     = request.args.get('date')
        date_from    = request.args.get('dateFrom')
        date_to      = request.args.get('dateTo')
        ticket_flt   = request.args.get('ticket')
        handoff_flt  = request.args.get('handoff')
        responded_flt = request.args.get('responded_by')

        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)

        # Detect optional columns safely
        cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='conversations'")
        conv_cols = {r['column_name'] for r in cur.fetchall()}

        had_handoff_sql = (
            "EXISTS (SELECT 1 FROM handoff_queue hq WHERE hq.conversation_id = c.id)"
            if 'handoff_queue' in _get_existing_tables(cur) else "FALSE"
        )

        query = f'''
            SELECT c.id, c.sender_id, c.app_id, c.user_id, c.user_name,
                   c.started_at, c.last_activity, c.resolved,
                   (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) AS message_count,
                   (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender = 'user') AS user_message_count,
                   (SELECT COUNT(*) FROM actions  WHERE conversation_id = c.id) AS action_count,
                   (SELECT type FROM feedback WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) AS feedback,
                   ({had_handoff_sql}) AS had_handoff
            FROM conversations c
        '''
        params = []
        conditions = []

        if app_flt and app_flt != 'all':
            conditions.append("c.app_id = %s"); params.append(app_flt)
        if user_flt:
            conditions.append("(c.user_name ILIKE %s OR c.user_id ILIKE %s OR c.sender_id ILIKE %s)")
            like = f'%{user_flt}%'
            params.extend([like, like, like])
        if date_flt == '24h':
            conditions.append("c.started_at >= NOW() - INTERVAL '24 hours'")
        elif date_flt == '7d':
            conditions.append("c.started_at >= NOW() - INTERVAL '7 days'")
        elif date_flt == '30d':
            conditions.append("c.started_at >= NOW() - INTERVAL '30 days'")
        elif date_flt == 'custom':
            if date_from:
                conditions.append("c.started_at >= %s"); params.append(date_from)
            if date_to:
                conditions.append("c.started_at <= %s"); params.append(date_to + ' 23:59:59')
        if ticket_flt == 'resolved':
            conditions.append("c.resolved = TRUE")
        elif ticket_flt == 'created':
            conditions.append("c.resolved = FALSE")
        if handoff_flt == 'has_handoff':
            conditions.append(f"({had_handoff_sql})")
        elif handoff_flt == 'bot_only':
            conditions.append(f"NOT ({had_handoff_sql})")
        if responded_flt and responded_flt != 'all':
            if responded_flt == 'bot':
                conditions.append(f"NOT ({had_handoff_sql})")
            else:
                # Filter by specific operator name
                op_table_exists = 'operator_messages' in _get_existing_tables(cur)
                if op_table_exists:
                    conditions.append("""EXISTS (
                        SELECT 1 FROM handoff_queue hq2
                        JOIN operators op ON op.id = hq2.operator_id
                        WHERE hq2.conversation_id = c.id AND op.username = %s
                    )""")
                    params.append(responded_flt)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY c.id DESC LIMIT %s"
        params.append(limit)

        cur.execute(query, tuple(params))
        convs = []
        for row in cur.fetchall():
            sid  = row['sender_id'] or ''
            name = row.get('user_name') or row.get('user_id') or (sid[:12] + '...' if len(sid) > 12 else sid)
            convs.append({
                "id": row['id'], "sender_id": sid,
                "sender_id_short": sid[:12] + '...' if len(sid) > 12 else sid,
                "user_name": row.get('user_name'), "display_name": name,
                "app_id": row['app_id'] or 'General', "user_id": row['user_id'],
                "started_at":    row['started_at'].isoformat()   if row['started_at']   else None,
                "last_activity": row['last_activity'].isoformat() if row['last_activity'] else None,
                "resolved": bool(row['resolved']), "message_count": row['message_count'],
                "user_message_count": row['user_message_count'],
                "action_count": row['action_count'], "feedback": row['feedback'],
                "had_handoff": bool(row.get('had_handoff', False)),
            })
        return jsonify({"success": True, "data": convs, "count": len(convs)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


def _get_existing_tables(cur):
    """Return set of existing table names."""
    try:
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
        return {r['table_name'] for r in cur.fetchall()}
    except Exception:
        return set()


@bp.route('/inspector/conversation/<sender_id>', methods=['GET'])
def inspector_get_conversation_detail(sender_id):
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute('SELECT * FROM conversations WHERE sender_id = %s', (sender_id,))
        conv = cur.fetchone()
        if not conv:
            return jsonify({"success": False, "error": "Conversation not found"}), 404
        cid = conv['id']

        cur.execute('SELECT id, sender, text, intent, timestamp FROM messages WHERE conversation_id = %s ORDER BY timestamp ASC', (cid,))
        messages = []
        intents  = []
        for row in cur.fetchall():
            ts  = row['timestamp'].isoformat() if row['timestamp'] else None
            msg = {"id": row['id'], "sender": row['sender'], "text": row['text'],
                   "intent": row['intent'], "timestamp": ts}
            messages.append(msg)
            if row['intent']:
                intents.append({"intent": row['intent'], "timestamp": ts,
                                "message": (row['text'] or '')[:50]})

        # Merge handoff sessions and operator messages if tables exist
        existing_tables = _get_existing_tables(cur)
        handoff_sessions = []
        if 'handoff_queue' in existing_tables:
            try:
                op_join = "LEFT JOIN operators op ON op.id = hq.operator_id" if 'operators' in existing_tables else ""
                op_col  = "op.username AS operator_name" if 'operators' in existing_tables else "NULL AS operator_name"
                cur.execute(f'''
                    SELECT hq.id, hq.created_at, hq.resolved_at, hq.status, {op_col}
                    FROM handoff_queue hq {op_join}
                    WHERE hq.conversation_id = %s ORDER BY hq.created_at ASC
                ''', (cid,))
                for row in cur.fetchall():
                    handoff_sessions.append({
                        "id": row['id'],
                        "operator_name": row.get('operator_name') or 'Agent',
                        "started_at": row['created_at'].isoformat() if row['created_at'] else None,
                        "ended_at":   row['resolved_at'].isoformat() if row['resolved_at'] else None,
                        "status": row['status'],
                    })
            except Exception:
                pass

        operator_messages = []
        if 'operator_messages' in existing_tables:
            try:
                op_join = "LEFT JOIN operators op ON op.id = om.operator_id" if 'operators' in existing_tables else ""
                op_col  = "op.username AS operator_name" if 'operators' in existing_tables else "NULL AS operator_name"
                cur.execute(f'''
                    SELECT om.id, om.message AS text, om.timestamp, {op_col}
                    FROM operator_messages om {op_join}
                    WHERE om.conversation_id = %s ORDER BY om.timestamp ASC
                ''', (cid,))
                for row in cur.fetchall():
                    operator_messages.append({
                        "id": f"op_{row['id']}", "sender": "operator",
                        "text": row['text'],
                        "operator_name": row.get('operator_name') or 'Agent',
                        "timestamp": row['timestamp'].isoformat() if row['timestamp'] else None,
                    })
            except Exception:
                pass

        # Merge operator messages into timeline
        all_messages = messages + operator_messages
        all_messages.sort(key=lambda m: m.get('timestamp') or '')

        cur.execute('SELECT action_name, success, timestamp FROM actions WHERE conversation_id = %s ORDER BY timestamp ASC', (cid,))
        actions  = [{"action": r['action_name'], "success": bool(r['success']),
                     "timestamp": r['timestamp'].isoformat() if r['timestamp'] else None} for r in cur.fetchall()]
        cur.execute('SELECT type, timestamp FROM feedback WHERE conversation_id = %s ORDER BY timestamp ASC', (cid,))
        feedback = [{"type": r['type'], "timestamp": r['timestamp'].isoformat() if r['timestamp'] else None} for r in cur.fetchall()]

        return jsonify({"success": True, "data": {
            "conversation": {
                "id": conv['id'], "sender_id": conv['sender_id'], "app_id": conv['app_id'],
                "user_id": conv['user_id'],
                "started_at":    conv['started_at'].isoformat()   if conv['started_at']   else None,
                "last_activity": conv['last_activity'].isoformat() if conv['last_activity'] else None,
                "resolved": bool(conv['resolved']),
            },
            "messages": all_messages, "intent_history": intents, "actions": actions, "feedback": feedback,
            "handoff_sessions": handoff_sessions,
            "stats": {
                "total_messages":    len(all_messages),
                "user_messages":     sum(1 for m in all_messages if m['sender'] == 'user'),
                "bot_messages":      sum(1 for m in all_messages if m['sender'] == 'bot'),
                "operator_messages": sum(1 for m in all_messages if m['sender'] == 'operator'),
                "actions_executed":  len(actions),
                "unique_intents":    len(set(m['intent'] for m in messages if m.get('intent'))),
            }
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/inspector/flows', methods=['GET'])
def inspector_get_flows():
    try:
        flows = _get_stories_and_rules()
        out   = []
        for s in flows.get('stories', []):
            if isinstance(s, dict) and 'story' in s:
                out.append({'name': s['story'], 'type': 'story', 'steps': s.get('steps', [])})
        for r in flows.get('rules', []):
            if isinstance(r, dict) and 'rule' in r:
                out.append({'name': r['rule'], 'type': 'rule', 'steps': r.get('steps', [])})
        return jsonify({"success": True, "data": out, "count": len(out)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/inspector/intents', methods=['GET'])
def inspector_get_intent_stats():
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT intent, COUNT(*) AS cnt FROM messages WHERE intent IS NOT NULL AND intent != '' GROUP BY intent ORDER BY cnt DESC")
        dist = {r['intent']: r['cnt'] for r in cur.fetchall()}
        cur.execute("SELECT EXTRACT(HOUR FROM timestamp) AS h, COUNT(*) AS cnt FROM messages WHERE intent IS NOT NULL AND timestamp > NOW() - INTERVAL '24 hours' GROUP BY h ORDER BY h")
        hourly = {int(r['h']): r['cnt'] for r in cur.fetchall()}
        domain = _get_domain_info()
        return jsonify({"success": True, "data": {
            "distribution": dist, "hourly_activity": hourly,
            "known_intents": domain['intents'], "total_intent_messages": sum(dist.values()),
        }})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/inspector/actions', methods=['GET'])
def inspector_get_action_stats():
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT action_name, COUNT(*) AS cnt, SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successes FROM actions GROUP BY action_name ORDER BY cnt DESC")
        actions = [{"action": r['action_name'], "count": r['cnt'],
                    "success_rate": round(r['successes'] / r['cnt'] * 100, 1) if r['cnt'] else 0}
                   for r in cur.fetchall()]
        return jsonify({"success": True, "data": {"actions": actions, "total": len(actions)}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/inspector/domain', methods=['GET'])
def inspector_domain():
    try:
        return jsonify({"success": True, "data": _get_domain_info()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/inspector/operators', methods=['GET'])
def inspector_get_operators():
    """Return list of operators who have handled at least one handoff — for the Responded By filter."""
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        existing = _get_existing_tables(cur)
        if 'operators' not in existing or 'handoff_queue' not in existing:
            return jsonify({"success": True, "operators": []})
        cur.execute('''
            SELECT DISTINCT op.username, op.display_name
            FROM operators op
            JOIN handoff_queue hq ON hq.operator_id = op.id
            ORDER BY op.username
        ''')
        ops = [{"username": r['username'], "display_name": r.get('display_name') or r['username']}
               for r in cur.fetchall()]
        return jsonify({"success": True, "operators": ops})
    except Exception as e:
        return jsonify({"success": True, "operators": []})
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/inspector/health', methods=['GET'])
def inspector_health():
    return jsonify({"status": "ok"})


@bp.route('/inspector/parse', methods=['POST'])
def inspector_parse():
    try:
        data = request.get_json() or {}
        text = data.get('text', '')
        r    = _requests.post(f"{_s.RASA_URL}/model/parse", json={"text": text}, timeout=10)
        return jsonify({"success": True, "data": r.json() if r.status_code == 200 else {}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/inspector/conversation/<sender_id>/debug', methods=['GET'])
def inspector_conversation_debug(sender_id):
    try:
        r = _requests.get(f"{_s.RASA_URL}/conversations/{sender_id}/tracker", timeout=10)
        return jsonify({"success": True, "data": r.json() if r.status_code == 200 else {}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/inspector/conversation/<sender_id>/tracker', methods=['GET'])
def inspector_conversation_tracker(sender_id):
    try:
        r = _requests.get(f"{_s.RASA_URL}/conversations/{sender_id}/tracker", timeout=10)
        return jsonify({"success": True, "data": r.json() if r.status_code == 200 else {}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/inspector/domain/info', methods=['GET'])
def inspector_domain_info():
    try:
        r = _requests.get(f"{_s.RASA_URL}/domain", timeout=10)
        return jsonify({"success": True, "data": r.json() if r.status_code == 200 else {}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
