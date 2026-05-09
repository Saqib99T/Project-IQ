// ── Chat History ──────────────────────────────────────────────────────────────
let _chPage = 1;
let _chTotal = 0;
let _chPerPage = 50;
let _chDebounceTimer = null;

async function chInit() {
    await Promise.all([chLoadFilters(), chLoad(1)]);
}

async function chLoadFilters() {
    try {
        const [opsRes, appsRes] = await Promise.all([
            fetch('/admin/sessions/operators'),
            fetch('/admin/analytics/apps'),
        ]);
        const ops  = (await opsRes.json()).operators || [];
        const apps = (await appsRes.json()).apps     || [];

        const opSel  = document.getElementById('ch-filter-op');
        const appSel = document.getElementById('ch-filter-app');
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
            const id  = a.app_id || a;
            const opt = document.createElement('option');
            opt.value = id; opt.textContent = id;
            appSel.appendChild(opt);
        });
    } catch(_) {}
}

async function chLoad(page) {
    if (page) _chPage = page;
    const search = document.getElementById('ch-search')?.value.trim()  || '';
    const app    = document.getElementById('ch-filter-app')?.value      || '';
    const status = document.getElementById('ch-filter-status')?.value   || '';
    const op     = document.getElementById('ch-filter-op')?.value       || '';
    const from   = document.getElementById('ch-date-from')?.value       || '';
    const to     = document.getElementById('ch-date-to')?.value         || '';

    const params = new URLSearchParams({ page: _chPage, per_page: _chPerPage });
    if (search) params.set('search', search);
    if (app)    params.set('app_id', app);
    if (status) params.set('status', status);
    if (op)     params.set('operator_id', op);
    if (from)   params.set('date_from', from);
    if (to)     params.set('date_to', to + 'T23:59:59');

    const tbody = document.getElementById('ch-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">Loading…</td></tr>';

    try {
        const r    = await fetch(`/admin/sessions/history?${params}`);
        const data = await r.json();
        if (!data.success) return;
        _chTotal = data.total || 0;
        chRender(data.sessions || []);
        chUpdatePagination();
    } catch(_) {}
}

function chDebounce() {
    clearTimeout(_chDebounceTimer);
    _chDebounceTimer = setTimeout(() => chLoad(1), 400);
}

function chPage(delta) {
    const maxPage = Math.ceil(_chTotal / _chPerPage);
    _chPage = Math.max(1, Math.min(maxPage, _chPage + delta));
    chLoad();
}

function chUpdatePagination() {
    const maxPage = Math.ceil(_chTotal / _chPerPage);
    const start   = (_chPage - 1) * _chPerPage + 1;
    const end     = Math.min(_chPage * _chPerPage, _chTotal);
    const info    = document.getElementById('ch-pagination-info');
    const num     = document.getElementById('ch-page-num');
    const prev    = document.getElementById('ch-prev');
    const next    = document.getElementById('ch-next');
    if (info) info.textContent = _chTotal ? `${start}–${end} of ${_chTotal}` : 'No results';
    if (num)  num.textContent  = `Page ${_chPage} / ${maxPage || 1}`;
    if (prev) prev.disabled    = _chPage <= 1;
    if (next) next.disabled    = _chPage >= maxPage;
}

function chRender(rows) {
    const tbody = document.getElementById('ch-tbody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400">No sessions found</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => {
        const user    = r.user_name || r.user_id || (r.sender_id?.slice(0,16) + '…') || '—';
        const status  = chStatusBadge(r);
        const op      = r.operator_name || '—';
        const started = r.started_at ? new Date(r.started_at).toLocaleString() : '—';
        const dur     = chHandleDuration(r);
        const msgs    = r.message_count ?? '—';

        return `<tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="px-4 py-3">
                <div class="font-medium text-gray-800">${chEsc(user)}</div>
                <div class="text-xs text-gray-400 font-mono">${chEsc(r.app_id)}</div>
            </td>
            <td class="px-4 py-3"><span class="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-medium">${chEsc(r.app_id)}</span></td>
            <td class="px-4 py-3">${status}</td>
            <td class="px-4 py-3 text-gray-700 text-sm">${chEsc(op)}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">${started}</td>
            <td class="px-4 py-3 text-gray-600 text-xs font-mono">${dur}</td>
            <td class="px-4 py-3 text-gray-600">${msgs}</td>
            <td class="px-4 py-3">
                <button onclick="chViewTranscript(${r.id},'${chEsc(user)}','${started}')"
                    class="px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-medium">View</button>
            </td>
        </tr>`;
    }).join('');
}

function chStatusBadge(r) {
    if (!r.queue_id) return '<span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">🤖 Bot</span>';
    const map = {
        resolved:  '<span class="px-2 py-1 bg-green-50 text-green-600 rounded text-xs">✅ Resolved</span>',
        abandoned: '<span class="px-2 py-1 bg-red-50 text-red-500 rounded text-xs">⛔ Abandoned</span>',
        assigned:  '<span class="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs">👤 Active</span>',
        waiting:   '<span class="px-2 py-1 bg-amber-50 text-amber-600 rounded text-xs">⏳ Queue</span>',
    };
    return map[r.handoff_status] || `<span class="px-2 py-1 bg-gray-100 text-gray-500 rounded text-xs">${r.handoff_status || '—'}</span>`;
}

function chHandleDuration(r) {
    if (r.handle_time_secs) {
        const s = r.handle_time_secs;
        if (s < 60)   return `${s}s`;
        if (s < 3600) return `${Math.floor(s/60)}m`;
        return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
    }
    if (r.started_at && r.ended_at) {
        const s = Math.floor((new Date(r.ended_at) - new Date(r.started_at)) / 1000);
        if (s < 60)   return `${s}s`;
        if (s < 3600) return `${Math.floor(s/60)}m`;
        return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
    }
    return '—';
}

async function chViewTranscript(convId, user, started) {
    document.getElementById('ch-modal-title').textContent = user;
    document.getElementById('ch-modal-sub').textContent   = `#${convId} · Started ${started}`;
    document.getElementById('ch-modal-messages').innerHTML = '<div class="text-center text-gray-400 py-4">Loading…</div>';
    document.getElementById('ch-modal').classList.remove('hidden');
    try {
        const r    = await fetch(`/admin/sessions/history/${convId}/messages`);
        const data = await r.json();
        chRenderMessages(data.messages || []);
    } catch(_) {
        document.getElementById('ch-modal-messages').innerHTML = '<div class="text-red-400 text-center py-4">Failed to load</div>';
    }
}

function chRenderMessages(msgs) {
    const el = document.getElementById('ch-modal-messages');
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
            <div class="text-sm text-gray-800">${chEsc(m.text || '')}</div>
            ${m.intent ? `<span class="inline-block mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-600 rounded">🎯 ${chEsc(m.intent)}</span>` : ''}
        </div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
}

function chReset() {
    ['ch-search','ch-filter-app','ch-filter-status','ch-filter-op','ch-date-from','ch-date-to']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    chLoad(1);
}

function chExport() {
    window.open('/admin/sessions/history/export', '_blank');
}

function chEsc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
