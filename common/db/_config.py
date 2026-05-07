"""
common.db._config — app config, themes, KB articles, handoff runtime config.
"""
import json
from datetime import datetime
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection


# ── App config ────────────────────────────────────────────────────────────────

def get_config(key: str = None) -> Dict:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if key:
            cursor.execute('SELECT key, value FROM config WHERE key=%s', (key,))
            row = cursor.fetchone()
            return {row['key']: row['value']} if row else {}
        cursor.execute('SELECT key, value FROM config')
        return {row['key']: row['value'] for row in cursor.fetchall()}
    finally:
        _release_connection(conn)


def set_config(key: str, value: str):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO config (key, value, updated_at) VALUES (%s,%s,%s) "
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at",
            (key, value, datetime.now())
        )
        conn.commit()
    finally:
        _release_connection(conn)


def set_config_bulk(config_dict: Dict):
    for key, value in config_dict.items():
        set_config(key, str(value) if value is not None else '')


# ── Themes ────────────────────────────────────────────────────────────────────

def _fmt_theme(row) -> Dict:
    t = dict(row)
    for f in ('created_at', 'updated_at'):
        if t.get(f): t[f] = t[f].isoformat()
    return t


def get_themes() -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM themes ORDER BY created_at DESC')
        return [_fmt_theme(r) for r in cursor.fetchall()]
    finally:
        _release_connection(conn)


def get_theme(theme_id: int) -> Optional[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM themes WHERE id=%s', (theme_id,))
        row = cursor.fetchone()
        return _fmt_theme(row) if row else None
    finally:
        _release_connection(conn)


def create_theme(name: str, settings: str, is_default: bool = False) -> int:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if is_default:
            cursor.execute('UPDATE themes SET is_default=0')
        cursor.execute(
            'INSERT INTO themes (name, settings, is_default, created_at, updated_at) '
            'VALUES (%s,%s,%s,%s,%s) RETURNING id',
            (name, settings, 1 if is_default else 0, datetime.now(), datetime.now())
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_theme(theme_id: int, name: str = None, settings: str = None, is_default: bool = None):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        updates, params = [], []
        if name is not None: updates.append('name=%s'); params.append(name)
        if settings is not None: updates.append('settings=%s'); params.append(settings)
        if is_default is not None:
            if is_default: cursor.execute('UPDATE themes SET is_default=0')
            updates.append('is_default=%s'); params.append(1 if is_default else 0)
        if updates:
            updates.append('updated_at=%s'); params.append(datetime.now()); params.append(theme_id)
            cursor.execute(f'UPDATE themes SET {", ".join(updates)} WHERE id=%s', params)
            conn.commit()
    finally:
        _release_connection(conn)


def delete_theme(theme_id: int):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM themes WHERE id=%s', (theme_id,))
        conn.commit()
    finally:
        _release_connection(conn)


def get_default_theme() -> Optional[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM themes WHERE is_default=1 LIMIT 1')
        row = cursor.fetchone()
        return _fmt_theme(row) if row else None
    finally:
        _release_connection(conn)


# ── KB articles ───────────────────────────────────────────────────────────────

def add_kb_article(article_id: str, title: str, content: str, category: str = None,
                   keywords: List[str] = None, question: str = None) -> bool:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO kb_articles (id, title, content, category, keywords, question, updated_at) '
            'VALUES (%s,%s,%s,%s,%s,%s,%s) '
            'ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, '
            'category=EXCLUDED.category, keywords=EXCLUDED.keywords, question=EXCLUDED.question, '
            'updated_at=EXCLUDED.updated_at',
            (article_id, title, content, category,
             json.dumps(keywords) if keywords else '[]', question, datetime.now())
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error saving KB article {article_id}: {e}")
        conn.rollback()
        return False
    finally:
        _release_connection(conn)


def get_all_kb_articles() -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM kb_articles')
        articles = []
        for row in cursor.fetchall():
            a = dict(row)
            try: a['keywords'] = json.loads(a['keywords']) if a.get('keywords') else []
            except: a['keywords'] = []
            for f in ('created_at', 'updated_at'):
                if a.get(f): a[f] = a[f].isoformat()
            articles.append(a)
        return articles
    finally:
        _release_connection(conn)


# ── Handoff runtime config ────────────────────────────────────────────────────

_HANDOFF_RUNTIME_DEFAULTS = {
    "triggers": {
        "confidence_threshold": 0.40, "confidence_streak_required": 2,
        "frustration_threshold": 0.75, "frustration_streak_required": 2,
        "direct_handoff_intents": []
    },
    "queue": {
        "priority_boost_interval_mins": 5, "ask_user_after_mins": 15,
        "hard_timeout_mins": 30, "timeout_action": "ask_user",
        "max_queue_depth": 50, "default_priority": 5
    },
    "operators": {"default_max_concurrent": 3, "auto_busy_on_max_load": True},
    "availability": {
        "no_agents_action": "offer_ticket", "after_hours_action": "create_ticket",
        "working_hours": {
            "timezone": "UTC",
            "monday": "00:00-23:59", "tuesday": "00:00-23:59", "wednesday": "00:00-23:59",
            "thursday": "00:00-23:59", "friday": "00:00-23:59",
            "saturday": "00:00-23:59", "sunday": "00:00-23:59"
        }
    },
    "gdpr": {
        "consent_required": True, "admin_can_skip_consent": True,
        "mask_passwords": True, "mask_card_numbers": True, "mask_ibans": True,
        "mask_emails": False, "consent_version": "1.0"
    },
    "glpi": {"auto_create_ticket_on_handoff": False},
    "transcript": {"allow_user_download": True, "allow_user_email": True, "retention_days": 365},
    "ai_summary": {"mode": "rule_based", "max_turns_in_summary": 20}
}


def _deep_merge(base: Dict, override: Dict) -> Dict:
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def get_handoff_runtime_config() -> Dict:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT value FROM config WHERE key='handoff_settings'")
        row = cursor.fetchone()
        if row and row['value']:
            return _deep_merge(_HANDOFF_RUNTIME_DEFAULTS, json.loads(row['value']))
        cursor.execute(
            "INSERT INTO config (key, value, updated_at) VALUES ('handoff_settings',%s,%s) "
            "ON CONFLICT (key) DO NOTHING",
            (json.dumps(_HANDOFF_RUNTIME_DEFAULTS), datetime.now())
        )
        conn.commit()
        return dict(_HANDOFF_RUNTIME_DEFAULTS)
    finally:
        _release_connection(conn)


def set_handoff_runtime_config(settings: Dict) -> bool:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO config (key, value, updated_at) VALUES ('handoff_settings',%s,%s) "
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at",
            (json.dumps(settings), datetime.now())
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error saving handoff runtime config: {e}")
        conn.rollback()
        return False
    finally:
        _release_connection(conn)
