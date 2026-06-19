"""
Static file serving blueprint.

Canonical URLs:
  /bot       — chatbot widget
  /portal    — unified admin/operator/member portal (React SPA)
  /itsm      — standalone ITSM app, IAM login, tenant-scoped (React SPA)
  /admin     — redirects to /portal/admin  (301)
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


def _operator_dir():
    return os.path.join(_s.STATIC_DIR, 'operator')


# ── Canonical app routes ──────────────────────────────────────────────────────

@bp.route('/')
def serve_root():
    return redirect('/bot', code=302)

@bp.route('/bot')
def serve_bot():
    return send_from_directory(_s.WIDGET_DIR, 'bot.html')

# Keycloak silent-SSO helper. Apps (widget/portal/itsm) init Keycloak with
# silentCheckSsoRedirectUri = <origin>/silent-check-sso.html; without this route
# it 404s, breaking silent SSO — so the iframe'd chatbot can't see the existing
# session and every authenticated feature reports "Authentication required".
@bp.route('/silent-check-sso.html')
def serve_silent_check_sso():
    return send_from_directory(_s.WIDGET_DIR, 'silent-check-sso.html')

@bp.route('/admin')
@bp.route('/admin/')
def serve_admin_redirect():
    return redirect('/portal/admin', code=301)

@bp.route('/opt')
def serve_opt_redirect():
    return redirect('/opt/', code=302)

@bp.route('/opt/')
def serve_opt():
    resp = send_from_directory(_operator_dir(), 'index.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp


# ── Portal SPA ───────────────────────────────────────────────────────────────
# Serves the React portal built by `npm run build:portal`.
# All non-asset /portal/* paths serve portal.html (client-side routing).

def _serve_portal_shell():
    # portal.html references content-hashed assets; force revalidation on the
    # shell so a rebuild is picked up immediately (hashed assets stay cacheable).
    resp = send_from_directory(os.path.join(_s.STATIC_DIR, 'portal'), 'portal.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@bp.route('/portal')
@bp.route('/portal/')
def serve_portal_root():
    return _serve_portal_shell()

@bp.route('/portal/<path:path>')
def serve_portal(path):
    portal_dir = os.path.join(_s.STATIC_DIR, 'portal')
    candidate  = os.path.join(portal_dir, path)
    if os.path.isfile(candidate) and not path.endswith('.html'):
        return send_from_directory(portal_dir, path)
    return _serve_portal_shell()


# ── Standalone ITSM SPA ──────────────────────────────────────────────────────
# Serves the React app built by `npm run build:itsm`. IAM-authenticated,
# tenant-scoped (org/tenant admins). All non-asset /itsm/* paths serve
# itsm.html (client-side routing).

def _serve_itsm_shell():
    # itsm.html references content-hashed asset filenames (itsm-<hash>.js/css).
    # If the browser caches this shell, it keeps loading a stale hash after a
    # rebuild — so force revalidation on the shell while the hashed assets
    # below remain freely cacheable (their filename changes when content does).
    resp = send_from_directory(os.path.join(_s.STATIC_DIR, 'itsm'), 'itsm.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return resp

@bp.route('/itsm')
@bp.route('/itsm/')
def serve_itsm_root():
    return _serve_itsm_shell()

@bp.route('/itsm/<path:path>')
def serve_itsm(path):
    itsm_dir  = os.path.join(_s.STATIC_DIR, 'itsm')
    candidate = os.path.join(itsm_dir, path)
    if os.path.isfile(candidate) and not path.endswith('.html'):
        return send_from_directory(itsm_dir, path)
    return _serve_itsm_shell()


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
