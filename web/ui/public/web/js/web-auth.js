/**
 * Admin Authentication — IAM (Keycloak) only.
 * GLPI / local password login has been removed.
 */

const AdminAuth = {
    API_BASE:    '/admin',
    SESSION_KEY: 'admin_session_token',
    USER_KEY:    'admin_user',

    isAuthenticated() { return !!CookieUtils.get(this.SESSION_KEY); },
    getSessionToken()  { return CookieUtils.get(this.SESSION_KEY); },
    getUser() {
        const s = CookieUtils.get(this.USER_KEY);
        return s ? JSON.parse(s) : null;
    },

    async logout() {
        const token = this.getSessionToken();
        if (token) {
            await fetch(`${this.API_BASE}/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
                body: JSON.stringify({ session_token: token }),
            }).catch(() => {});
        }
        CookieUtils.delete(this.SESSION_KEY);
        CookieUtils.delete(this.USER_KEY);
        this.showLoginOverlay();
    },

    async verifySession() {
        const token = this.getSessionToken();
        if (!token) return false;
        try {
            const res  = await fetch(`${this.API_BASE}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
                body: JSON.stringify({ session_token: token }),
            });
            const data = await res.json();
            if (data.valid) {
                CookieUtils.set(this.USER_KEY, JSON.stringify(data.user), { session: true });
                return true;
            }
        } catch { /* network error */ }
        CookieUtils.delete(this.SESSION_KEY);
        CookieUtils.delete(this.USER_KEY);
        return false;
    },

    showLoginOverlay() {
        document.getElementById('login-overlay')?.classList.remove('hidden');
        document.getElementById('main-content')?.classList.add('hidden');
    },

    hideLoginOverlay() {
        document.getElementById('login-overlay')?.classList.add('hidden');
        document.getElementById('main-content')?.classList.remove('hidden');
        const user = this.getUser();
        const name = user?.firstname || user?.name || 'Admin';
        document.getElementById('user-display')    && (document.getElementById('user-display').textContent    = name);
        document.getElementById('user-display-top') && (document.getElementById('user-display-top').textContent = name);
    },

    async init() {
        return await this.verifySession();
    },
};


// ── IAM PKCE (client-side) ───────────────────────────────────────────────────
const AdminIam = {
    _tokenBase() {
        const cfg = window.__IAM_CONFIG__ || {
            url:      'https://id.dev.iam.99technologies.com',
            realm:    '99-iam',
            clientId: 'project-iq',
        };
        return `${cfg.url}/realms/${cfg.realm}/protocol/openid-connect`;
    },

    _random() {
        const a = new Uint8Array(32);
        crypto.getRandomValues(a);
        return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    },
    async _challenge(v) {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
        return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    },

    async login() {
        const verifier   = this._random();
        const challenge  = await this._challenge(verifier);
        const state      = this._random();
        const redirectUri = window.location.origin + window.location.pathname;
        sessionStorage.setItem('iam_verifier',    verifier);
        sessionStorage.setItem('iam_state',        state);
        sessionStorage.setItem('iam_redirect_uri', redirectUri);
        const p = new URLSearchParams({
            client_id: 'project-iq', response_type: 'code',
            redirect_uri: redirectUri, scope: 'openid profile email',
            state, code_challenge: challenge, code_challenge_method: 'S256',
        });
        window.location.href = `${this._tokenBase()}/auth?${p}`;
    },

    async handleCallback() {
        const p        = new URLSearchParams(window.location.search);
        const code     = p.get('code');
        const state    = p.get('state');
        const verifier = sessionStorage.getItem('iam_verifier');
        const saved    = sessionStorage.getItem('iam_state');
        const redir    = sessionStorage.getItem('iam_redirect_uri');
        if (!code || !verifier) return false;
        if (state !== saved) { console.error('[IAM] state mismatch'); return false; }
        sessionStorage.removeItem('iam_verifier');
        sessionStorage.removeItem('iam_state');
        sessionStorage.removeItem('iam_redirect_uri');
        history.replaceState({}, '', window.location.pathname);

        const btn = document.getElementById('iam-login-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
        try {
            const tokRes = await fetch(`${this._tokenBase()}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code', client_id: 'project-iq',
                    code, redirect_uri: redir, code_verifier: verifier,
                }),
            });
            const tokens = await tokRes.json();
            if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed');
            await this._createSession(tokens.access_token);
            return true;
        } catch (e) {
            const err = document.getElementById('login-error');
            if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
            return false;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Sign in with IAM'; }
        }
    },

    async _createSession(iamToken) {
        const res  = await fetch('/admin/iam-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${iamToken}` },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Access denied');
        CookieUtils.set(AdminAuth.SESSION_KEY, data.session_token, { session: true });
        CookieUtils.set(AdminAuth.USER_KEY, JSON.stringify(data.user), { session: true });
        AdminAuth.hideLoginOverlay();
        if (typeof loadAnalyticsData === 'function') loadAnalyticsData();
    },

    showError(msg) {
        const el = document.getElementById('login-error');
        if (el) { el.textContent = msg; el.classList.remove('hidden'); }
        history.replaceState({}, '', window.location.pathname);
    },
};


// ── Logout handler (called from sidebar button) ───────────────────────────────
function handleLogout() { AdminAuth.logout(); }


// ── Profile badge ─────────────────────────────────────────────────────────────
async function loadProfileBadge() {
    try {
        const data  = await (await fetch('/admin/profile')).json();
        const badge = document.getElementById('profile-badge');
        if (!badge) return;
        badge.textContent = data.is_prod ? 'PROD' : 'LOCAL';
        badge.className   = data.is_prod
            ? 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700'
            : 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700';
    } catch { /* non-fatal */ }
}


// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // 1. If Keycloak redirected back with ?iam_error=...
    const qErr = new URLSearchParams(window.location.search).get('iam_error');
    if (qErr) { AdminIam.showError(decodeURIComponent(qErr)); }

    // 2. If Keycloak redirected back with ?code=... (client-side PKCE flow)
    if (new URLSearchParams(window.location.search).has('code')) {
        const ok = await AdminIam.handleCallback();
        if (ok) { loadProfileBadge(); return; }
    }

    // 3. Check existing session cookie
    const valid = await AdminAuth.init();
    if (valid) {
        AdminAuth.hideLoginOverlay();
    } else {
        AdminAuth.showLoginOverlay();
    }
    loadProfileBadge();
});
