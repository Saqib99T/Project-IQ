// ═══════════════════════════════════════════════════════════
// QUEUE LOAD
// ═══════════════════════════════════════════════════════════
async function loadQueue() {
  try {
    const r = await apiFetch('/operator/queue');
    if (!r.ok) return;
    const d = await r.json();
    const items = d.items || [];
    Object.keys(_queueItems).forEach(k => delete _queueItems[k]);
    items.forEach(it => { _queueItems[K(it.id)] = it; });
    renderQueueList(items);
    updateHeaderBadges(items.length, null);
  } catch(_) {}
}

function renderQueueList(items) {
  const el = document.getElementById('queue-list');
  document.getElementById('queue-count-badge').textContent = items.length;
  if (!items.length) {
    el.innerHTML = '<div id="queue-empty" class="px-4 py-6 text-center text-gray-400 text-xs">No items in queue</div>';
    return;
  }
  el.innerHTML = items.map(it => {
    const wait = waitLabel(it.queued_at);
    const prio  = prioBadge(it.priority);
    const name  = it.user_name || it.context_package?.user_profile?.display_name || it.sender_id || 'User';
    return `<div class="queue-item cursor-pointer px-3 py-2.5 border-b border-gray-50 last:border-0" onclick="claimItem(${it.id})">
      <div class="flex items-center justify-between mb-0.5">
        <span class="text-sm font-medium text-gray-800 truncate max-w-[130px]">${esc(name)}</span>
        ${prio}
      </div>
      <div class="flex items-center justify-between text-xs text-gray-400">
        <span>${esc(it.trigger_reason || 'user_request')}</span>
        <span>${wait}</span>
      </div>
      <button onclick="claimItem(${it.id}); event.stopPropagation();"
        class="mt-1.5 w-full text-xs bg-green-600 hover:bg-green-700 text-white rounded py-1 font-semibold transition-colors">
        Claim →
      </button>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// MY ACTIVE CHATS
// ═══════════════════════════════════════════════════════════
async function loadMyChats() {
  window._dbg('loadMyChats');
  try {
    const r = await apiFetch('/operator/queue?status=assigned');
    if (!r.ok) return;
    const d = await r.json();
    const items = d.items || [];
    updateHeaderBadges(null, items.length);
    items.forEach(it => {
      const key = K(it.id);
      if (!_chats[key]) {
        _chats[key] = {
          queueId:        key,
          queueItem:      it,
          conversationId: it.conversation_id,
          senderId:       it.sender_id,
          appId:          it.app_id || 'General',
          displayName:    it.user_name || it.context_package?.user_profile?.display_name || it.sender_id || 'User',
          messages:       null,
          unread:         0,
        };
      }
    });
    const activeIds = new Set(items.map(i => K(i.id)));
    Object.keys(_chats).forEach(k => {
      if (!activeIds.has(k) && !_chats[k]?.sessionEnded) {
        // Only keep chats that are still assigned on the server,
        // or ones already marked ended (operator still viewing them)
        delete _chats[k];
        if (_activeQueueId === k) { _activeQueueId = null; showChatEmptyState(); }
      }
    });
    renderActiveList();
  } catch(_) {}
}

function renderActiveList() {
  const el = document.getElementById('active-list');
  const keys = Object.keys(_chats);
  document.getElementById('active-count-badge').textContent = keys.length;
  if (!keys.length) {
    el.innerHTML = '<div id="active-empty" class="px-4 py-6 text-center text-gray-400 text-xs">No active chats</div>';
    return;
  }
  el.innerHTML = keys.map(k => {
    const c = _chats[k];
    const isActive = (_activeQueueId === k);
    const unread = c.unread > 0
      ? `<span class="unread-badge bg-red-500 text-white rounded-full flex items-center justify-center font-bold ml-auto">${c.unread}</span>`
      : '';
    return `<div class="chat-item ${isActive ? 'active' : ''} cursor-pointer px-3 py-2.5 border-b border-gray-50 last:border-0 flex items-center gap-2" onclick="openChat('${k}')">
      <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
        ${esc(c.displayName[0]?.toUpperCase() || 'U')}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-gray-800 truncate">${esc(c.displayName)}</div>
        <div class="text-xs text-gray-400 truncate">${esc(c.appId)}</div>
      </div>
      ${unread}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// CLAIM
// ═══════════════════════════════════════════════════════════
async function claimItem(queueId) {
  const key = K(queueId);
  try {
    const r = await apiFetch('/operator/queue/claim', 'POST', { queue_id: queueId });
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Claim failed', true); return; }
    const d = await r.json();
    const qi = d.queue_item;
    _chats[key] = {
      queueId:        key,
      queueItem:      qi,
      conversationId: qi.conversation_id,
      senderId:       qi.sender_id,
      appId:          qi.app_id || 'General',
      displayName:    qi.user_name || qi.context_package?.user_profile?.display_name || qi.sender_id || 'User',
      messages:       null,
      unread:         0,
    };
    delete _queueItems[key];
    renderActiveList();
    loadQueue();
    openChat(key);
    showToast('Chat claimed', false);
  } catch(err) { showToast('Network error', true); }
}

// ═══════════════════════════════════════════════════════════
// OPEN CHAT  — always re-fetches from server
// ═══════════════════════════════════════════════════════════
async function openChat(queueId) {
  const key = K(queueId);
  const chat = _chats[key];
  if (!chat) return;

  _activeQueueId = key;
  chat.unread = 0;

  // Update UI chrome
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-area').classList.remove('hidden');
  document.getElementById('auto-assist-panel').classList.add('hidden');
  document.getElementById('chat-user-title').textContent = chat.displayName;
  document.getElementById('chat-user-sub').textContent = `${chat.appId} · Conv #${chat.conversationId}`;
  renderActiveList();

  const container = document.getElementById('chat-messages');
  if (!container) return;

  // Hide all per-chat divs, show (or create) the one for this key
  Array.from(container.children).forEach(c => c.style.display = 'none');

  let chatDiv = document.getElementById('chat-div-' + key);
  if (chatDiv) {
    // Already loaded — just show it
    chatDiv.style.display = '';
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    renderContextPanel(chat);
    if (chat.sessionEnded) disableChatInput(); else enableChatInput();
    return;
  }

  // First open — create the div and fetch messages
  chatDiv = document.createElement('div');
  chatDiv.id = 'chat-div-' + key;
  chatDiv.className = 'space-y-3';
  chatDiv.innerHTML = '<div class="text-center text-gray-400 text-xs py-4">Loading messages…</div>';
  container.appendChild(chatDiv);

  try {
    // Scope messages to this handoff session — start from queued_at
    const queuedAt = (chat.queueItem || {}).queued_at;
    const timeParam = queuedAt ? `?from_time=${encodeURIComponent(queuedAt)}` : '';
    const r = await apiFetch(`/operator/conversation/${chat.conversationId}${timeParam}`);
    const d = await r.json();
    if (r.ok) {
      chat.messages = d.messages || [];
    } else {
      chat.messages = chat.messages || [];
    }
  } catch(e) {
    chat.messages = chat.messages || [];
  }

  // Restore state if loadMyChats interfered
  if (!_chats[key]) { _chats[key] = chat; }
  _activeQueueId = key;
  document.getElementById('chat-empty-state').classList.add('hidden');
  document.getElementById('chat-area').classList.remove('hidden');

  // Render into the per-chat div
  if (!chat.messages || chat.messages.length === 0) {
    chatDiv.innerHTML = '<div class="text-center text-gray-400 text-xs py-4">No messages yet</div>';
  } else {
    chatDiv.innerHTML = chat.messages.map(m => messageBubble(m)).join('');
  }
  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });

  if (chat.sessionEnded) disableChatInput(); else enableChatInput();
  renderContextPanel(chat);
}

function fmtPayload(text) {
    if (!text || !text.startsWith('/')) return text;
    const MAP = { '/create_ticket':'Create a ticket','/list_tickets':'List my tickets','/check_status':'Check ticket status','/help':'Help','/request_human_agent':'Talk to a human agent','/confirm_gdpr_consent':'I agree to the terms','/deny_gdpr_consent':'I do not agree','/login':'Login','/logout':'Logout','/greet':'Hello','/hi':'Hello','/affirm':'Yes','/deny':'No','/restart':'Start over','/out_of_scope':'Other','/ask_knowledge':'Search Knowledge Base','/submit_ticket_form':'Ticket submitted','/show_ticket_graph':'View ticket graph','/show_chart':'View chart','/accept_ticket_fallback':'Create a support ticket','/confirm_handoff':'Wait in queue','/cancel_handoff':'Cancel handoff','/kb_not_helpful':'Not helpful','/kb_show_full_answer':'Show full answer','/kb_show_full_article':'Show full article','/feedback_positive':'Positive feedback','/feedback_negative':'Negative feedback','/inform':'Option selected','/inform_update':'Update ticket','/stop':'Cancel','/clear':'Clear session','/verify_resolution':'Mark as resolved','/update_ticket':'Update ticket','/list_attachments':'List attachments','/upload_file':'Upload file','/rating_1':'Rating: 1★','/rating_2':'Rating: 2★','/rating_3':'Rating: 3★','/rating_4':'Rating: 4★','/rating_5':'Rating: 5★' };
    const key = text.split('{')[0].trim().toLowerCase();
    return MAP[key] || text.slice(1).replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase());
}

function messageBubble(m) {
  const isBot = m.sender === 'bot';
  const isUser = m.sender === 'user';
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';

  if (isUser) {
    return `<div class="flex items-end gap-2">
      <div class="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">U</div>
      <div class="max-w-[70%]">
        <div class="bg-white border border-gray-200 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-gray-800 shadow-sm">${esc(fmtPayload(m.text))}</div>
        <div class="text-xs text-gray-400 mt-0.5 ml-1">${ts}</div>
      </div>
    </div>`;
  }
  if (isBot) {
    return `<div class="flex items-end gap-2">
      <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-500 flex-shrink-0">🤖</div>
      <div class="max-w-[70%]">
        <div class="bg-blue-50 border border-blue-100 rounded-xl rounded-bl-sm px-3 py-2 text-sm text-gray-700">${esc(m.text)}</div>
        <div class="text-xs text-gray-400 mt-0.5 ml-1">Bot · ${ts}</div>
      </div>
    </div>`;
  }
  // operator
  return `<div class="flex items-end gap-2 flex-row-reverse">
    <div class="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-600 flex-shrink-0">Me</div>
    <div class="max-w-[70%]">
      <div class="bg-green-600 rounded-xl rounded-br-sm px-3 py-2 text-sm text-white shadow-sm">${esc(m.text)}</div>
      <div class="text-xs text-gray-400 mt-0.5 text-right mr-1">${ts}</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// APPEND INCOMING MESSAGE (real-time)
// ═══════════════════════════════════════════════════════════
function appendMessage(chatKey, sender, text, timestamp) {
  const chat = _chats[chatKey];
  if (!chat) return;
  const msg = { sender, text, timestamp: timestamp || new Date().toISOString() };
  if (chat.messages === null) chat.messages = [];
  chat.messages.push(msg);
  // Append to the per-chat div (works whether it's visible or not)
  const chatDiv = document.getElementById('chat-div-' + chatKey);
  if (chatDiv) {
    chatDiv.insertAdjacentHTML('beforeend', messageBubble(msg));
    // Scroll if this chat is currently active
    if (_activeQueueId === chatKey) {
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }
  }
}

