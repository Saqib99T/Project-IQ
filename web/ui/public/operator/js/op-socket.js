// ═══════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════
function connectSocket() {
  _socket = io(window.location.origin, { transports: ['websocket', 'polling'] });

  _socket.on('connect', () => {
    _socket.emit('join_operator', { operator_id: _opId, token: _token });
    console.log('[SIO] connected');
    // Refresh data on every (re)connect to catch anything missed
    loadQueue();
    loadMyChats();
  });

  _socket.on('disconnect', () => console.log('[SIO] disconnected'));

  _socket.on('new_queue_item', (d) => {
    playNotify();
    loadQueue();
    updateHeaderBadges(null, null);
    showToast(`📥 New queue item — position ${d.queue_position}`, false);
  });

  _socket.on('queue_item_updated', () => { loadQueue(); loadMyChats(); });

  _socket.on('queue_item_removed', (d) => {
    // If the removed item is an operator's active/open chat, mark it ended
    const key = d && d.queue_id != null ? K(d.queue_id) : null;
    if (key && _chats[key]) {
      markSessionEnded(key, d.status || 'closed');
    }
    loadQueue();
    loadMyChats();
  });

  _socket.on('user_message', (d) => {
    const key = chatKeyByConv(d.conversation_id);
    const chat = key ? _chats[key] : null;
    if (!chat) return;
    appendMessage(key, 'user', d.text, d.timestamp);
    if (_activeQueueId !== key) {
      chat.unread++;
      renderActiveList();
    }
  });

  _socket.on('user_typing', (d) => {
    const key = chatKeyByConv(d.conversation_id);
    const chat = key ? _chats[key] : null;
    if (!chat || _activeQueueId !== key) return;
    const el = document.getElementById('typing-indicator');
    if (el) {
      el.classList.toggle('hidden', !d.typing);
      if (d.typing) { clearTimeout(chat._typingClear);
        chat._typingClear = setTimeout(() => el.classList.add('hidden'), 4000); }
    }
  });

  _socket.on('user_left', (d) => {
    const key = chatKeyByConv(d.conversation_id);
    const chat = key ? _chats[key] : null;
    if (chat) {
      const msgEl = document.getElementById('chat-messages');
      if (msgEl && _activeQueueId === key) {
        const notice = document.createElement('div');
        notice.className = 'text-center text-xs text-gray-400 italic my-2 px-4';
        notice.textContent = '— User has left the conversation —';
        msgEl.appendChild(notice);
        msgEl.scrollTop = msgEl.scrollHeight;
      }
      chat.userLeft = true;
      loadQueue();
      loadMyChats();
    }
  });

  _socket.on('queue_overview_update', (d) => updateHeaderBadges(d.waiting_count, d.assigned_count));

  _socket.on('transfer_request', (d) => {
    const modal = document.getElementById('incoming-transfer-modal');
    document.getElementById('transfer-from-name').textContent = d.from_operator_name;
    document.getElementById('transfer-user-name').textContent = d.user_display_name;
    document.getElementById('transfer-accept-btn').onclick = () => respondTransfer(d.queue_id, d.from_operator_id, true);
    document.getElementById('transfer-reject-btn').onclick = () => respondTransfer(d.queue_id, d.from_operator_id, false);
    modal.classList.remove('hidden');
    playNotify();
  });

  _socket.on('transfer_accepted', (d) => {
    const chat = _chats[K(d.queue_id)];
    if (chat) {
      delete _chats[K(d.queue_id)];
      if (_activeQueueId === K(d.queue_id)) { _activeQueueId = null; showChatEmptyState(); }
      renderActiveList();
    }
    showToast(`✅ ${d.by_operator_name} accepted the transfer`, false);
    loadMyChats();
    loadQueue();
  });

  _socket.on('transfer_rejected', (d) => {
    showToast(`❌ ${d.by_operator_name} declined the transfer`, true);
  });
}

// ═══════════════════════════════════════════════════════════
// HEARTBEAT
// ═══════════════════════════════════════════════════════════
let _queuePollTimer = null;
function startHeartbeat() {
  clearInterval(_heartbeatTimer);
  async function _hb() {
    try {
      const r = await apiFetch('/operator/heartbeat', 'POST');
      if (r.status === 401) {
        // Token expired — try silent refresh before logging out
        const refreshed = await _refreshToken();
        if (refreshed) {
          // Retry heartbeat with new token
          const r2 = await apiFetch('/operator/heartbeat', 'POST');
          if (!r2.ok) { doLogout(); return; }
        } else {
          doLogout(); return;
        }
      } else if (r.ok) {
        const d = await r.json();
        // Sync UI to actual server-side status (single source of truth)
        if (d.status && d.status !== _opStatus) {
          _opStatus = d.status;
          updateStatusUI(d.status);
        }
      }
    } catch(_) {}
  }

  async function _refreshToken() {
    try {
      const r = await apiFetch('/operator/token/refresh', 'POST');
      if (!r.ok) return false;
      const d = await r.json();
      if (!d.token) return false;
      _token = d.token;
      localStorage.setItem('op_token', _token);
      return true;
    } catch(_) { return false; }
  }
  _hb();  // fire immediately
  _heartbeatTimer = setInterval(_hb, 25000);
  // Also poll queue periodically as a safety net (Socket.IO events can be missed)
  clearInterval(_queuePollTimer);
  _queuePollTimer = setInterval(() => { loadQueue(); loadMyChats(); }, 15000);
}

