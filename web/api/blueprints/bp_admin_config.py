"""
Admin configuration and themes blueprint.
Routes: /admin/profile, /admin/config/*, /admin/themes/*
"""
import json
from flask import Blueprint, request, jsonify
from common.conversation_db import (
    get_themes, get_theme, create_theme, update_theme, delete_theme, get_default_theme
)
from common.config_manager import get_all_config as get_file_config, set_all_config as save_file_config, get_profile

bp = Blueprint('admin_config', __name__)

_DEFAULT_CONFIG_KEYS = [
    'RASA_API_URL',
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'WIDGET_TITLE', 'WIDGET_SUBTITLE', 'FIRECRAWL_API_KEY', 'FIRECRAWL_API_URL',
    'SESSION_TIMEOUT_MINUTES', 'SESSION_WARNING_MINUTES',
]


@bp.route('/admin/config', methods=['GET'])
def get_all_config():
    try:
        config = get_file_config()
        for key in _DEFAULT_CONFIG_KEYS:
            if key not in config:
                config[key] = ''
        config['_profile'] = get_profile()
        return jsonify({"success": True, "config": config})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/config', methods=['POST'])
def save_config():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        save_file_config(data)
        return jsonify({"success": True, "message": "Configuration saved"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/config/<key>', methods=['GET'])
def get_config_key(key):
    try:
        config = get_file_config()
        return jsonify({"success": True, "value": config.get(key, '')})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/config/<key>', methods=['POST'])
def set_config_key(key):
    try:
        data  = request.get_json() or {}
        value = data.get('value', '')
        save_file_config({key: value})
        return jsonify({"success": True, "message": f"{key} saved"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── Themes ────────────────────────────────────────────────────────────────────

@bp.route('/admin/themes', methods=['GET'])
def list_themes():
    try:
        from common.redis_cache import cache as _rc
        cached = _rc.get('admin_themes')
        if cached is not None:
            return jsonify({"success": True, "themes": cached})
        themes = get_themes()
        for t in themes:
            if t.get('settings'):
                try:
                    t['settings'] = json.loads(t['settings'])
                except Exception:
                    pass
        _rc.set('admin_themes', themes, ttl=300)
        return jsonify({"success": True, "themes": themes})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/themes', methods=['POST'])
def add_theme():
    try:
        data         = request.get_json() or {}
        name         = data.get('name', 'Untitled Theme')
        settings     = data.get('settings', {})
        is_default   = data.get('is_default', False)
        settings_json = json.dumps(settings) if isinstance(settings, dict) else settings
        theme_id     = create_theme(name, settings_json, is_default)
        from common.redis_cache import cache as _rc; _rc.delete('admin_themes')
        return jsonify({"success": True, "theme_id": theme_id, "message": "Theme created"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/themes/<int:theme_id>', methods=['GET'])
def get_theme_by_id(theme_id):
    try:
        theme = get_theme(theme_id)
        if not theme:
            return jsonify({"success": False, "error": "Theme not found"}), 404
        if theme.get('settings'):
            try:
                theme['settings'] = json.loads(theme['settings'])
            except Exception:
                pass
        return jsonify({"success": True, "theme": theme})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/themes/<int:theme_id>', methods=['PUT'])
def modify_theme(theme_id):
    try:
        data          = request.get_json() or {}
        settings      = data.get('settings')
        settings_json = json.dumps(settings) if isinstance(settings, dict) else settings if settings is not None else None
        update_theme(theme_id, data.get('name'), settings_json, data.get('is_default'))
        from common.redis_cache import cache as _rc; _rc.delete('admin_themes')
        return jsonify({"success": True, "message": "Theme updated"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/themes/<int:theme_id>', methods=['DELETE'])
def remove_theme(theme_id):
    try:
        delete_theme(theme_id)
        from common.redis_cache import cache as _rc; _rc.delete('admin_themes')
        return jsonify({"success": True, "message": "Theme deleted"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/themes/default', methods=['GET'])
def get_default():
    try:
        theme = get_default_theme()
        if theme and theme.get('settings'):
            try:
                theme['settings'] = json.loads(theme['settings'])
            except Exception:
                pass
        return jsonify({"success": True, "theme": theme})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
