"""
Static file serving blueprint.

Canonical URLs:
  /bot       — chatbot widget
  /admin     — admin panel  (public/admin/)
  /opt       — operator console  (public/operator/)
  /          — redirects to /bot
"""
import os
from flask import Blueprint, send_from_directory, redirect
import web.api.shared as _s

bp = Blueprint('static_files', __name__)


@bp.after_request
def _no_cache(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


def _web_dir():
    return os.path.join(_s.STATIC_DIR, 'web')

def _operator_dir():
    return os.path.join(_s.STATIC_DIR, 'operator')


# ── Canonical app routes ──────────────────────────────────────────────────────

@bp.route('/')
def serve_root():
    return redirect('/bot', code=302)

@bp.route('/bot')
def serve_bot():
    return send_from_directory(_s.WIDGET_DIR, 'it.html')

@bp.route('/admin')
def serve_admin_redirect():
    return redirect('/admin/', code=302)

@bp.route('/admin/')
def serve_admin():
    return send_from_directory(_web_dir(), 'index.html')

@bp.route('/opt')
def serve_opt_redirect():
    return redirect('/opt/', code=302)

@bp.route('/opt/')
def serve_opt():
    resp = send_from_directory(_operator_dir(), 'index.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


# ── Static asset fallback ─────────────────────────────────────────────────────
# Serves: /web/js/*.js  /web/components/*.html  /operator/*
#         /glpi-chat-widget.js  /modern-web-interface.css  /assets/*

@bp.route('/<path:filename>')
def serve_static_assets(filename):
    public_path = os.path.join(_s.STATIC_DIR, filename)
    if os.path.exists(public_path):
        return send_from_directory(_s.STATIC_DIR, filename)
    widget_path = os.path.join(_s.WIDGET_DIR, filename)
    if os.path.exists(widget_path):
        return send_from_directory(_s.WIDGET_DIR, filename)
    return 'Not found', 404
