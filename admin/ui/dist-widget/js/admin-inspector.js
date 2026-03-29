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
    if (tab === 'domain') loadDomain();
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
    if (activeTab === 'domain') loadDomain();
}

// ============================================
// NLU TESTER
// ============================================
async function testNLU() {
    const text = document.getElementById('nlu-test-input')?.value;
    if (!text) return;

    try {
        const [parseRes, webhookRes] = await Promise.all([
            fetch('/api/rasa/model/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            }),
            fetch('/api/rasa/webhooks/rest/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: 'nlu_tester', message: text })
            })
        ]);

        const data = await parseRes.json();
        const botResponse = await webhookRes.json();

        document.getElementById('nlu-results').classList.remove('hidden');
        document.getElementById('nlu-empty').classList.add('hidden');

        // Intent
        const intent = data.intent?.name || 'unknown';
        const confidence = data.intent?.confidence || 0;
        document.getElementById('nlu-intent').textContent = intent;

        // Confidence bar
        const confidencePercent = (confidence * 100).toFixed(1);
        const fill = document.getElementById('nlu-confidence-fill');
        fill.style.width = confidencePercent + '%';
        fill.textContent = confidencePercent + '%';
        fill.className = confidence > 0.8
            ? 'bg-green-600 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold'
            : confidence > 0.5
                ? 'bg-yellow-600 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold'
                : 'bg-red-600 h-6 rounded-full flex items-center justify-center text-white text-xs font-semibold';

        // Intent ranking
        const ranking = data.intent_ranking || [];
        document.getElementById('nlu-intent-ranking').innerHTML = ranking.slice(0, 5).map(i => `
            <div class="flex items-center gap-2 text-xs p-2 bg-gray-50 rounded">
                <span class="font-medium w-32 truncate">${i.name}</span>
                <div class="flex-1 bg-gray-200 rounded h-3">
                    <div class="bg-purple-500 h-3 rounded" style="width: ${(i.confidence * 100).toFixed(0)}%"></div>
                </div>
                <span class="w-10 text-right">${(i.confidence * 100).toFixed(1)}%</span>
            </div>
        `).join('');

        // Entities
        const entities = data.entities || [];
        if (entities.length > 0) {
            document.getElementById('nlu-entities').classList.remove('hidden');
            document.getElementById('nlu-no-entities').classList.add('hidden');
            document.getElementById('nlu-entities').innerHTML = entities.map(e => `
                <div class="p-2 bg-blue-50 rounded">
                    <div class="flex items-center justify-between">
                        <span class="font-semibold text-blue-700">${e.entity}</span>
                        <span class="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded">${(e.confidence || 1).toFixed(2)}</span>
                    </div>
                    <div class="text-sm text-blue-600 mt-1">"${e.value}"</div>
                </div>
            `).join('');
        } else {
            document.getElementById('nlu-entities').classList.add('hidden');
            document.getElementById('nlu-no-entities').classList.remove('hidden');
        }

        // Bot response & actions
        document.getElementById('nlu-actions').innerHTML = botResponse.map(r => `
            <div class="text-sm p-2 bg-orange-50 rounded">
                <div class="font-semibold text-orange-700">${r.text ? 'utter_message' : 'custom_action'}</div>
                ${r.text ? `<div class="text-orange-600 text-xs mt-1">${r.text}</div>` : ''}
            </div>
        `).join('') || '<div class="text-sm text-gray-500">No actions executed</div>';

    } catch (e) {
        console.error('NLU test failed:', e);
        alert('Failed to test NLU. Make sure Rasa server is running on port 5005.');
    }
}

// ============================================
// SLOT STATE
// ============================================
async function loadSlots() {
    const senderId = document.getElementById('slot-sender-id')?.value;
    if (!senderId) {
        alert('Please enter a conversation ID');
        return;
    }

    try {
        const res = await fetch(`/api/rasa/conversations/${senderId}/tracker`);
        const data = await res.json();

        const slots = data.slots || {};
        const slotEntries = Object.entries(slots);

        if (slotEntries.length === 0) {
            alert('No slots found for this conversation');
            return;
        }

        const filledEntries = slotEntries.filter(([k, v]) => v !== null);

        document.getElementById('slots-results').classList.remove('hidden');
        document.getElementById('slots-empty').classList.add('hidden');
        document.getElementById('slots-count').textContent = `${filledEntries.length} filled / ${slotEntries.length} total`;

        document.getElementById('slots-tbody').innerHTML = slotEntries.map(([key, value]) => {
            const isFilled = value !== null;
            const displayVal = value === null ? '—' : (typeof value === 'object' ? JSON.stringify(value) : value);
            return `
            <tr class="border-t hover:bg-gray-50 ${isFilled ? '' : 'opacity-40'}">
                <td class="px-4 py-2 font-medium">${key}</td>
                <td class="px-4 py-2">
                    <code class="text-xs ${isFilled ? 'bg-gray-100' : 'bg-transparent text-gray-400'} px-2 py-1 rounded">${displayVal}</code>
                </td>
                <td class="px-4 py-2 text-gray-500 text-xs">${value === null ? 'null' : typeof value}</td>
                <td class="px-4 py-2 text-right">
                    ${isFilled ? `<button onclick="clearSlot('${senderId}', '${key}')" class="text-xs text-red-600 hover:text-red-800">Clear</button>` : ''}
                </td>
            </tr>
        `}).join('');

    } catch (e) {
        console.error('Failed to load slots:', e);
        alert('Failed to load slots. Make sure Rasa server is running and the conversation ID is valid.');
    }
}

async function clearSlot(senderId, slotName) {
    if (!confirm(`Clear slot "${slotName}"?`)) return;

    try {
        await fetch(`/api/rasa/conversations/${senderId}/tracker/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'slot',
                name: slotName,
                value: null
            })
        });
        loadSlots();
    } catch (e) {
        console.error('Failed to clear slot:', e);
        alert('Failed to clear slot');
    }
}

async function clearAllSlots() {
    const senderId = document.getElementById('slot-sender-id')?.value;
    if (!senderId) return;

    if (!confirm('Clear ALL slots for this conversation?')) return;

    try {
        await fetch(`/api/rasa/conversations/${senderId}/tracker/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event: 'restart'
            })
        });
        document.getElementById('slots-results').classList.add('hidden');
        document.getElementById('slots-empty').classList.remove('hidden');
        alert('All slots cleared');
    } catch (e) {
        console.error('Failed to clear slots:', e);
        alert('Failed to clear slots');
    }
}

// ============================================
// DOMAIN
// ============================================
async function loadDomain() {
    try {
        const res = await fetch('/api/rasa/domain');
        const domain = await res.json();

        // Counts
        document.getElementById('domain-intents-count').textContent = (domain.intents || []).length;
        document.getElementById('domain-actions-count').textContent = (domain.actions || []).length;
        document.getElementById('domain-slots-count').textContent = Object.keys(domain.slots || {}).length;
        document.getElementById('domain-responses-count').textContent = Object.keys(domain.responses || {}).length;

        // Intents
        const intents = domain.intents || [];
        document.getElementById('domain-intents-list').innerHTML = intents.map(i =>
            `<div class="p-2 bg-blue-50 text-blue-700 rounded text-xs">${i}</div>`
        ).join('') || '<div class="text-gray-500">No intents</div>';

        // Actions
        const actions = domain.actions || [];
        document.getElementById('domain-actions-list').innerHTML = actions.map(a =>
            `<div class="p-2 bg-purple-50 text-purple-700 rounded text-xs">${a}</div>`
        ).join('') || '<div class="text-gray-500">No actions</div>';

        // Slots
        const slots = domain.slots || {};
        document.getElementById('domain-slots-list').innerHTML = Object.entries(slots).map(([key, config]) => `
            <div class="p-3 bg-green-50 rounded">
                <div class="font-semibold text-green-700 text-sm">${key}</div>
                <div class="text-xs text-green-600 mt-1">
                    Type: ${config.type || 'any'} |
                    Influence: ${config.influence_conversation !== false ? 'Yes' : 'No'}
                </div>
            </div>
        `).join('') || '<div class="text-gray-500">No slots</div>';

        // Responses
        const responses = domain.responses || {};
        document.getElementById('domain-responses-list').innerHTML = Object.entries(responses).map(([key, templates]) => `
            <div class="p-2 bg-orange-50 rounded">
                <div class="font-semibold text-orange-700 text-xs">${key}</div>
                <div class="text-xs text-orange-600">${templates.length} template${templates.length !== 1 ? 's' : ''}</div>
            </div>
        `).join('') || '<div class="text-gray-500">No responses</div>';

        // Entities
        const entities = domain.entities || [];
        document.getElementById('domain-entities-list').innerHTML = entities.map(e =>
            `<div class="p-2 bg-indigo-50 text-indigo-700 rounded text-xs">${e}</div>`
        ).join('') || '<div class="text-gray-500">No entities</div>';

    } catch (e) {
        console.error('Failed to load domain:', e);
        alert('Failed to load domain. Make sure Rasa server is running on port 5005.');
    }
}

function showDomainSection(section) {
    // Update buttons
    document.querySelectorAll('.domain-section-btn').forEach(btn => {
        if (btn.dataset.section === section) {
            btn.className = 'domain-section-btn px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded';
        } else {
            btn.className = 'domain-section-btn px-3 py-2 text-sm bg-gray-100 text-gray-600 rounded';
        }
    });

    // Show section
    document.querySelectorAll('.domain-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(`domain-section-${section}`)?.classList.remove('hidden');
}
