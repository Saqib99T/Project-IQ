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

function autoStart() {
  if (_token && _opId) {
    _clearChatbotSessions();
    startApp();
  }
}

