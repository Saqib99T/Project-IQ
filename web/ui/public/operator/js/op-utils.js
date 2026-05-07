// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
function showChatEmptyState() {
  document.getElementById('chat-empty-state').classList.remove('hidden');
  document.getElementById('chat-area').classList.add('hidden');
  enableChatInput();
  // Clear all per-chat message divs
  const container = document.getElementById('chat-messages');
  if (container) container.innerHTML = '';
  document.getElementById('context-content').innerHTML =
    '<div class="text-gray-400 text-xs text-center py-8">Select a conversation to see context</div>';
}

function updateHeaderBadges(waiting, assigned) {
  if (waiting !== null) document.getElementById('hdr-waiting').textContent = waiting;
  if (assigned !== null) document.getElementById('hdr-assigned').textContent = assigned;
}

function chatKeyByConv(convId) {
  return Object.keys(_chats).find(k => _chats[k].conversationId == convId) || null;
}

function prioBadge(prio) {
  prio = parseInt(prio || 5);
  if (prio >= 7) return `<span class="prio-high text-xs font-semibold px-1.5 py-0.5 rounded">P${prio}</span>`;
  if (prio >= 4) return `<span class="prio-medium text-xs font-semibold px-1.5 py-0.5 rounded">P${prio}</span>`;
  return `<span class="prio-low text-xs font-semibold px-1.5 py-0.5 rounded">P${prio}</span>`;
}

function waitLabel(queuedAt) {
  if (!queuedAt) return '?';
  // Normalise the timestamp string:
  //  1. Replace space separator with T so JS treats it as local time.
  //  2. Truncate Python microseconds (6 decimal places) to millis (3) —
  //     ECMAScript only guarantees parsing .sss; .ssssss can return Invalid Date.
  let ts = queuedAt;
  if (typeof ts === 'string') {
    ts = ts.replace(' ', 'T')              // "2026-04-17 10:00:00" → "...T..."
           .replace(/(\.\d{3})\d+/, '$1'); // ".123456" → ".123"
  }
  const ms   = new Date(ts).getTime();
  if (isNaN(ms)) return '?';
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 0)    return '?';
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m`;
  return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function playNotify() {
  try { document.getElementById('notify-sound').play(); } catch(_) {}
}

let _toastTimer = null;
function showToast(msg, isError=false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-xs
    ${isError ? 'bg-red-600 text-white' : 'bg-gray-800 text-white'}`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ═══════════════════════════════════════════════════════════
// API HELPER
// ═══════════════════════════════════════════════════════════
async function apiFetch(path, method='GET', body=null, auth=true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && _token) headers['Authorization'] = `Bearer ${_token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(API + path, opts);
}

// ═══════════════════════════════════════════════════════════
// SESSION END
