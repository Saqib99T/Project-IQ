"""
Portal API — admin/reporting endpoints (queue+operator stats, analytics,
operator roster, org directory, resolved-session history, IAM user
management). Split out of what used to be a single 1,685-line
bp_portal_api.py — see docs/ARCHITECTURE_REVIEW.md H-04. Operator-facing
endpoints (queue, live chat, canned responses) live in bp_portal_operator.py;
both blueprints share the same url_prefix, so every URL path is unchanged
by the split.

All routes require a valid Keycloak Bearer token (require_iam_token).
"""
from flask import Blueprint, request, jsonify, g
import web.api.shared as _s

bp = Blueprint('portal_admin_api', __name__, url_prefix='/portal/api')


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
