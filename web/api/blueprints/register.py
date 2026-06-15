"""
Blueprint registration for Project IQ Admin API.

ACTIVATION GUIDE
================
To activate the blueprints:

1. In admin_api.py, find and call register_blueprints(app) near the bottom,
   AFTER all helper functions and globals are defined, BEFORE the
   background thread startup.

2. For each route now in a blueprint, comment out or remove the
   corresponding @app.route decorator in admin_api.py. The blueprint
   route takes over. If both are active Flask raises a duplicate-endpoint error.

   Priority order (do these first — they have full implementations in blueprints
   and no dependency on admin_api.py functions):
     - bp_static    : all static file routes
     - bp_system    : /health, /admin/health, /api/rasa/*
     - bp_auth      : /admin/login|logout|verify, /operator/login|logout|token
     - bp_admin_config : /admin/config/*, /admin/themes/*
     - bp_analytics : /admin/analytics/*, /analytics/satisfaction
     - bp_kb        : /admin/kb/*, /admin/firecrawl/*, /admin/connectors/*
     - bp_user_api  : /api/user/*

   These blueprints forward to admin_api.py functions (keep those functions
   in admin_api.py but remove their @app.route decorators):
     - bp_operator (queue/claim/resolve/release/message/conversation)
     - bp_internal (enqueue, available)
     - bp_admin_ops (operators CRUD, handoff config, observability, api/status)
     - bp_studio_inspector (studio + inspector — no admin_api dependency)
     - bp_chat (handoff/status, handoff/end are self-contained; webhook is self-contained)

3. Test after each group — verify the server starts and routes respond correctly.

IMPORTANT: The blueprints in bp_operator.py and bp_admin_ops.py use deferred
imports (import web.api.admin_api as _m) for complex routes. This works
because those functions are called AFTER admin_api.py is fully loaded.
"""

from flask import Flask


def register_blueprints(app: Flask) -> None:
    """Register all blueprints on the Flask app."""
    from web.api.blueprints.bp_static           import bp as bp_static
    from web.api.blueprints.bp_system           import bp as bp_system
    from web.api.blueprints.bp_auth             import bp as bp_auth
    from web.api.blueprints.bp_admin_config     import bp as bp_admin_config
    from web.api.blueprints.bp_analytics        import bp as bp_analytics
    from web.api.blueprints.bp_kb               import bp as bp_kb
    from web.api.blueprints.bp_studio_inspector import bp as bp_studio_inspector
    from web.api.blueprints.bp_user_api         import bp as bp_user_api
    from web.api.blueprints.bp_chat             import bp as bp_chat
    from web.api.blueprints.bp_operator         import bp as bp_operator
    from web.api.blueprints.bp_internal         import bp as bp_internal
    from web.api.blueprints.bp_admin_ops        import bp as bp_admin_ops
    from web.api.blueprints.bp_sessions         import bp as bp_sessions
    from web.api.blueprints.bp_notifications    import bp as bp_notifications
    from web.api.blueprints.bp_ticket_attachment  import bp as bp_ticket_attachment
    from web.api.blueprints.bp_portal_api         import bp as bp_portal_api
    from web.api.blueprints.bp_itsm_proxy         import bp as bp_itsm_proxy

    # Register in dependency order — most specific first to avoid catch-all conflicts
    app.register_blueprint(bp_portal_api)
    app.register_blueprint(bp_itsm_proxy)
    app.register_blueprint(bp_ticket_attachment)
    app.register_blueprint(bp_notifications)
    app.register_blueprint(bp_auth)
    app.register_blueprint(bp_system)
    app.register_blueprint(bp_admin_config)
    app.register_blueprint(bp_analytics)
    app.register_blueprint(bp_kb)
    app.register_blueprint(bp_studio_inspector)
    app.register_blueprint(bp_user_api)
    app.register_blueprint(bp_chat)
    app.register_blueprint(bp_operator)
    app.register_blueprint(bp_internal)
    app.register_blueprint(bp_admin_ops)
    app.register_blueprint(bp_sessions)
    # Static files last — its /<path:filename> catch-all must not shadow API routes
    app.register_blueprint(bp_static)

    print(f"[Blueprints] Registered {len(app.blueprints)} blueprints, "
          f"{len(app.url_map._rules)} total rules")
