"""
Operator and internal endpoint implementations.

Covers: operator auth, queue management, conversation handling,
        internal Rasa-facing endpoints, and shared queue helpers.
"""
import re
import os
import base64
import hmac
import hashlib
import json
import time
import asyncio
import logging
from typing import Optional
from functools import wraps

from flask import request, jsonify

import web.api.shared as _s

logger = logging.getLogger(__name__)
from web.api.shared import (
    require_operator_token,
    jwt_encode, jwt_decode,
    get_operator_jwt_secret, get_operator_jwt_expiry_hours,
    emit_to_user, emit_to_operator, emit_queue_overview,
)
from common.conversation_db import _get_connection, _release_connection


# ── Config helpers ─────────────────────────────────────────────────────────────

def get_handoff_config_for_login():
    from common.config_manager import get_handoff_config
    return get_handoff_config()


def get_handoff_runtime_config_for_api():
    """Returns handoff config — checks Redis first, then in-process TTL cache, then DB."""
    from common.redis_cache import get_handoff_config as _r_get, set_handoff_config as _r_set
    from common.ttl_cache import handoff_config_cache
    from common.conversation_db import get_handoff_runtime_config

    cfg = _r_get()
    if cfg is not None:
        return cfg
    cfg = handoff_config_cache.get('cfg')
    if cfg is not None:
        return cfg
    cfg = get_handoff_runtime_config()
    _r_set(cfg)
    handoff_config_cache.set('cfg', cfg)
    return cfg


def _get_handoff_cfg_value(key: str, default=None):
    try:
        from common.config_manager import get_handoff_config
        return get_handoff_config().get(key, default)
    except Exception:
        return default


# ── Private queue helpers ──────────────────────────────────────────────────────

def _get_avg_handle_time(app_id: str = None) -> Optional[int]:
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            if app_id:
                cursor.execute(
                    "SELECT AVG(handle_time_secs) AS avg_handle "
                    "FROM handoff_queue "
                    "WHERE app_id = %s AND status = 'resolved' "
                    "AND resolved_at > NOW() - INTERVAL '7 days'",
                    (app_id,)
                )
            else:
                cursor.execute(
                    "SELECT AVG(handle_time_secs) AS avg_handle "
                    "FROM handoff_queue "
                    "WHERE status = 'resolved' "
                    "AND resolved_at > NOW() - INTERVAL '7 days'"
                )
            row = cursor.fetchone()
            val = row['avg_handle'] if row and row['avg_handle'] else None
            return int(val) if val else None
        finally:
            conn.rollback()
            _release_connection(conn)
    except Exception:
        return None


def _apply_routing_rules(app_id: str, trigger_detail: dict) -> tuple:
    """Evaluate routing rules table and return (target_team, required_skill, priority_boost)."""
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT * FROM handoff_routing_rules "
                "WHERE is_active = TRUE ORDER BY sort_order ASC"
            )
            rules = cursor.fetchall()
        finally:
            conn.rollback()
            _release_connection(conn)

        intent   = trigger_detail.get('intent', '')
        keywords = trigger_detail.get('last_message', '').lower()

        for rule in rules:
            match_type  = rule['match_type']
            match_value = rule['match_value'].lower()
            matched = False

            if match_type == 'intent' and intent.lower() == match_value:
                matched = True
            elif match_type == 'keyword' and match_value in keywords:
                matched = True
            elif match_type == 'app_id' and app_id.lower() == match_value:
                matched = True

            if matched:
                return (
                    rule.get('target_team'),
                    rule.get('required_skill'),
                    rule.get('priority_boost', 0)
                )
    except Exception:
        pass
    return (None, None, 0)


def _mask_sensitive(text: str) -> tuple:
    cfg = get_handoff_runtime_config_for_api().get('gdpr', {})
    masked_types = []
    patterns = []
    if cfg.get('mask_passwords', True):
        patterns.append(('password', r'(?i)(password|pwd|passwort)\s*[:=]\s*\S+'))
    if cfg.get('mask_card_numbers', True):
        patterns.append(('card_number', r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b'))
    if cfg.get('mask_ibans', True):
        patterns.append(('iban', r'\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b'))
    if cfg.get('mask_emails', False):
        patterns.append(('email', r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b'))
    for mask_type, pattern in patterns:
        if re.search(pattern, text):
            text = re.sub(pattern, f'[{mask_type.upper()}_REDACTED]', text)
            masked_types.append(mask_type)
    return text, masked_types


def _build_context_package(sender_id: str, conversation_id: int,
                            trigger_reason: str, trigger_detail: dict) -> dict:
    from datetime import datetime as _dt
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT user_name, user_id, app_id, ticket_id, started_at, "
                "low_conf_streak, frustration_score, client_metadata "
                "FROM conversations WHERE id = %s",
                (conversation_id,)
            )
            conv = cursor.fetchone()
            if not conv:
                return {}
            cursor.execute(
                "SELECT sender, text, intent, timestamp FROM messages "
                "WHERE conversation_id = %s ORDER BY timestamp ASC",
                (conversation_id,)
            )
            messages = cursor.fetchall()
        finally:
            conn.rollback()
            _release_connection(conn)

        masked_transcript = []
        for msg in messages:
            masked_text, _ = _mask_sensitive(msg['text'] or '')
            masked_transcript.append({
                'sender': msg['sender'],
                'text': masked_text,
                'intent': msg.get('intent'),
                'timestamp': msg['timestamp'].isoformat() if msg['timestamp'] else None
            })

        intents = [m['intent'] for m in messages if m.get('intent')]
        last_user_msg = next(
            (m['text'] for m in reversed(messages) if m['sender'] == 'user'), ''
        )
        summary = (
            f"User {conv.get('user_name') or conv.get('user_id') or sender_id} "
            f"was in a {conv.get('app_id', 'General')} support conversation. "
        )
        if conv.get('ticket_id'):
            summary += f"Related ticket: #{conv['ticket_id']}. "
        if intents:
            summary += f"Main topics: {', '.join(dict.fromkeys(intents)[-5:])}. "
        summary += f"Handoff triggered by: {trigger_reason}. "
        summary += f"Last user message: \"{last_user_msg[:200]}\""

        client_meta = conv.get('client_metadata') or {}

        return {
            'package_version': '1.0',
            'generated_at': _dt.utcnow().isoformat() + 'Z',
            'consent_given': True,
            'user_profile': {
                'display_name': conv.get('user_name'),
                'glpi_user_id': conv.get('user_id'),
                'app_id': conv.get('app_id'),
            },
            'session': {
                'sender_id': sender_id,
                'conversation_id': conversation_id,
                'started_at': conv['started_at'].isoformat() if conv.get('started_at') else None,
                'message_count': len(messages),
                'related_ticket_id': conv.get('ticket_id'),
            },
            'trigger': {
                'reason': trigger_reason,
                'detail': trigger_detail,
                'low_conf_streak': conv.get('low_conf_streak', 0),
                'frustration_score': conv.get('frustration_score', 0.0),
            },
            'ai_summary': summary,
            'transcript': masked_transcript[-20:],
            'technical_data': {
                'browser': client_meta.get('browser', ''),
                'os': client_meta.get('os', ''),
                'device_type': client_meta.get('device_type', ''),
                'page_url': client_meta.get('page_url', ''),
                'ip_address': '[MASKED]',
            }
        }
    except Exception as e:
        return {'error': str(e)}


# ── Operator auth endpoints ────────────────────────────────────────────────────

def operator_token_refresh():
    try:
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        token = auth[7:]
        secret = get_operator_jwt_secret()

        parts = token.split('.')
        if len(parts) != 3:
            return jsonify({'error': 'Malformed token'}), 401
        header_b, body_b, sig_b = parts
        sig_input = f"{header_b}.{body_b}".encode()
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
        ).rstrip(b'=').decode()
        if not hmac.compare_digest(sig_b, expected_sig):
            return jsonify({'error': 'Invalid token signature'}), 401

        padding = 4 - len(body_b) % 4
        payload = json.loads(base64.urlsafe_b64decode(body_b + '=' * padding))

        if payload.get('type') != 'operator':
            return jsonify({'error': 'Not an operator token'}), 401

        exp = payload.get('exp', 0)
        now = int(time.time())
        if exp <= now and now - exp > 86400:
            return jsonify({'error': 'Token too old to refresh — please log in again'}), 401

        expiry_hours = get_operator_jwt_expiry_hours()
        new_payload = {
            'sub':      payload['sub'],
            'username': payload.get('username', ''),
            'type':     'operator',
            'exp':      now + expiry_hours * 3600,
        }
        new_token = jwt_encode(new_payload, secret)
        return jsonify({'token': new_token})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_logout(**kwargs):
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE operators SET status = 'offline', last_seen = NOW() WHERE id = %s",
                (kwargs['_operator_id'],)
            )
            conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_heartbeat(**kwargs):
    try:
        from common.conversation_db import (
            update_operator_last_seen, get_operator_current_load, get_operator
        )
        op_id = kwargs['_operator_id']
        op = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        current_load = get_operator_current_load(op_id)
        cfg = get_handoff_runtime_config_for_api()

        if op['status'] == 'away':
            new_status = 'away'
        elif cfg['operators']['auto_busy_on_max_load'] and current_load >= op['max_concurrent']:
            new_status = 'busy'
        else:
            new_status = 'available'

        from datetime import datetime as _dt
        last_seen = op.get('last_seen')
        status_changed = (new_status != op['status'])
        secs_since = (
            (_dt.now() - last_seen).total_seconds()
            if last_seen and not getattr(last_seen, 'tzinfo', None)
            else (_dt.now(last_seen.tzinfo) - last_seen).total_seconds()
            if last_seen else 999
        )
        watchdog_secs = int(_get_handoff_cfg_value('operator_heartbeat_timeout_secs', 90))
        needs_refresh = secs_since >= watchdog_secs / 2

        if status_changed or needs_refresh:
            update_operator_last_seen(op_id, status=new_status)

        return jsonify({
            'status': new_status,
            'current_load': current_load,
            'max_concurrent': op['max_concurrent']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_me(**kwargs):
    try:
        from common.conversation_db import (
            get_operator, get_operator_current_load, get_queue
        )
        op_id = kwargs['_operator_id']
        op = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        active = get_queue(status='assigned')
        my_active = [q for q in active if q.get('operator_id') == op_id]
        return jsonify({
            'operator': op,
            'current_load': get_operator_current_load(op_id),
            'active_conversations': my_active
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_set_status(**kwargs):
    try:
        from common.conversation_db import update_operator, get_operator_current_load, get_operator
        data = request.get_json(silent=True) or {}
        new_status = data.get('status', '')
        if new_status not in ('available', 'away'):
            return jsonify({"error": "status must be 'available' or 'away'"}), 400
        op_id = kwargs['_operator_id']
        if new_status == 'available':
            op = get_operator(op_id)
            load = get_operator_current_load(op_id)
            cfg = get_handoff_runtime_config_for_api()
            if cfg['operators']['auto_busy_on_max_load'] and op and load >= op['max_concurrent']:
                new_status = 'busy'
        update_operator(op_id, status=new_status)
        from common.conversation_db import update_operator_last_seen
        update_operator_last_seen(op_id)
        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Internal endpoints (called by Rasa action server) ─────────────────────────

def internal_reset_operator_status():
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE operators SET status = 'available', last_seen = NOW() "
                "WHERE is_active = TRUE"
            )
            updated = cursor.rowcount
            conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'updated': updated})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def internal_operators_available():
    try:
        from common.conversation_db import get_available_operators, get_queue
        app_id = request.args.get('app_id')
        debug  = request.args.get('debug') == '1'
        eligible = get_available_operators(app_id)

        if debug:
            from psycopg2.extras import RealDictCursor as _RDC
            _dc = _get_connection()
            try:
                _cur = _dc.cursor(cursor_factory=_RDC)
                _cur.execute(
                    "SELECT id, username, display_name, status, is_active, app_ids, "
                    "last_seen, NOW() as db_now, "
                    "EXTRACT(EPOCH FROM (NOW() - last_seen))::INT as secs_since_seen "
                    "FROM operators"
                )
                all_ops = [dict(r) for r in _cur.fetchall()]
                for o in all_ops:
                    if o.get('last_seen'): o['last_seen'] = o['last_seen'].isoformat()
                    if o.get('db_now'):    o['db_now']    = o['db_now'].isoformat()
            finally:
                _dc.rollback()
                _release_connection(_dc)
            return jsonify({'eligible': eligible, 'all_operators': all_ops,
                            'filter_app_id': app_id})

        waiting = get_queue(app_id=app_id, status='waiting')
        assigned = get_queue(app_id=app_id, status='assigned')

        free_slots = sum(
            max(0, op['max_concurrent'] - op['current_load']) for op in eligible
        )
        online_count = len(eligible)
        queue_depth = len(waiting)

        cfg = get_handoff_runtime_config_for_api()
        if free_slots > 0 and online_count > 0:
            avg_handle = _get_avg_handle_time(app_id) or 300
            wait_secs = int((queue_depth * avg_handle) / max(free_slots, 1))
        elif online_count > 0:
            avg_handle = _get_avg_handle_time(app_id) or 300
            wait_secs = int((max(queue_depth, 1) * avg_handle) / max(online_count, 1))
        else:
            wait_secs = 0

        return jsonify({
            'online': online_count > 0,
            'free_slots': free_slots,
            'online_count': online_count,
            'queue_depth': queue_depth,
            'wait_secs': wait_secs,
            'wait_mins': round(wait_secs / 60, 1)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _rank_auto_assign_candidates(candidates, target_team):
    """Pure selection: from already-eligible operators (online, within shift,
    under capacity, app-matched — as returned by get_available_operators), keep
    those matching the target team (or with no team set), then pick fewest active
    chats with a deterministic operator-id tiebreak. Returns the chosen operator
    dict or None. Kept separate from DB/socket side effects so it is unit-testable."""
    pool = candidates
    if target_team:
        pool = [o for o in pool if not o.get('team') or o.get('team') == target_team]
    if not pool:
        return None
    return sorted(pool, key=lambda o: (o.get('current_load', 0), o['id']))[0]


def _try_auto_assign(entry, app_id, target_team, required_skill):
    """Opt-in (operators.auto_assign): on enqueue, hand a freshly-waiting item to
    the least-loaded available operator instead of leaving it for a manual claim.
    Reuses get_available_operators (online + within-shift + under capacity + app
    match); picks fewest current chats, ties broken by operator id. No-op (returns
    None) when disabled, when the item isn't waiting, or when nobody is free —
    the item simply stays in the queue for manual claim. Best-effort: any failure
    is swallowed so it can never block normal enqueue."""
    try:
        cfg = get_handoff_runtime_config_for_api()
        if not cfg.get('operators', {}).get('auto_assign'):
            return None
        if entry.get('status') != 'waiting':
            return None  # de-duped onto an existing waiting/assigned item

        from common.conversation_db import get_available_operators
        op = _rank_auto_assign_candidates(get_available_operators(app_id), target_team)
        if not op:
            return None
        op_id = op['id']

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            from datetime import datetime as _dt
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'assigned', operator_id = %s, assigned_at = %s, "
                "wait_time_secs = EXTRACT(EPOCH FROM (NOW() - queued_at))::INT "
                "WHERE id = %s AND status = 'waiting' "
                "RETURNING *",
                (op_id, _dt.now(), entry['id'])
            )
            row = cursor.fetchone()
            if not row:
                return None  # raced — someone claimed it first
            cursor.execute(
                "UPDATE conversations SET handoff_state = 'assigned', assigned_operator_id = %s "
                "WHERE id = %s",
                (op_id, row['conversation_id'])
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, 'queued', 'assigned', 'system', %s, 'auto-assigned (least-loaded)')",
                (row['conversation_id'], str(op_id))
            )
            conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)

        # Flip to busy if this assignment fills their last slot.
        try:
            from common.conversation_db import update_operator, get_operator_current_load
            if (cfg['operators']['auto_busy_on_max_load']
                    and get_operator_current_load(op_id) >= op.get('max_concurrent', 3)):
                update_operator(op_id, status='busy')
        except Exception:
            pass

        op_name = op.get('display_name', 'an agent')
        emit_to_operator(op_id, 'session_assigned', {
            'conversation_id': row['conversation_id'], 'queue_id': row['id'],
            'sender_id': entry.get('sender_id'),
        })
        emit_to_user(entry.get('sender_id'), 'handoff_assigned', {
            'conversation_id': row['conversation_id'],
            'operator_name':   op_name,
            'message': (
                f"✅ {op_name} has joined the conversation. "
                "You can now chat with them directly."
            ),
        })
        _s.sio.emit('queue_item_updated', {
            'queue_id': row['id'], 'status': 'assigned', 'operator_id': op_id,
        }, room='queue_overview')
        emit_queue_overview()
        logger.info(f"[auto-assign] queue_id={row['id']} -> operator {op_id} ({op_name})")
        return {'operator_id': op_id, 'operator_name': op_name, 'queue_id': row['id']}
    except Exception as _ae:
        logger.warning(f"[auto-assign] non-fatal failure: {_ae}")
        return None


def internal_queue_enqueue():
    try:
        from common.conversation_db import (
            enqueue_handoff, log_handoff_consent, get_queue
        )
        data = request.get_json(silent=True) or {}
        sender_id      = data.get('sender_id')
        app_id         = data.get('app_id', 'General')
        trigger_reason = data.get('trigger_reason', 'user_request')
        trigger_detail = data.get('trigger_detail')
        priority       = data.get('priority')
        consent_given  = data.get('consent_given', False)
        ip_hash        = data.get('ip_hash')
        user_org_id    = data.get('user_org_id', '')
        support_org_id = data.get('support_org_id', '')
        product_id     = data.get('product_id', '')
        channel        = data.get('channel', 'internal')

        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            from datetime import datetime
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id FROM conversations WHERE sender_id = %s ORDER BY id DESC LIMIT 1", (sender_id,)
            )
            row = cursor.fetchone()
            if not row:
                now = datetime.utcnow()
                cursor.execute(
                    "INSERT INTO conversations (sender_id, app_id, started_at, last_activity) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (sender_id, app_id, now, now)
                )
                row = cursor.fetchone()
                conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)

        conversation_id = row['id']

        if consent_given:
            log_handoff_consent(sender_id, conversation_id, True, ip_hash)

        target_team, required_skill, priority_boost = _apply_routing_rules(
            app_id, trigger_detail or {}
        )
        if priority is None:
            cfg = get_handoff_runtime_config_for_api()
            priority = cfg['queue']['default_priority']
        priority = min(9, priority + priority_boost)

        context_package = _build_context_package(sender_id, conversation_id, trigger_reason, trigger_detail)

        entry = enqueue_handoff(
            conversation_id=conversation_id,
            sender_id=sender_id,
            app_id=app_id,
            trigger_reason=trigger_reason,
            trigger_detail=trigger_detail,
            priority=priority,
            context_package=context_package,
            target_team=target_team,
            required_skill=required_skill,
            user_org_id=user_org_id,
            support_org_id=support_org_id,
            product_id=product_id,
            channel=channel,
        )

        if entry is None:
            return jsonify({'error': 'Queue is full or enqueue failed'}), 503

        assigned = _try_auto_assign(entry, app_id, target_team, required_skill)
        if assigned:
            return jsonify({
                'success': True,
                'queue_id': entry['id'],
                'auto_assigned': True,
                'operator_id': assigned['operator_id'],
                'operator_name': assigned['operator_name'],
                'position': 0,
                'wait_secs': 0,
                'wait_mins': 0,
            })

        try:
            cfg = get_handoff_runtime_config_for_api()
            avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))
            pos = int(entry.get('queue_position', 1))
            wait_mins = round(pos * avg_handle)
            queued_at_str = str(entry.get('queued_at', ''))
            _s.sio.emit('new_queue_item', {
                'queue_id':           entry['id'],
                'queue_position':     pos,
                'wait_estimate_mins': wait_mins,
                'app_id':             app_id,
                'target_team':        target_team,
                'required_skill':     required_skill,
                'trigger_reason':     trigger_reason,
                'queued_at':          queued_at_str,
            }, room='queue_overview')
            emit_queue_overview()
            logger.debug(f"[SIO enqueue] Emitted new_queue_item to queue_overview (queue_id={entry['id']}, pos={pos})")
            emit_to_user(sender_id, 'handoff_queued', {
                'conversation_id':    conversation_id,
                'queue_position':     pos,
                'wait_estimate_mins': wait_mins,
            })
        except Exception as _nqe:
            import traceback
            logger.warning(f"[SIO enqueue] notify error (non-fatal): {_nqe}")
            traceback.print_exc()

        return jsonify({
            'success': True,
            'queue_id': entry['id'],
            'position': entry.get('queue_position', 1),
            'wait_secs': 0,
            'wait_mins': 0
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Operator queue management ──────────────────────────────────────────────────

@require_operator_token
def operator_get_queue(**kwargs):
    try:
        from common.conversation_db import get_operator, get_queue
        op    = get_operator(kwargs['_operator_id'])
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        op_id  = kwargs['_operator_id']
        status = request.args.get('status', 'waiting')

        if status == 'assigned':
            all_assigned = get_queue(status='assigned')
            items = [i for i in all_assigned if i.get('operator_id') == op_id]
            # Keep only the most recent queue item per user to avoid duplicates
            seen_users = {}
            for item in items:
                key = item.get('user_name') or item.get('sender_id')
                if key not in seen_users or item['id'] > seen_users[key]['id']:
                    seen_users[key] = item
            items = list(seen_users.values())
        else:
            items = []
            app_ids = op.get('app_ids') or []
            if app_ids:
                for app_id in app_ids:
                    items += get_queue(app_id=app_id, team=op.get('team'), status='waiting')
            else:
                items = get_queue(status='waiting')
            seen = set()
            unique = []
            for item in items:
                if item['id'] not in seen:
                    seen.add(item['id'])
                    unique.append(item)
            items = unique
            items.sort(key=lambda x: (-x.get('priority', 5), x.get('queued_at', '')))

        return jsonify({'success': True, 'items': items, 'count': len(items)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_claim(**kwargs):
    try:
        from common.conversation_db import (
            get_operator, get_operator_current_load, update_operator
        )
        from datetime import datetime as _dt
        data     = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        op    = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        load = get_operator_current_load(op_id)
        if load >= op['max_concurrent']:
            return jsonify({'error': 'You are at maximum concurrent chat capacity'}), 409

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'assigned', operator_id = %s, assigned_at = %s, "
                "wait_time_secs = EXTRACT(EPOCH FROM (NOW() - queued_at))::INT "
                "WHERE id = %s AND status = 'waiting' "
                "RETURNING *",
                (op_id, _dt.now(), queue_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or already claimed'}), 409

            cursor.execute(
                "UPDATE conversations SET handoff_state = 'assigned', assigned_operator_id = %s "
                "WHERE id = %s",
                (op_id, row['conversation_id'])
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id) "
                "VALUES (%s, 'queued', 'assigned', 'operator', %s)",
                (row['conversation_id'], str(op_id))
            )
            conn.commit()

            cfg = get_handoff_runtime_config_for_api()
            new_load = load + 1
            if cfg['operators']['auto_busy_on_max_load'] and new_load >= op['max_concurrent']:
                update_operator(op_id, status='busy')

            _row_dict = dict(row)
            try:
                from psycopg2.extras import RealDictCursor as _CRC
                _claim_conn = _get_connection()
                try:
                    _claim_cur = _claim_conn.cursor(cursor_factory=_CRC)
                    _claim_cur.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    _claim_cr = _claim_cur.fetchone()
                finally:
                    _claim_conn.rollback()
                    _release_connection(_claim_conn)
                if _claim_cr:
                    _row_dict['sender_id'] = _claim_cr['sender_id']
                    emit_to_user(_claim_cr['sender_id'], 'handoff_assigned', {
                        'conversation_id': row['conversation_id'],
                        'operator_name':   op.get('display_name', 'an agent'),
                        'message': (
                            f"✅ {op.get('display_name', 'An agent')} has joined the conversation. "
                            "You can now chat with them directly."
                        ),
                    })
            except Exception as _ce:
                logger.warning(f"[SIO claim] notify user error (non-fatal): {_ce}")

            _s.sio.emit('queue_item_updated', {
                'queue_id':    row['id'],
                'status':      'assigned',
                'operator_id': op_id,
            }, room='queue_overview')
            emit_queue_overview()

            return jsonify({'success': True, 'queue_item': _row_dict})
        finally:
            conn.rollback()
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_resolve(**kwargs):
    try:
        from common.conversation_db import update_operator, get_operator_current_load, get_operator
        from datetime import datetime as _dt
        data          = request.get_json(silent=True) or {}
        queue_id      = data.get('queue_id')
        return_to_bot = data.get('return_to_bot', True)
        closing_note  = data.get('closing_note', '')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'resolved', resolved_at = %s, return_to_bot = %s, "
                "closing_note = %s, "
                "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT "
                "WHERE id = %s AND operator_id = %s AND status = 'assigned' "
                "RETURNING conversation_id",
                (_dt.now(), return_to_bot, closing_note, queue_id, op_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or not assigned to you'}), 409

            conv_id   = row['conversation_id']
            new_state = 'bot_active' if return_to_bot else 'closed'
            cursor.execute(
                "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL "
                "WHERE id = %s",
                (new_state, conv_id)
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, 'assigned', %s, 'operator', %s, %s)",
                (conv_id, new_state, str(op_id), closing_note)
            )
            conn.commit()

            cfg = get_handoff_runtime_config_for_api()
            op = get_operator(op_id)
            new_load = get_operator_current_load(op_id)
            if (cfg['operators']['auto_busy_on_max_load']
                    and op and op['status'] == 'busy'
                    and new_load < op['max_concurrent']):
                update_operator(op_id, status='available')

            try:
                _res_conn = _get_connection()
                try:
                    from psycopg2.extras import RealDictCursor as _RRC
                    _res_cur = _res_conn.cursor(cursor_factory=_RRC)
                    _res_cur.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s", (conv_id,)
                    )
                    _res_cr = _res_cur.fetchone()
                finally:
                    _res_conn.rollback()
                    _release_connection(_res_conn)
                if _res_cr:
                    op_name = op.get('display_name', 'The agent') if op else 'The agent'
                    if return_to_bot:
                        emit_to_user(_res_cr['sender_id'], 'handoff_resolved', {
                            'conversation_id': conv_id,
                            'queue_id': queue_id,
                            'message': (
                                f"✅ {op_name} has closed the session. "
                                "I'm back to assist you. Is there anything else I can help with?"
                            ),
                            'return_to_bot': True,
                            'request_feedback': True,
                        })
                    else:
                        emit_to_user(_res_cr['sender_id'], 'handoff_resolved', {
                            'conversation_id': conv_id,
                            'queue_id': queue_id,
                            'message': "The session has been closed. Thank you.",
                            'return_to_bot': False,
                            'request_feedback': True,
                        })
            except Exception as _re:
                logger.warning(f"[SIO resolve] notify user error (non-fatal): {_re}")

            _s.sio.emit('queue_item_removed', {'queue_id': queue_id, 'status': 'resolved'},
                        room='queue_overview')
            emit_queue_overview()

            return jsonify({'success': True, 'return_to_bot': return_to_bot})
        finally:
            conn.rollback()
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_release(**kwargs):
    try:
        from datetime import datetime as _dt
        data     = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        reason   = data.get('reason', 'released')
        note     = data.get('note', '')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'waiting', operator_id = NULL, assigned_at = NULL "
                "WHERE id = %s AND operator_id = %s AND status = 'assigned' "
                "RETURNING conversation_id, app_id",
                (queue_id, op_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or not assigned to you'}), 409
            cursor.execute(
                "UPDATE conversations SET handoff_state = 'queued', assigned_operator_id = NULL "
                "WHERE id = %s",
                (row['conversation_id'],)
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, 'assigned', 'queued', 'operator', %s, %s)",
                (row['conversation_id'], str(op_id), note)
            )
            conn.commit()
            from common.conversation_db import _recalculate_queue_positions
            _recalculate_queue_positions(row['app_id'])

            try:
                _rel_conn = _get_connection()
                try:
                    from psycopg2.extras import RealDictCursor as _RLRC
                    _rel_cur = _rel_conn.cursor(cursor_factory=_RLRC)
                    _rel_cur.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    _rel_cr = _rel_cur.fetchone()
                finally:
                    _rel_conn.rollback()
                    _release_connection(_rel_conn)
                if _rel_cr:
                    emit_to_user(_rel_cr['sender_id'], 'handoff_queued', {
                        'conversation_id': row['conversation_id'],
                        'message': "⏳ The agent returned your chat to the queue. You'll be connected to the next available agent.",
                    })
            except Exception as _rle:
                logger.warning(f"[SIO release] notify user error (non-fatal): {_rle}")

            _s.sio.emit('queue_item_updated', {'queue_id': queue_id, 'status': 'waiting'},
                        room='queue_overview')
            emit_queue_overview()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_rate_context(**kwargs):
    try:
        data     = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        rating   = data.get('rating')
        note     = data.get('note', '')
        if not queue_id or rating is None:
            return jsonify({'error': 'queue_id and rating required'}), 400
        if not (1 <= int(rating) <= 5):
            return jsonify({'error': 'rating must be between 1 and 5'}), 400
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE handoff_queue SET agent_rating = %s, agent_rating_note = %s "
                "WHERE id = %s AND operator_id = %s",
                (int(rating), note, queue_id, kwargs['_operator_id'])
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Queue item not found or not yours'}), 404
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_get_conversation(conversation_id, **kwargs):
    try:
        from datetime import datetime as _dt
        from_time = request.args.get('from_time')
        to_time   = request.args.get('to_time')

        def _ts(s):
            if not s:
                return None
            try:
                return _dt.fromisoformat(s.replace('Z', '+00:00'))
            except Exception:
                return None

        ft = _ts(from_time)
        tt = _ts(to_time)

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            extra = ""
            params_base = [conversation_id]
            if ft:
                extra += " AND timestamp >= %s"
                params_base.append(ft)
            if tt:
                extra += " AND timestamp <= %s"
                params_base.append(tt)

            cursor.execute(
                f"SELECT sender, text, intent, timestamp FROM messages "
                f"WHERE conversation_id = %s AND sender != 'operator'{extra} "
                f"ORDER BY timestamp ASC",
                params_base
            )
            bot_msgs = [
                {**dict(m), 'source': 'chat',
                 'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
                for m in cursor.fetchall()
            ]

            op_params = [conversation_id]
            op_extra = ""
            if ft:
                op_extra += " AND om.sent_at >= %s"
                op_params.append(ft)
            if tt:
                op_extra += " AND om.sent_at <= %s"
                op_params.append(tt)

            cursor.execute(
                f"SELECT om.message_text AS text, om.sent_at AS timestamp, "
                f"o.display_name AS operator_name "
                f"FROM operator_messages om "
                f"JOIN operators o ON o.id = om.operator_id "
                f"WHERE om.conversation_id = %s{op_extra} ORDER BY om.sent_at ASC",
                op_params
            )
            op_msgs = [
                {'sender': 'operator', 'text': m['text'],
                 'operator_name': m['operator_name'], 'source': 'operator',
                 'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
                for m in cursor.fetchall()
            ]
        finally:
            conn.rollback()
            _release_connection(conn)

        all_msgs = sorted(bot_msgs + op_msgs, key=lambda x: x.get('timestamp') or '')
        return jsonify({'success': True, 'messages': all_msgs, 'count': len(all_msgs)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_send_message(**kwargs):
    try:
        from datetime import datetime as _dt
        data            = request.get_json(silent=True) or {}
        conversation_id = data.get('conversation_id')
        text            = (data.get('text') or '').strip()
        if not conversation_id or not text:
            return jsonify({'error': 'conversation_id and text required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id FROM handoff_queue "
                "WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'",
                (conversation_id, op_id)
            )
            q = cursor.fetchone()
            if not q:
                logger.warning(f"[OP SEND 403] no assigned row: conversation_id={conversation_id} operator_id={op_id}")
                return jsonify({'error': 'Not assigned to this conversation'}), 403

            cursor.execute(
                "INSERT INTO operator_messages "
                "(conversation_id, queue_id, operator_id, message_text) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (conversation_id, q['id'], op_id, text)
            )
            msg_id = cursor.fetchone()['id']
            # One timestamp for BOTH the DB row and the socket payload, so the
            # widget can dedup a message that arrives via socket vs. via backfill
            # (a mismatched now() would make the same message look like two).
            _msg_ts = _dt.now()
            cursor.execute(
                "INSERT INTO messages (conversation_id, sender, text, timestamp) "
                "VALUES (%s, 'operator', %s, %s)",
                (conversation_id, text, _msg_ts)
            )
            cursor.execute(
                "UPDATE conversations SET last_activity = %s WHERE id = %s",
                (_msg_ts, conversation_id)
            )
            cursor.execute(
                "SELECT sender_id FROM conversations WHERE id = %s", (conversation_id,)
            )
            _om_cr = cursor.fetchone()
            conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)

        if _om_cr:
            emit_to_user(_om_cr['sender_id'], 'operator_message', {
                'conversation_id': conversation_id,
                'message_id':      msg_id,
                'sender_id':       _om_cr['sender_id'],
                'text':            text,
                'timestamp':       _msg_ts.isoformat(),
            })
            _s.sio.emit('live_message', {
                'conversation_id': conversation_id,
                'sender':          'operator',
                'operator_id':     op_id,
                'text':            text,
                'timestamp':       _dt.now().isoformat(),
            }, room=_s._room_admin_watch(conversation_id))

        return jsonify({'success': True, 'message_id': msg_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_ai_draft(**kwargs):
    import requests as _req
    try:
        data            = request.get_json(silent=True) or {}
        conversation_id = data.get('conversation_id')
        if not conversation_id:
            return jsonify({'error': 'conversation_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT hq.id FROM handoff_queue hq "
                "WHERE hq.conversation_id = %s AND hq.operator_id = %s AND hq.status = 'assigned'",
                (conversation_id, kwargs['_operator_id'])
            )
            if not cursor.fetchone():
                return jsonify({'error': 'Not assigned to this conversation'}), 403

            # Get last user message AND the user's sender_id
            cursor.execute(
                "SELECT m.text, c.sender_id FROM messages m "
                "JOIN conversations c ON c.id = m.conversation_id "
                "WHERE m.conversation_id = %s AND m.sender = 'user' "
                "ORDER BY m.timestamp DESC LIMIT 1",
                (conversation_id,)
            )
            row = cursor.fetchone()
        finally:
            conn.rollback()
            _release_connection(conn)

        if not row or not row['text']:
            return jsonify({'draft': '', 'no_message': True})

        last_user_msg = row['text']
        sender_id     = row['sender_id']

        # Get the user's GLPI session token so the bot can make authenticated calls.
        # After login the widget creates a new senderId → the new Rasa conversation
        # has no session_token SLOT (login ran on the old senderId), but the widget
        # always sends session_token in message metadata.  Check both places.
        user_session_token = None
        try:
            tracker_resp = _req.get(
                f"{_s.RASA_URL}/conversations/{sender_id}/tracker",
                timeout=3
            )
            if tracker_resp.ok:
                tracker_data = tracker_resp.json()
                # 1. Slot (set when login happened on the same senderId)
                user_session_token = tracker_data.get('slots', {}).get('session_token')
                # 2. Latest message metadata (widget always sends token here)
                if not user_session_token:
                    meta = (tracker_data.get('latest_message') or {}).get('metadata') or {}
                    user_session_token = meta.get('session_token')
        except Exception:
            pass

        draft_sender = f"__draft__{conversation_id}"
        try:
            resp = _req.post(
                f"{_s.RASA_URL}/webhooks/rest/webhook",
                json={
                    'sender': draft_sender,
                    'message': last_user_msg,
                    'metadata': {'session_token': user_session_token} if user_session_token else {}
                },
                timeout=8,
            )
            resp.raise_for_status()
            responses = resp.json()
            _skip = (
                "I'm not sure I understand",
                "I didn't quite get that",
                "Login Required",
                "🔐",
                "please login",
                "log in",
                "To perform ticket",
            )
            filtered = []
            for r in responses:
                txt = (r.get('text') or '').strip()
                if not txt:
                    continue
                if any(s.lower() in txt.lower() for s in _skip):
                    continue
                filtered.append(txt)
            draft_text = ' '.join(filtered).strip()
        except Exception:
            draft_text = ''

        return jsonify({'draft': draft_text, 'source_message': last_user_msg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@require_operator_token
def operator_user_history(sender_id, **kwargs):
    try:
        limit = min(int(request.args.get('limit', 11)), 25)

        parts = sender_id.split('-')
        if len(parts) >= 3 and parts[0] == 'user':
            app_id_part    = parts[1]
            remaining      = parts[2:]
            if (len(remaining) > 1
                    and re.match(r'^[0-9a-z]{6,12}$', remaining[-1])):
                username_parts = remaining[:-1]
            else:
                username_parts = remaining
            username_part  = '-'.join(username_parts)
            sender_pattern = f"user-{app_id_part}-{username_part}%"
            use_pattern    = True
        else:
            sender_pattern = sender_id
            use_pattern    = False

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            where_clause = "c.sender_id LIKE %s" if use_pattern else "c.sender_id = %s"
            cursor.execute(
                f"""
                SELECT hq.id        AS queue_id,
                       hq.conversation_id,
                       hq.status    AS handoff_status,
                       hq.queued_at,
                       hq.resolved_at,
                       hq.abandoned_at,
                       hq.trigger_reason,
                       hq.closing_note,
                       c.app_id,
                       c.sender_id,
                       (SELECT text FROM messages
                        WHERE conversation_id = c.id AND sender = 'user'
                              AND timestamp >= hq.queued_at
                        ORDER BY timestamp ASC LIMIT 1) AS first_user_msg,
                       (SELECT intent FROM messages
                        WHERE conversation_id = c.id AND sender = 'user'
                              AND intent IS NOT NULL AND timestamp >= hq.queued_at
                        ORDER BY timestamp DESC LIMIT 1) AS last_intent
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE {where_clause}
                ORDER BY hq.queued_at DESC NULLS LAST
                LIMIT %s
                """,
                (sender_pattern, limit)
            )
            rows = cursor.fetchall()
        finally:
            conn.rollback()
            _release_connection(conn)

        history = []
        for r in rows:
            history.append({
                'queue_id':        r['queue_id'],
                'conversation_id': r['conversation_id'],
                'app_id':          r['app_id'] or 'General',
                'handoff_status':  r['handoff_status'],
                'queued_at':       r['queued_at'].isoformat() if r['queued_at'] else None,
                'resolved_at':     r['resolved_at'].isoformat() if r['resolved_at'] else None,
                'abandoned_at':    r['abandoned_at'].isoformat() if r['abandoned_at'] else None,
                'trigger_reason':  r['trigger_reason'],
                'closing_note':    r['closing_note'],
                'first_user_msg':  (r['first_user_msg'] or '')[:120],
                'last_intent':     r['last_intent'],
            })
        return jsonify({'success': True, 'history': history, 'count': len(history)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Operator transfer ─────────────────────────────────────────────────────────

@require_operator_token
def operator_online_list(**kwargs):
    """Return online operators (excluding self) for the transfer picker."""
    op_id = kwargs['_operator_id']
    conn = _get_connection()
    try:
        from psycopg2.extras import RealDictCursor
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, display_name, status,
                       (SELECT COUNT(*) FROM handoff_queue hq
                        WHERE hq.operator_id = o.id AND hq.status = 'assigned') AS current_load,
                       max_concurrent
                FROM operators o
                WHERE is_active = TRUE
                  AND status != 'offline'
                  AND (last_seen IS NULL OR EXTRACT(EPOCH FROM (NOW() - last_seen)) < 300)
                  AND id != %s
                ORDER BY display_name
            """, (op_id,))
            ops = [dict(r) for r in cur.fetchall()]
        return jsonify({'operators': ops})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


@require_operator_token
def operator_transfer_initiate(**kwargs):
    """Send a transfer request to another operator via Socket.IO."""
    op_id = kwargs['_operator_id']
    data = request.get_json(silent=True) or {}
    queue_id = data.get('queue_id')
    target_op_id = data.get('target_operator_id')
    if not queue_id or not target_op_id:
        return jsonify({'error': 'queue_id and target_operator_id required'}), 400

    conn = _get_connection()
    try:
        from psycopg2.extras import RealDictCursor
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT hq.conversation_id, hq.sender_id,
                       src.display_name AS from_op_name,
                       tgt.display_name AS target_op_name,
                       COALESCE(hq.context_package->'user_profile'->>'display_name', hq.sender_id) AS user_display_name
                FROM handoff_queue hq
                JOIN operators src ON src.id = %s
                JOIN operators tgt ON tgt.id = %s
                WHERE hq.id = %s AND hq.operator_id = %s AND hq.status = 'assigned'
            """, (op_id, target_op_id, queue_id, op_id))
            row = cur.fetchone()

        if not row:
            return jsonify({'error': 'Queue item not found or not assigned to you'}), 404

        emit_to_operator(target_op_id, 'transfer_request', {
            'queue_id': queue_id,
            'sender_id': row['sender_id'],
            'conversation_id': row['conversation_id'],
            'from_operator_id': op_id,
            'from_operator_name': row['from_op_name'],
            'user_display_name': row['user_display_name'],
        })
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)


@require_operator_token
def operator_transfer_respond(**kwargs):
    """Accept or reject an incoming transfer request."""
    op_id = kwargs['_operator_id']   # target (receiving) operator
    data = request.get_json(silent=True) or {}
    queue_id = data.get('queue_id')
    accept = data.get('accept', False)
    from_operator_id = data.get('from_operator_id')
    if not queue_id or from_operator_id is None:
        return jsonify({'error': 'queue_id and from_operator_id required'}), 400

    conn = _get_connection()
    try:
        from psycopg2.extras import RealDictCursor
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT display_name FROM operators WHERE id = %s", (op_id,))
            target_op = cur.fetchone()
            target_name = target_op['display_name'] if target_op else 'Operator'

            if not accept:
                emit_to_operator(from_operator_id, 'transfer_rejected', {
                    'queue_id': queue_id,
                    'by_operator_name': target_name,
                })
                return jsonify({'success': True, 'accepted': False})

            # Reassign the queue item to this operator
            cur.execute("""
                UPDATE handoff_queue
                SET operator_id = %s, assigned_at = NOW()
                WHERE id = %s AND status = 'assigned'
                RETURNING conversation_id, sender_id, app_id
            """, (op_id, queue_id))
            row = cur.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or already reassigned'}), 409

            cur.execute(
                "UPDATE conversations SET assigned_operator_id = %s WHERE id = %s",
                (op_id, row['conversation_id'])
            )
            cur.execute("""
                INSERT INTO handoff_state_log
                  (conversation_id, from_state, to_state, triggered_by, triggered_by_id, note)
                VALUES (%s, 'assigned', 'assigned', 'operator', %s, %s)
            """, (row['conversation_id'], str(op_id),
                  f'Transferred from operator {from_operator_id}'))
            conn.commit()

        # Notify source operator
        emit_to_operator(from_operator_id, 'transfer_accepted', {
            'queue_id': queue_id,
            'by_operator_name': target_name,
        })
        # Notify user
        emit_to_user(row['sender_id'], 'handoff_assigned', {
            'operator_name': target_name,
            'message': f'✅ You have been transferred to **{target_name}**.',
        })
        # Broadcast queue update
        _s.sio.emit('queue_item_updated', {'queue_id': queue_id, 'status': 'assigned'},
                    room='queue_overview')
        emit_queue_overview()

        return jsonify({'success': True, 'accepted': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.rollback()
        _release_connection(conn)
