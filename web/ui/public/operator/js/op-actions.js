// ═══════════════════════════════════════════════════════════
// RESOLVE / RELEASE
// ═══════════════════════════════════════════════════════════
function confirmResolve() {
  if (!_activeQueueId) return;
  document.getElementById('closing-note').value = '';
  document.getElementById('return-to-bot').checked = true;
  document.getElementById('resolve-modal').classList.remove('hidden');
}

function closeResolveModal() { document.getElementById('resolve-modal').classList.add('hidden'); }

async function executeResolve() {
  const note = document.getElementById('closing-note').value.trim();
  const returnToBot = document.getElementById('return-to-bot').checked;
  closeResolveModal();
  if (!_activeQueueId) return;

  try {
    const r = await apiFetch('/operator/queue/resolve', 'POST', {
      queue_id: _activeQueueId,
      return_to_bot: returnToBot,
      closing_note: note,
    });
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Resolve failed', true); return; }
    showToast('Conversation resolved ✓', false);
    const resolvedDiv = document.getElementById('chat-div-' + _activeQueueId);
    if (resolvedDiv) resolvedDiv.remove();
    delete _chats[_activeQueueId];
    _activeQueueId = null;
    renderActiveList();
    showChatEmptyState();
    loadQueue();
  } catch(_) { showToast('Network error', true); }
}

function confirmRelease() {
  if (!_activeQueueId) return;
  document.getElementById('release-note').value = '';
  document.getElementById('release-modal').classList.remove('hidden');
}

function closeReleaseModal() { document.getElementById('release-modal').classList.add('hidden'); }

async function executeRelease() {
  const note = document.getElementById('release-note').value.trim();
  closeReleaseModal();
  if (!_activeQueueId) return;

  try {
    const r = await apiFetch('/operator/queue/release', 'POST', {
      queue_id: _activeQueueId,
      note,
    });
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Release failed', true); return; }
    showToast('Chat returned to queue', false);
    const releasedDiv = document.getElementById('chat-div-' + _activeQueueId);
    if (releasedDiv) releasedDiv.remove();
    delete _chats[_activeQueueId];
    _activeQueueId = null;
    renderActiveList();
    showChatEmptyState();
    loadQueue();
  } catch(_) { showToast('Network error', true); }
}

// ═══════════════════════════════════════════════════════════
// CONTEXT PANEL
// ═══════════════════════════════════════════════════════════
function openContextPanel() {
  if (_activeQueueId && _chats[_activeQueueId]) renderContextPanel(_chats[_activeQueueId]);
}

function renderContextPanel(chat) {
  const el = document.getElementById('context-content');
  if (!el) return;
  const qi    = chat.queueItem || {};
  const ctx   = qi.context_package || {};
  const up    = ctx.user_profile  || {};
  const sess  = ctx.session       || {};
  const tech  = ctx.technical_data || {};
  const trig  = ctx.trigger       || {};
  const summary = ctx.ai_summary  || '';

  // Last intent from recent transcript
  const transcript   = ctx.transcript || [];
  const lastIntentMsg = [...transcript].reverse().find(m => m.intent);
  const lastIntent   = lastIntentMsg ? lastIntentMsg.intent : null;

  // Update intent badge in chat header
  const badge = document.getElementById('chat-intent-badge');
  if (badge) {
    if (lastIntent) {
      badge.textContent = lastIntent.replace(/_/g, ' ');
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // Saved notes for this conversation
  const noteKey  = `op-note-${chat.conversationId}`;
  const savedNote = sessionStorage.getItem(noteKey) || '';

  // Build smart context rows — only non-empty fields
  const ctxRows = [];
  if (up.display_name)          ctxRows.push(['👤', esc(up.display_name)]);
  ctxRows.push(['📱', esc(chat.appId)]);
  if (tech.browser && tech.os)  ctxRows.push(['💻', `${esc(tech.browser)} / ${esc(tech.os)}`]);
  else if (tech.browser)        ctxRows.push(['💻', esc(tech.browser)]);
  else if (tech.os)             ctxRows.push(['💻', esc(tech.os)]);
  if (sess.related_ticket_id)   ctxRows.push(['🎫', `<a href="/glpi/front/ticket.form.php?id=${esc(sess.related_ticket_id)}" target="_blank" class="text-blue-600 hover:underline">#${esc(sess.related_ticket_id)}</a>`]);

  const triggerText = (trig.reason || qi.trigger_reason || '').replace(/_/g,' ');
  if (triggerText)              ctxRows.push(['⚡', `<span class="capitalize">${esc(triggerText)}</span>`]);
  if (qi.target_team)           ctxRows.push(['👥', esc(qi.target_team)]);
  if (qi.queued_at)             ctxRows.push(['⏱', `Waiting ${waitLabel(qi.queued_at)}`]);
  if (trig.frustration_score > 0) ctxRows.push(['😤', `<span class="text-red-500 font-medium">${(trig.frustration_score * 100).toFixed(0)}% frustration</span>`]);
  if (lastIntent)               ctxRows.push(['🎯', `<span class="text-blue-600">${esc(lastIntent.replace(/_/g,' '))}</span>`]);

  el.innerHTML = `
    <!-- Smart context card -->
    <div class="bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 space-y-1">
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-xs font-semibold text-gray-600">${esc(chat.displayName)}</span>
        ${prioBadge(qi.priority)}
      </div>
      <div class="font-mono text-gray-400 text-[10px] truncate mb-1.5">${esc(chat.senderId)}</div>
      ${ctxRows.map(([icon, val]) => `
        <div class="flex items-start gap-2 text-xs text-gray-700 leading-tight">
          <span class="text-[11px] mt-0.5 shrink-0">${icon}</span>
          <span class="truncate">${val}</span>
        </div>`).join('')}
    </div>

    ${summary ? `<div>
      <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">AI Summary</div>
      <div class="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-gray-700 leading-relaxed">${esc(summary)}</div>
    </div>` : ''}

    <!-- Operator notes -->
    <div>
      <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Notes</div>
      <textarea id="op-note-field" rows="3" placeholder="Private notes (not sent to user)…"
        oninput="saveNote('${chat.conversationId}', this.value)"
        class="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 resize-none focus:ring-1 focus:ring-blue-400 outline-none"
      >${esc(savedNote)}</textarea>
    </div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button onclick="confirmResolve()"
        class="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs font-semibold rounded-lg py-2 transition-colors">
        ✓ Resolve
      </button>
      <button onclick="confirmRelease()"
        class="flex-1 border border-amber-300 text-amber-700 hover:bg-amber-50 text-xs font-semibold rounded-lg py-2 transition-colors">
        ↩ Release
      </button>
    </div>

    <!-- Interaction history placeholder (loaded async) -->
    <div>
      <div class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Interaction History</div>
      <div id="interaction-history" class="text-xs text-gray-400">Loading…</div>
    </div>
  `;

  // Load interaction history async
  loadUserHistory(chat.senderId);
}

// ═══════════════════════════════════════════════════════════
// AUTO ASSIST (AI Draft)
// ═══════════════════════════════════════════════════════════
async function fetchAiDraft() {
  if (!_activeQueueId) return;
  const chat = _chats[_activeQueueId];
  if (!chat) return;

  const btn = document.getElementById('ai-assist-btn');
  if (btn) { btn.textContent = '⏳ Fetching…'; btn.disabled = true; }

  try {
    const r = await apiFetch('/operator/ai-draft', 'POST', { conversation_id: chat.conversationId });
    const d = await r.json();
    if (btn) { btn.textContent = '✨ Suggest reply'; btn.disabled = false; }

    if (!r.ok || !d.draft) {
      showToast(d.error || 'No suggestion available', true);
      return;
    }
    document.getElementById('auto-assist-draft').textContent = d.draft;
    document.getElementById('auto-assist-panel').classList.remove('hidden');
  } catch(_) {
    if (btn) { btn.textContent = '✨ Suggest reply'; btn.disabled = false; }
    showToast('Auto assist unavailable', true);
  }
}

function dismissDraft() {
  document.getElementById('auto-assist-panel').classList.add('hidden');
}

function useDraftEdit() {
  const draft = document.getElementById('auto-assist-draft').textContent;
  const input = document.getElementById('msg-input');
  if (input) { input.value = draft; input.focus(); }
  dismissDraft();
}

async function useDraftSend() {
  const draft = document.getElementById('auto-assist-draft').textContent;
  const input = document.getElementById('msg-input');
  if (input) input.value = draft;
  dismissDraft();
  await sendMessage();
}

// ═══════════════════════════════════════════════════════════
// OPERATOR NOTES
// ═══════════════════════════════════════════════════════════
function saveNote(conversationId, value) {
  sessionStorage.setItem(`op-note-${conversationId}`, value);
}

// ═══════════════════════════════════════════════════════════
// INTERACTION HISTORY
// ═══════════════════════════════════════════════════════════
async function loadUserHistory(senderId) {
  const currentQueueId = _activeQueueId ? parseInt(_activeQueueId, 10) : null;

  if (!senderId || senderId === 'undefined') {
    const el = document.getElementById('interaction-history');
    if (el) el.innerHTML = '<span class="text-gray-400 text-xs">No sender ID available</span>';
    return;
  }

  try {
    const r = await apiFetch(`/operator/user-history/${encodeURIComponent(senderId)}?limit=11`);
    const d = await r.json();
    const el = document.getElementById('interaction-history');
    if (!el) return;

    if (!r.ok || !d.history) {
      el.innerHTML = '<span class="text-gray-400 text-xs">Could not load history</span>';
      return;
    }

    // Exclude the current active queue session — show only past sessions
    const previous = d.history.filter(h => h.queue_id !== currentQueueId).slice(0, 10);

    if (previous.length === 0) {
      el.innerHTML = '<span class="text-gray-400 text-xs">No previous sessions</span>';
      return;
    }

    el.innerHTML = previous.map(h => {
      const tsRaw = h.queued_at || h.resolved_at;
      const ts    = tsRaw
        ? tsRaw.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
        : null;
      const dtObj = ts ? new Date(ts) : null;
      const date  = dtObj
        ? dtObj.toLocaleDateString([], { month:'short', day:'numeric', year:'2-digit' })
        : '?';
      const timeStr = dtObj
        ? dtObj.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
        : '';
      const statusColor = h.handoff_status === 'resolved'  ? 'bg-green-400'
                        : h.handoff_status === 'assigned'  ? 'bg-blue-400'
                        : h.handoff_status === 'waiting'   ? 'bg-amber-400'
                        : h.handoff_status === 'abandoned' ? 'bg-gray-400'
                        : 'bg-gray-300';
      const statusLabel = h.handoff_status === 'abandoned' ? 'dropped'
                        : h.handoff_status || 'unknown';
      const preview = h.first_user_msg
        ? esc(h.first_user_msg.slice(0, 60)) + (h.first_user_msg.length > 60 ? '…' : '')
        : '—';
      const label = `${esc(h.app_id)} — ${date}${timeStr ? ' ' + timeStr : ''}`;
      const sub   = dtObj
        ? dtObj.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : '';
      // Key by queue_id; store everything needed for the popup
      _historyMeta[h.queue_id] = {
        label, sub,
        conversationId: h.conversation_id,
        fromTime: h.queued_at,
        toTime:   h.resolved_at || h.abandoned_at || null
      };
      return `
        <div class="border border-gray-100 bg-white rounded-lg px-2.5 py-2 mb-1.5 hover:bg-blue-50 hover:border-blue-200 cursor-pointer transition-colors group"
             onclick="openHistoryChat(${h.queue_id})">
          <div class="flex items-center justify-between mb-0.5">
            <div class="flex items-center gap-1.5">
              <span class="status-dot ${statusColor}"></span>
              <span class="font-medium text-gray-700 text-xs">${esc(h.app_id)}</span>
              <span class="text-gray-300 text-xs">·</span>
              <span class="text-gray-400 text-xs capitalize">${esc(statusLabel)}</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-gray-400 text-xs">${date}</span>
              <svg class="w-3 h-3 text-gray-300 group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
          <div class="text-gray-400 text-xs italic leading-tight truncate">"${preview}"</div>
        </div>`;
    }).join('');
  } catch(_) {
    const el = document.getElementById('interaction-history');
    if (el) el.innerHTML = '<span class="text-gray-400 text-xs">Could not load</span>';
  }
}

// ═══════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════
function toggleStatusMenu() {
  document.getElementById('status-menu').classList.toggle('hidden');
}

async function setStatus(status) {
  document.getElementById('status-menu').classList.add('hidden');
  try {
    const r = await apiFetch('/operator/status', 'POST', { status });
    if (!r.ok) return;
    const d = await r.json();
    // Use server-returned status (server may override e.g. available→busy if at capacity)
    const actual = d.status || status;
    _opStatus = actual;
    updateStatusUI(actual);
  } catch(_) {}
}

function updateStatusUI(status) {
  const dotEl   = document.getElementById('status-dot-hdr');
  const labelEl = document.getElementById('status-label');
  const dotClass = { available: 'dot-available', away: 'dot-away', busy: 'dot-busy', offline: 'dot-offline' }[status] || 'dot-offline';
  dotEl.className = `status-dot ${dotClass}`;
  labelEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
}

