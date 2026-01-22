// Inspector Logic
let inspectorConversations = [];
let selectedInspConv = null;

async function loadInspectorData() {
    loadAppList();  // Load app list for filters
    await loadInspectorConversations();  // Load conversations
}

async function loadAppList() {
    try {
        const res = await fetch(`${ADMIN_API}/analytics/apps?t=` + Date.now());
        const data = await res.json();
        if (data.success) {
            const select = document.getElementById('filter-app');
            if (select) {
                const currentVal = select.value;
                select.innerHTML = '<option value="all">All Apps</option>' +
                    data.apps.map(app => `<option value="${app.app_id}">${app.name}</option>`).join('');
                select.value = currentVal;
            }
        }
    } catch (e) { console.error('Failed to load apps', e); }
}

async function loadInspectorConversations() {
    try {
        const app = document.getElementById('filter-app')?.value || '';

        const params = new URLSearchParams({ limit: 100 });

        // Only send app_id if it's not 'all' (backend supports app_id filter)
        if (app && app !== 'all') {
            params.append('app_id', app);
        }

        const res = await fetch(`/inspector/conversations?${params.toString()}`);
        const data = await res.json();
        if (data.success) {
            inspectorConversations = data.data;
            renderInspectorConvList();

            // Update count
            const countEl = document.getElementById('conv-count');
            if (countEl) countEl.textContent = data.data.length + (data.data.length >= 100 ? '+' : '');
        }
    } catch (e) {
        console.error('Failed to load conversations:', e);
        document.getElementById('inspector-conv-list').innerHTML = '<div class="text-red-500">Failed to load</div>';
    }
}

// Filter handling
function applyInspectorFilters() {
    // Show/hide custom date range
    const dateFilter = document.getElementById('filter-date')?.value;
    const customRange = document.getElementById('custom-date-range');
    if (customRange) {
        customRange.classList.toggle('hidden', dateFilter !== 'custom');
    }

    renderInspectorConvList(); // Just cleanup UI of tags
    loadInspectorConversations(); // Fetch new data
    updateActiveFilterTags();
}

function resetInspectorFilters() {
    document.getElementById('filter-user').value = '';
    document.getElementById('filter-app').value = '';
    document.getElementById('filter-ticket-status').value = '';
    document.getElementById('filter-date').value = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    document.getElementById('custom-date-range').classList.add('hidden');
    applyInspectorFilters();
}

function updateActiveFilterTags() {
    const container = document.getElementById('active-filter-tags');
    const wrapper = document.getElementById('active-filters');
    if (!container || !wrapper) return;

    const filters = [];

    const user = document.getElementById('filter-user')?.value;
    if (user) filters.push({ label: `User: ${user}`, type: 'user' });

    const app = document.getElementById('filter-app')?.value;
    if (app) filters.push({ label: `App: ${app}`, type: 'app' });

    const status = document.getElementById('filter-ticket-status')?.value;
    if (status) filters.push({ label: `Status: ${status}`, type: 'ticket-status' });

    const date = document.getElementById('filter-date')?.value;
    if (date && date !== 'custom') filters.push({ label: `Date: ${date}`, type: 'date' });
    if (date === 'custom') {
        const from = document.getElementById('filter-date-from')?.value;
        const to = document.getElementById('filter-date-to')?.value;
        if (from || to) filters.push({ label: `Date: ${from || '?'} to ${to || '?'}`, type: 'date' });
    }

    if (filters.length === 0) {
        wrapper.classList.add('hidden');
        return;
    }

    wrapper.classList.remove('hidden');
    container.innerHTML = filters.map(f => `
        <span class="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded-full flex items-center gap-1">
            ${f.label}
            <button onclick="clearFilter('${f.type}')" class="hover:text-red-600">×</button>
        </span>
    `).join('');
}

function clearFilter(type) {
    if (type === 'user') document.getElementById('filter-user').value = '';
    if (type === 'app') document.getElementById('filter-app').value = '';
    if (type === 'ticket-status') document.getElementById('filter-ticket-status').value = '';
    if (type === 'date') {
        document.getElementById('filter-date').value = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
    }
    applyInspectorFilters();
}

function filterInspectorConversations() {
    // Debounced load or direct load
    loadInspectorConversations();
}

function renderInspectorConvList() {
    // Data is already filtered from backend
    const filtered = inspectorConversations;

    const html = filtered.map(c => {
        const userName = c.user_name || c.user_id || null;
        const statusIcon = c.resolved ? '✅' : (c.ticket_id ? '🎫' : '🔵');
        return `
        <div onclick="selectInspConversation('${c.sender_id}')" 
             class="p-2 rounded cursor-pointer hover:bg-gray-100 border ${selectedInspConv?.sender_id === c.sender_id ? 'border-purple-500 bg-purple-50' : 'border-gray-200'}">
            <div class="flex justify-between items-start">
                <div>
                    ${userName ? `<div class="font-medium text-sm text-purple-700">👤 ${userName}</div>` : ''}
                    <div class="font-mono text-xs text-gray-500">${c.sender_id_short}</div>
                </div>
                <span class="text-xs">${statusIcon}</span>
            </div>
            <div class="text-xs text-gray-500 mt-1">${c.app_id} • ${c.message_count} msgs</div>
            ${c.ticket_id ? `<div class="text-xs text-blue-600 mt-0.5">🎫 Ticket #${c.ticket_id}</div>` : ''}
        </div>
    `}).join('');
    document.getElementById('inspector-conv-list').innerHTML = html || '<div class="text-gray-500">No conversations match filters</div>';
}

async function selectInspConversation(senderId) {
    selectedInspConv = inspectorConversations.find(c => c.sender_id === senderId);
    renderInspectorConvList();
    try {
        const res = await fetch(`/inspector/conversation/${encodeURIComponent(senderId)}`);
        const data = await res.json();
        if (data.success) {
            document.getElementById('inspector-no-selection').classList.add('hidden');
            document.getElementById('inspector-conv-detail').classList.remove('hidden');
            document.getElementById('insp-msg-count').textContent = data.data.stats.total_messages;
            document.getElementById('insp-action-count').textContent = data.data.stats.actions_executed;
            document.getElementById('insp-intent-count').textContent = data.data.stats.unique_intents;

            const msgsHtml = data.data.messages.map(m => `
                <div class="p-2 rounded text-sm ${m.sender === 'user' ? 'bg-blue-50 border-l-4 border-blue-400 ml-8' : 'bg-gray-50 border-l-4 border-gray-300 mr-8'}">
                    <div class="flex justify-between text-xs mb-1">
                        <b>${m.sender === 'user' ? '👤 User' : '🤖 Bot'}</b>
                        <span class="text-gray-400">${m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : ''}</span>
                    </div>
                    <div>${m.text || ''}</div>
                    ${m.intent ? `<span class="inline-block mt-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">🎯 ${m.intent}</span>` : ''}
                </div>
            `).join('');
            document.getElementById('inspector-messages').innerHTML = msgsHtml;
        }
    } catch (e) { console.error(e); }
}

function showInspectorTab(tab) {
    document.querySelectorAll('.inspector-tab-content').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.inspector-tab-btn').forEach(b => {
        b.classList.remove('bg-purple-600', 'text-white');
        b.classList.add('bg-gray-200', 'text-gray-700');
    });
    document.getElementById(`inspector-tab-${tab}`).classList.remove('hidden');
    document.querySelector(`[data-tab="${tab}"]`).classList.remove('bg-gray-200', 'text-gray-700');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('bg-purple-600', 'text-white');

    if (tab === 'flows') loadInspectorFlows();
    if (tab === 'intents') loadInspectorIntents();
    if (tab === 'actions') loadInspectorActions();
}

async function loadInspectorFlows() {
    try {
        const res = await fetch(`/inspector/flows`);
        const data = await res.json();
        if (data.success) {
            const html = data.data.map(f => `
                <div class="card p-3">
                    <div class="flex gap-2 mb-2">
                        <span class="px-2 py-0.5 text-xs rounded ${f.type === 'story' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">${f.type}</span>
                        <span class="font-semibold text-sm">${f.name}</span>
                    </div>
                    <div class="space-y-1 text-xs">
                        ${f.steps.map(s => {
                if (s.intent) return `<div class="p-1 bg-green-50 border-l-2 border-green-400 rounded">🎯 ${s.intent}</div>`;
                if (s.action) return `<div class="p-1 bg-blue-50 border-l-2 border-blue-400 rounded">⚡ ${s.action}</div>`;
                return '';
            }).join('')}
                    </div>
                </div>
            `).join('');
            document.getElementById('inspector-flows-grid').innerHTML = html || '<div class="text-gray-500">No flows defined</div>';
        }
    } catch (e) { document.getElementById('inspector-flows-grid').innerHTML = '<div class="text-red-500">Failed to load</div>'; }
}

async function loadInspectorIntents() {
    try {
        const res = await fetch(`/inspector/intents`);
        const data = await res.json();
        if (data.success) {
            const d = data.data;
            document.getElementById('insp-total-intents').textContent = d.total_intent_messages;
            document.getElementById('insp-unique-intents').textContent = Object.keys(d.distribution).length;
            const sorted = Object.entries(d.distribution).sort((a, b) => b[1] - a[1]).slice(0, 10);
            const max = Math.max(...sorted.map(s => s[1]));
            const html = sorted.map(([intent, count]) => `
                <div class="mb-3">
                    <div class="flex justify-between text-sm mb-1">
                        <span class="font-mono">${intent}</span>
                        <span class="text-gray-500">${count}</span>
                    </div>
                    <div class="h-3 bg-gray-200 rounded overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-purple-500 to-blue-500" style="width: ${(count / max) * 100}%"></div>
                    </div>
                </div>
            `).join('');
            document.getElementById('inspector-intent-chart').innerHTML = html || '<div class="text-gray-500">No intent data</div>';
        }
    } catch (e) { document.getElementById('inspector-intent-chart').innerHTML = '<div class="text-red-500">Failed to load</div>'; }
}

async function loadInspectorActions() {
    try {
        const res = await fetch(`/inspector/actions`);
        const data = await res.json();
        if (data.success) {
            const html = data.data.map(a => `
                <tr class="border-t">
                    <td class="px-4 py-2 font-mono text-purple-600">${a.action}</td>
                    <td class="px-4 py-2">${a.total}</td>
                    <td class="px-4 py-2 text-green-600">${a.success}</td>
                    <td class="px-4 py-2 text-red-600">${a.failure}</td>
                    <td class="px-4 py-2">
                        <span class="px-2 py-1 rounded text-xs ${a.success_rate >= 90 ? 'bg-green-100 text-green-700' : a.success_rate >= 70 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}">
                            ${a.success_rate}%
                        </span>
                    </td>
                </tr>
            `).join('');
            document.getElementById('inspector-actions-table').innerHTML = html || '<tr><td colspan="5" class="text-gray-500 p-4">No action data</td></tr>';
        }
    } catch (e) { document.getElementById('inspector-actions-table').innerHTML = '<tr><td colspan="5" class="text-red-500 p-4">Failed to load</td></tr>'; }
}

function refreshInspector() {
    loadAppList();
    loadInspectorConversations();
    const activeTab = document.querySelector('.inspector-tab-btn.bg-purple-600')?.dataset.tab || 'conversations';
    if (activeTab === 'flows') loadInspectorFlows();
    if (activeTab === 'intents') loadInspectorIntents();
    if (activeTab === 'actions') loadInspectorActions();
}
