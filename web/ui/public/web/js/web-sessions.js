// ── Active Sessions ───────────────────────────────────────────────────────────
let _sessData = [];
let _sessAutoTimer = null;
let _sessConvId = null;

async function sessInit() {
    await Promise.all([sessLoadFilters(), sessLoad()]);
}

async function sessLoadFilters() {
    try {
        const [opsRes, appsRes] = await Promise.all([
            fetch('/admin/sessions/operators'),
            fetch('/admin/analytics/apps'),
        ]);
        const ops  = (await opsRes.json()).operators  || [];
        const apps = (await appsRes.json()).apps      || [];

        const opSel  = document.getElementById('sess-filter-op');
        const appSel = document.getElementById('sess-filter-app');
        if (!opSel || !appSel) return;

        // Clear existing options except the first "All …" option
        while (opSel.options.length > 1)  opSel.remove(1);
        while (appSel.options.length > 1) appSel.remove(1);

        ops.forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.id; opt.textContent = o.display_name;
            opSel.appendChild(opt);
        });
        apps.forEach(a => {
            const id = a.app_id || a;
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = id;
            appSel.appendChild(opt);
        });
    } catch(_) {}
}

async function sessLoad() {
    const type  = document.getElementById('sess-filter-type')?.value  || '';
    const app   = document.getElementById('sess-filter-app')?.value   || '';
    const op    = document.getElementById('sess-filter-op')?.value    || '';

    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (app)  params.set('app_id', app);
    if (op)   params.set('operator_id', op);

    try {
        const r    = await fetch(`/admin/sessions/active?${params}`);
        const data = await r.json();
        if (!data.success) return;
        _sessData = data.sessions || [];
        sessRender();
        document.getElementById('sess-last-refresh').textContent =
            'Updated ' + new Date().toLocaleTimeString();
    } catch(_) {}
}

function sessRefresh() { sessLoad(); }

function sessToggleAutoRefresh() {
    const on = document.getElementById('sess-auto-refresh')?.checked;
    clearInterval(_sessAutoTimer);
    if (on) _sessAutoTimer = setInterval(sessLoad, 15000);
}

function sessRender() {
    const rows = _sessData;
    const tbody = document.getElementById('sess-tbody');
    if (!tbody) return;

    // Update stats
    const bot      = rows.filter(r => r.handoff_state === 'bot_active').length;
    const queued   = rows.filter(r => r.handoff_state === 'queued').length;
    const assigned = rows.filter(r => r.handoff_state === 'assigned').length;
    document.getElementById('sess-stat-bot').textContent      = bot;
    document.getElementById('sess-stat-queued').textContent   = queued;
    document.getElementById('sess-stat-assigned').textContent = assigned;
    document.getElementById('sess-stat-total').textContent    = rows.length;
    document.getElementById('sess-count').textContent         = `${rows.length} session${rows.length !== 1 ? 's' : ''}`;

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">No active sessions</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(r => {
        const user      = r.user_name || r.user_id || r.sender_id?.slice(0, 16) + '…' || '—';
        const typeBadge = sessTypeBadge(r.handoff_state);
        const op        = r.operator_name || '—';
        const started   = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
        const dur       = sessDuration(r.started_at);
        const msgs      = r.message_count ?? '—';
        const frust     = r.frustration_score > 0.5
            ? `<span class="text-red-500 ml-1" title="High frustration">😤</span>` : '';

        return `<tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="px-4 py-3">
                <div class="font-medium text-gray-800">${esc(user)}${frust}</div>
                <div class="text-xs text-gray-400 font-mono">${esc(r.sender_id?.slice(0,20) || '')}…</div>
            </td>
            <td class="px-4 py-3"><span class="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">${esc(r.app_id)}</span></td>
            <td class="px-4 py-3">${typeBadge}</td>
            <td class="px-4 py-3 text-gray-700">${esc(op)}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${started}</td>
            <td class="px-4 py-3 text-gray-600 text-xs font-mono">${dur}</td>
            <td class="px-4 py-3 text-gray-600">${msgs}</td>
            <td class="px-4 py-3">
                <div class="flex items-center gap-1">
                    <button onclick="sessViewChat(${r.id},'${esc(user)}')"
                        class="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">View</button>
                    ${r.handoff_state !== 'assigned'
                        ? `<button onclick="sessOpenTransfer(${r.id},'${esc(user)}')"
                            class="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100 font-medium">Transfer</button>`
                        : ''}
                    <button onclick="sessEndSession(${r.id})"
                        class="px-2 py-1 text-xs bg-red-50 text-red-500 rounded hover:bg-red-100 font-medium">End</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function sessTypeBadge(state) {
    const map = {
        bot_active: '<span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium">🤖 Bot</span>',
        queued:     '<span class="px-2 py-1 bg-amber-50 text-amber-600 rounded text-xs font-medium">⏳ Queue</span>',
        assigned:   '<span class="px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-medium">👤 Agent</span>',
    };
    return map[state] || `<span class="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">${state}</span>`;
}

function sessDuration(startedAt) {
    if (!startedAt) return '—';
    const secs = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    if (secs < 60)   return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
    return `${Math.floor(secs/3600)}h ${Math.floor((secs%3600)/60)}m`;
}

async function sessViewChat(convId, userName) {
    _sessConvId = convId;
    document.getElementById('sess-chat-title').textContent = userName;
    document.getElementById('sess-chat-sub').textContent   = `Conversation #${convId}`;
    document.getElementById('sess-chat-messages').innerHTML = '<div class="text-center text-gray-400 py-4">Loading…</div>';
    document.getElementById('sess-chat-modal').classList.remove('hidden');
    try {
        const r    = await fetch(`/admin/sessions/active/${convId}/messages`);
        const data = await r.json();
        sessRenderMessages('sess-chat-messages', data.messages || []);
    } catch(_) {
        document.getElementById('sess-chat-messages').innerHTML = '<div class="text-red-400 text-center py-4">Failed to load</div>';
    }
}

function fmtPayload(text) {
    if (!text || !text.startsWith('/')) return text;
    const MAP = { '/create_ticket':'Create a ticket','/list_tickets':'List my tickets','/check_status':'Check ticket status','/help':'Help','/request_human_agent':'Talk to a human agent','/confirm_gdpr_consent':'I agree to the terms','/deny_gdpr_consent':'I do not agree','/login':'Login','/logout':'Logout','/greet':'Hello','/hi':'Hello','/affirm':'Yes','/deny':'No','/restart':'Start over','/out_of_scope':'Other','/ask_knowledge':'Search Knowledge Base','/submit_ticket_form':'Ticket submitted','/show_ticket_graph':'View ticket graph','/show_chart':'View chart','/accept_ticket_fallback':'Create a support ticket','/confirm_handoff':'Wait in queue','/cancel_handoff':'Cancel handoff','/kb_not_helpful':'Not helpful','/kb_show_full_answer':'Show full answer','/kb_show_full_article':'Show full article','/feedback_positive':'Positive feedback','/feedback_negative':'Negative feedback','/inform':'Option selected','/inform_update':'Update ticket','/stop':'Cancel','/clear':'Clear session','/verify_resolution':'Mark as resolved','/update_ticket':'Update ticket','/list_attachments':'List attachments','/upload_file':'Upload file','/rating_1':'Rating: 1★','/rating_2':'Rating: 2★','/rating_3':'Rating: 3★','/rating_4':'Rating: 4★','/rating_5':'Rating: 5★' };
    const key = text.split('{')[0].trim().toLowerCase();
    return MAP[key] || text.slice(1).replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase());
}

function sessRenderMessages(containerId, msgs) {
    const el = document.getElementById(containerId);
    if (!msgs.length) { el.innerHTML = '<div class="text-gray-400 text-center py-4">No messages</div>'; return; }
    el.innerHTML = msgs.map(m => {
        const isUser = m.sender === 'user';
        const isBot  = m.sender === 'bot';
        const ts     = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
        const label  = isUser ? '👤 User' : isBot ? '🤖 Bot' : '💬 Operator';
        const bg     = isUser ? 'bg-blue-50 border-l-4 border-blue-400 ml-8'
                     : isBot  ? 'bg-gray-50 border-l-4 border-gray-300 mr-8'
                     :          'bg-green-50 border-l-4 border-green-400 mr-8';
        return `<div class="p-2.5 rounded-lg ${bg}">
            <div class="flex justify-between text-xs mb-1">
                <span class="font-semibold text-gray-600">${label}</span>
                <span class="text-gray-400">${ts}</span>
            </div>
            <div class="text-sm text-gray-800">${esc(isUser ? fmtPayload(m.text) : (m.text || ''))}</div>
            ${m.intent ? `<span class="inline-block mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-600 rounded">🎯 ${esc(m.intent)}</span>` : ''}
        </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
}

async function sessOpenTransfer(convId, userName) {
    document.getElementById('sess-transfer-user').textContent = `Transfer session for: ${userName}`;
    const list = document.getElementById('sess-transfer-list');
    list.innerHTML = '<div class="text-xs text-gray-400 py-2 text-center">Loading operators…</div>';
    document.getElementById('sess-transfer-modal').classList.remove('hidden');
    try {
        const r    = await fetch('/admin/sessions/operators');
        const data = await r.json();
        const ops  = (data.operators || []).filter(o => o.status !== 'offline');
        if (!ops.length) { list.innerHTML = '<div class="text-xs text-gray-400 py-2 text-center">No operators online</div>'; return; }
        list.innerHTML = ops.map(o => {
            const dot = o.status === 'available' ? 'bg-green-400' : 'bg-amber-400';
            return `<div onclick="sessDoTransfer(${convId},${o.id},'${esc(o.display_name)}')"
                class="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-blue-50 cursor-pointer border border-transparent hover:border-blue-200">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full ${dot} inline-block"></span>
                    <span class="text-sm font-medium text-gray-800">${esc(o.display_name)}</span>
                </div>
                <span class="text-xs text-gray-400 capitalize">${o.status}</span>
            </div>`;
        }).join('');
    } catch(_) { list.innerHTML = '<div class="text-xs text-red-400 py-2 text-center">Failed to load</div>'; }
}

async function sessDoTransfer(convId, opId, opName) {
    document.getElementById('sess-transfer-modal').classList.add('hidden');
    try {
        const r = await fetch('/admin/sessions/transfer', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({conversation_id: convId, operator_id: opId}),
        });
        const d = await r.json();
        if (d.success) { showToast(`Transferred to ${opName}`); sessLoad(); }
        else showToast(d.error || 'Transfer failed', true);
    } catch(_) { showToast('Network error', true); }
}

async function sessEndSession(convId) {
    if (!confirm('End this session?')) return;
    try {
        const r = await fetch('/admin/sessions/end', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({conversation_id: convId}),
        });
        const d = await r.json();
        if (d.success) { showToast('Session ended'); sessLoad(); }
        else showToast(d.error || 'Failed', true);
    } catch(_) { showToast('Network error', true); }
}

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
