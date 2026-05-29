/**
 * Admin Authentication Module
 * Handles login/logout and session management for admin dashboard
 */

const AdminAuth = {
    API_BASE: '/admin',
    SESSION_KEY: 'admin_session_token',
    USER_KEY: 'admin_user',

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!CookieUtils.get(this.SESSION_KEY);
    },

    /**
     * Get stored session token
     */
    getSessionToken() {
        return CookieUtils.get(this.SESSION_KEY);
    },

    /**
     * Get stored user info
     */
    getUser() {
        const userStr = CookieUtils.get(this.USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    },

    /**
     * Login with username and password
     */
    async login(username, password) {
        try {
            const response = await fetch(`${this.API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                CookieUtils.set(this.SESSION_KEY, data.session_token, { session: true });
                CookieUtils.set(this.USER_KEY, JSON.stringify(data.user), { session: true });
                // Clear chatbot user-auth cookies — admin users must not be auto-logged-in
                // as regular chat users when they open the chat widget in this browser.
                document.cookie.split('; ').forEach(function(c) {
                    var name = c.split('=')[0];
                    if (name.startsWith('glpi-chat-')) {
                        document.cookie = name + '=; path=/; max-age=0';
                    }
                });
                return { success: true, user: data.user };
            } else {
                return { success: false, error: data.error || 'Authentication failed' };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Connection error. Please try again.' };
        }
    },

    /**
     * Logout and clear session
     */
    async logout() {
        try {
            const token = this.getSessionToken();
            if (token) {
                await fetch(`${this.API_BASE}/logout`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Token': token
                    },
                    body: JSON.stringify({ session_token: token })
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            CookieUtils.delete(this.SESSION_KEY);
            CookieUtils.delete(this.USER_KEY);
            this.showLoginOverlay();
        }
    },

    /**
     * Verify existing session on page load
     */
    async verifySession() {
        const token = this.getSessionToken();
        if (!token) {
            return false;
        }

        try {
            const response = await fetch(`${this.API_BASE}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': token
                },
                body: JSON.stringify({ session_token: token })
            });

            const data = await response.json();
            if (data.valid) {
                CookieUtils.set(this.USER_KEY, JSON.stringify(data.user), { session: true });
                return true;
            }
        } catch (error) {
            console.error('Session verify error:', error);
        }

        // Session invalid - clear and show login
        CookieUtils.delete(this.SESSION_KEY);
        CookieUtils.delete(this.USER_KEY);
        return false;
    },

    /**
     * Show login overlay
     */
    showLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        const content = document.getElementById('main-content');
        if (overlay) overlay.classList.remove('hidden');
        if (content) content.classList.add('hidden');
    },

    /**
     * Hide login overlay and show content
     */
    hideLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        const content = document.getElementById('main-content');
        if (overlay) overlay.classList.add('hidden');
        if (content) content.classList.remove('hidden');

        // Update user display
        const user = this.getUser();
        const userDisplay = document.getElementById('user-display');
        if (userDisplay && user) {
            userDisplay.textContent = user.firstname || user.name || 'Admin';
        }
        const userDisplayTop = document.getElementById('user-display-top');
        if (userDisplayTop && user) {
            userDisplayTop.textContent = user.firstname || user.name || 'Admin';
        }
    },

    /**
     * Initialize auth - call on page load
     */
    async init() {
        const isValid = await this.verifySession();
        if (isValid) {
            this.hideLoginOverlay();
        } else {
            this.showLoginOverlay();
        }
    }
};

// Login form handler
function handleLoginSubmit(event) {
    event.preventDefault();

    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');

    if (!username || !password) {
        errorDiv.textContent = 'Please enter both username and password';
        errorDiv.classList.remove('hidden');
        return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    errorDiv.classList.add('hidden');

    AdminAuth.login(username, password).then(result => {
        if (result.success) {
            AdminAuth.hideLoginOverlay();
            // Reload analytics data
            if (typeof loadAnalyticsData === 'function') {
                loadAnalyticsData();
            }
        } else {
            errorDiv.textContent = result.error;
            errorDiv.classList.remove('hidden');
        }
    }).finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
    });
}

// Logout handler
function handleLogout() {
    AdminAuth.logout();
}

// Load and display the active profile badge
async function loadProfileBadge() {
    try {
        const res = await fetch('/admin/profile');
        const data = await res.json();
        const badge = document.getElementById('profile-badge');
        if (!badge) return;
        if (data.is_prod) {
            badge.textContent = 'PROD';
            badge.className = 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700';
        } else {
            badge.textContent = 'LOCAL';
            badge.className = 'ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700';
        }
    } catch (e) { /* badge stays as default */ }
}

// ── IAM Login — pure PKCE, no external library needed ────────────────────────
const AdminIam = {
    IAM_URL:   'https://id.dev.iam.99technologies.com',
    REALM:     '99-iam',
    CLIENT_ID: 'project-iq',

    _tokenBase() { return `${this.IAM_URL}/realms/${this.REALM}/protocol/openid-connect`; },

    // ── PKCE helpers ──────────────────────────────────────────────────────────
    _random() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    },
    async _challenge(verifier) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    },

    // ── Start login — redirect to Keycloak ────────────────────────────────────
    async login() {
        const verifier   = this._random();
        const challenge  = await this._challenge(verifier);
        const state      = this._random();
        const redirectUri = window.location.origin + window.location.pathname;

        sessionStorage.setItem('iam_verifier',    verifier);
        sessionStorage.setItem('iam_state',        state);
        sessionStorage.setItem('iam_redirect_uri', redirectUri);

        const params = new URLSearchParams({
            client_id:             this.CLIENT_ID,
            response_type:         'code',
            redirect_uri:          redirectUri,
            scope:                 'openid profile email',
            state,
            code_challenge:        challenge,
            code_challenge_method: 'S256',
        });
        window.location.href = `${this._tokenBase()}/auth?${params}`;
    },

    // ── Handle callback — exchange code for token ─────────────────────────────
    async handleCallback() {
        const p = new URLSearchParams(window.location.search);
        const code     = p.get('code');
        const state    = p.get('state');
        const verifier = sessionStorage.getItem('iam_verifier');
        const savedState  = sessionStorage.getItem('iam_state');
        const redirectUri = sessionStorage.getItem('iam_redirect_uri');

        if (!code || !verifier) return false;
        if (state !== savedState) { console.error('[IAM] state mismatch'); return false; }

        sessionStorage.removeItem('iam_verifier');
        sessionStorage.removeItem('iam_state');
        sessionStorage.removeItem('iam_redirect_uri');

        // Clean URL
        history.replaceState({}, '', window.location.pathname);

        const btn = document.getElementById('iam-login-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

        try {
            // Exchange code for token directly
            const tokenRes = await fetch(`${this._tokenBase()}/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type:    'authorization_code',
                    client_id:     this.CLIENT_ID,
                    code,
                    redirect_uri:  redirectUri,
                    code_verifier: verifier,
                }),
            });
            const tokens = await tokenRes.json();
            if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed');

            // Send token to our backend
            await this.exchangeToken(tokens.access_token);
            return true;
        } catch (e) {
            const err = document.getElementById('login-error');
            if (err) { err.textContent = e.message; err.classList.remove('hidden'); }
            return false;
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Sign in with IAM'; }
        }
    },

    async exchangeToken(iamToken) {
        const res  = await fetch('/admin/iam-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${iamToken}` },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.success) {
            CookieUtils.set(AdminAuth.SESSION_KEY, data.session_token, { session: true });
            CookieUtils.set(AdminAuth.USER_KEY, JSON.stringify(data.user), { session: true });
            AdminAuth.hideLoginOverlay();
            if (typeof loadAnalyticsData === 'function') loadAnalyticsData();
        } else {
            throw new Error(data.error || 'Access denied');
        }
    },

    init() {
        // Show any IAM error returned by the server callback
        const qErr = new URLSearchParams(window.location.search).get('iam_error');
        if (qErr) {
            const err = document.getElementById('login-error');
            if (err) { err.textContent = decodeURIComponent(qErr); err.classList.remove('hidden'); }
            history.replaceState({}, '', window.location.pathname);
        }
    },
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    const valid = await AdminAuth.init();
    if (!valid) AdminIam.init();
    loadProfileBadge();
});
