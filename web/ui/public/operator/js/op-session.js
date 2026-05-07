// ═══════════════════════════════════════════════════════════
function markSessionEnded(key, status) {
  const chat = _chats[key];
  if (!chat || chat.sessionEnded) return;
  chat.sessionEnded = true;

  const statusMap = {
    resolved:  'Session closed',
    abandoned: 'User left the queue',
    timeout:   'Session timed out',
    closed:    'Session closed',
  };
  const label = statusMap[status] || 'Session closed';

  // Insert a system notice at the bottom of this chat's message div
  const chatDiv = document.getElementById('chat-div-' + key);
  if (chatDiv) {
    const notice = document.createElement('div');
    notice.className = 'text-center my-4';
    notice.innerHTML = `<span class="inline-block bg-amber-50 border border-amber-100 text-amber-600 text-xs px-4 py-1.5 rounded-full font-medium">🔒 ${esc(label)} — no further messages can be posted</span>`;
    chatDiv.appendChild(notice);
  }

  if (_activeQueueId === key) {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
    disableChatInput();
  }

  renderActiveList();
}

function disableChatInput() {
  const input  = document.getElementById('msg-input');
  const btn    = document.getElementById('send-btn');
  const aiBtn  = document.getElementById('ai-assist-btn');
  if (input)  { input.disabled  = true;  input.placeholder = 'Session ended — read only'; }
  if (btn)    { btn.disabled    = true; }
  if (aiBtn)  { aiBtn.disabled  = true; }
  const bar = document.getElementById('session-ended-bar');
  if (bar) bar.classList.remove('hidden');
}

function enableChatInput() {
  const input  = document.getElementById('msg-input');
  const btn    = document.getElementById('send-btn');
  const aiBtn  = document.getElementById('ai-assist-btn');
  if (input)  { input.disabled  = false; input.placeholder = 'Type a reply…'; }
  if (btn)    { btn.disabled    = false; }
  if (aiBtn)  { aiBtn.disabled  = false; }
  const bar = document.getElementById('session-ended-bar');
  if (bar) bar.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════
// HISTORY CHAT POPUP
// ═══════════════════════════════════════════════════════════
async function openHistoryChat(queueId) {
  const meta     = _historyMeta[queueId] || {};
  const convId   = meta.conversationId || queueId;
  const modal    = document.getElementById('history-modal');
  const titleEl  = document.getElementById('history-modal-title');
  const subEl    = document.getElementById('history-modal-sub');
  const msgEl    = document.getElementById('history-modal-messages');

  titleEl.textContent = meta.label || 'Past Conversation';
  subEl.textContent   = meta.sub   || `Session #${queueId}`;
  msgEl.innerHTML     = '<div class="text-center text-gray-400 text-xs py-8">Loading…</div>';
  modal.classList.remove('hidden');

  try {
    // Scope to this session's time window
    const params = new URLSearchParams();
    if (meta.fromTime) params.set('from_time', meta.fromTime);
    if (meta.toTime)   params.set('to_time',   meta.toTime);
    const qs = params.toString() ? `?${params}` : '';
    const r = await apiFetch(`/operator/conversation/${convId}${qs}`);
    const d = await r.json();
    const msgs = d.messages || [];
    if (!msgs.length) {
      msgEl.innerHTML = '<div class="text-center text-gray-400 text-xs py-8">No messages in this session</div>';
      return;
    }
    msgEl.innerHTML = msgs.map(m => messageBubble(m)).join('');
    requestAnimationFrame(() => { msgEl.scrollTop = msgEl.scrollHeight; });
  } catch(_) {
    msgEl.innerHTML = '<div class="text-center text-red-400 text-xs py-8">Could not load messages</div>';
  }
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
}

// Close history modal on backdrop click
document.addEventListener('click', (e) => {
  const modal = document.getElementById('history-modal');
  if (modal && !modal.classList.contains('hidden') && e.target === modal) {
    closeHistoryModal();
  }
});

// Close status menu when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('status-menu');
  const btn  = document.getElementById('status-btn');
  if (menu && !menu.contains(e.target) && btn && !btn.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
autoStart();
