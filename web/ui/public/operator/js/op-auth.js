// ═══════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════════════════════

/**
 * Clear all chatbot user-auth cookies so that an operator who previously
 * used the chat widget in the same browser is not auto-logged-in as a
 * regular user when they open the widget while working as an operator.
 */
function _clearChatbotSessions() {
  document.cookie.split('; ').forEach(function(c) {
    var name = c.split('=')[0];
    if (name.startsWith('glpi-chat-')) {
      document.cookie = name + '=; path=/; max-age=0';
    }
  });
}

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  try {
    const r = await apiFetch('/operator/login', 'POST', { username, password }, false);
    if (!r.ok) {
      const d = await r.json();
      errEl.textContent = d.error || 'Login failed';
      errEl.classList.remove('hidden');
      return;
    }
    const d = await r.json();
    _token  = d.token;
    _opId   = d.operator_id;
    _opName = d.display_name;
    localStorage.setItem('op_token',  _token);
    localStorage.setItem('op_id',     _opId);
    localStorage.setItem('op_name',   _opName);
    _clearChatbotSessions();  // prevent chatbot from auto-logging-in this operator as a user
    startApp();
  } catch(err) {
    errEl.textContent = 'Network error — is the server running?';
    errEl.classList.remove('hidden');
  }
}

async function doLogout() {
  try { await apiFetch('/operator/logout', 'POST'); } catch(_) {}
  localStorage.removeItem('op_token');
  localStorage.removeItem('op_id');
  localStorage.removeItem('op_name');
  if (_socket) _socket.disconnect();
  clearInterval(_heartbeatTimer);
  location.reload();
}

// ═══════════════════════════════════════════════════════════
// IAM LOGIN — pure PKCE, no external library
// ═══════════════════════════════════════════════════════════

const _opIam = {
  IAM_URL:   'https://id.dev.iam.99technologies.com',
  REALM:     '99-iam',
  CLIENT_ID: 'project-iq',

  _base() { return `${this.IAM_URL}/realms/${this.REALM}/protocol/openid-connect`; },

  _random() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  },
  async _challenge(v) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  },

  async login() {
    const verifier  = this._random();
    const challenge = await this._challenge(verifier);
    const state     = this._random();
    const redirectUri = window.location.origin + window.location.pathname;
    sessionStorage.setItem('op_iam_verifier',     verifier);
    sessionStorage.setItem('op_iam_state',         state);
    sessionStorage.setItem('op_iam_redirect_uri',  redirectUri);
    const params = new URLSearchParams({
      client_id: this.CLIENT_ID, response_type: 'code',
      redirect_uri: redirectUri, scope: 'openid profile email',
      state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    window.location.href = `${this._base()}/auth?${params}`;
  },

  async handleCallback() {
    const p = new URLSearchParams(window.location.search);
    const code      = p.get('code');
    const state     = p.get('state');
    const verifier  = sessionStorage.getItem('op_iam_verifier');
    const savedState   = sessionStorage.getItem('op_iam_state');
    const redirectUri  = sessionStorage.getItem('op_iam_redirect_uri');
    if (!code || !verifier || state !== savedState) return;
    sessionStorage.removeItem('op_iam_verifier');
    sessionStorage.removeItem('op_iam_state');
    sessionStorage.removeItem('op_iam_redirect_uri');
    history.replaceState({}, '', window.location.pathname);

    const btn   = document.getElementById('iam-login-btn');
    const errEl = document.getElementById('login-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      const tokenRes = await fetch(`${this._base()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', client_id: this.CLIENT_ID,
          code, redirect_uri: redirectUri, code_verifier: verifier,
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed');

      const r = await fetch('/operator/iam-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokens.access_token}` },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Login failed');
      _token  = d.token;
      _opId   = d.operator_id;
      _opName = d.display_name;
      localStorage.setItem('op_token', _token);
      localStorage.setItem('op_id',    _opId);
      localStorage.setItem('op_name',  _opName);
      _clearChatbotSessions();
      startApp();
    } catch (err) {
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in with IAM'; }
    }
  },

  async init() {
    if (new URLSearchParams(window.location.search).get('code')) {
      await this.handleCallback();
    }
  },
};

function opIamLogin() { _opIam.login(); }

// ═══════════════════════════════════════════════════════════
// APP STARTUP
// ═══════════════════════════════════════════════════════════
function startApp() {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('hdr-op-name').textContent = _opName;
  connectSocket();
  startHeartbeat();
  loadQueue();
  loadMyChats();
}

async function autoStart() {
  // Check for server-side IAM callback via URL fragment: #token=...&op_id=...&op_name=...
  if (window.location.hash && window.location.hash.includes('token=')) {
    const frag = new URLSearchParams(window.location.hash.slice(1));
    const t = frag.get('token'), id = frag.get('op_id'), name = frag.get('op_name');
    if (t && id) {
      _token  = t;
      _opId   = parseInt(id);
      _opName = name || 'Operator';
      localStorage.setItem('op_token', _token);
      localStorage.setItem('op_id',    _opId);
      localStorage.setItem('op_name',  _opName);
      history.replaceState({}, '', window.location.pathname);
      _clearChatbotSessions();
      startApp();
      return;
    }
  }
  // Check for IAM error
  const qErr = new URLSearchParams(window.location.search).get('iam_error');
  if (qErr) {
    const errEl = document.getElementById('login-error');
    if (errEl) { errEl.textContent = decodeURIComponent(qErr); errEl.classList.remove('hidden'); }
    history.replaceState({}, '', window.location.pathname);
  }
  // Restore saved session
  if (_token && _opId) {
    _clearChatbotSessions();
    startApp();
  }
}

