// Inspector Dashboard - Real-Time Debugging
// NLU parsing, slot visualization, conversation analysis

let inspectorConversations = [];
let selectedInspConv = null;

async function loadInspectorData() {
    loadInspAppList();  // Load app list for filters
    await applyInspFilters();  // Use filters to load conversations
    loadDomainInfo();
    loadRecentConvsForSlots();
}

// ============================================================================
// Conversations Tab
// ============================================================================

async function loadInspectorConversations() {
    try {
        const res = await fetch(`/inspector/conversations?limit=50`);
        const data = await res.json();

        if (data.success) {
            inspectorConversations = data.data;
            renderInspectorConvList(inspectorConversations);
        }
    } catch (e) {
        console.error('Failed to load conversations:', e);
        document.getElementById('insp-conv-list').innerHTML = '<div class="text-red-400 text-sm">Failed to load</div>';
    }
}

function renderInspectorConvList(conversations) {
    const container = document.getElementById('insp-conv-list');
    const countEl = document.getElementById('insp-conv-count');

    if (countEl) countEl.textContent = `${conversations.length} found`;

    if (!conversations || conversations.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm text-center py-4">No conversations match filters</div>';
        return;
    }

    const html = conversations.map(c => {
        // Use full sender_id for selection, fallback to regular sender_id
        const fullSenderId = c.sender_id_full || c.sender_id;
        const isSelected = selectedInspConv?.sender_id === fullSenderId || selectedInspConv?.sender_id_full === fullSenderId;
        const userName = c.user_name || c.user_id || null;
        const lastActivity = c.last_activity ? formatInspDateTime(new Date(c.last_activity)) : '';

        // Ticket badge
        let ticketBadge = '';
        if (c.ticket_activity === 'created') ticketBadge = '<span class="text-xs text-green-600">🎫</span>';
        else if (c.ticket_activity === 'updated') ticketBadge = '<span class="text-xs text-blue-600">✏️</span>';
        if (c.resolved) ticketBadge = '<span class="text-xs text-purple-600">✅</span>';

        return `
        <div onclick="selectInspConversation('${fullSenderId}')" 
             class="p-3 rounded-lg cursor-pointer border transition-all ${isSelected ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-300 hover:bg-gray-50'}">
            <div class="flex justify-between items-start">
                <div>
                    ${userName ? `<div class="font-medium text-sm text-purple-700">👤 ${userName}</div>` : ''}
                    <div class="font-mono text-xs text-gray-500">${c.sender_id || c.sender_id_full?.substring(0, 12) + '...'}</div>
                </div>
                ${ticketBadge}
            </div>
            <div class="flex justify-between mt-2 text-xs text-gray-500">
                <span class="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">${c.app_id || 'General'}</span>
                <span>${c.message_count || 0} msgs</span>
            </div>
            ${lastActivity ? `<div class="text-xs text-gray-400 mt-1">${lastActivity}</div>` : ''}
        </div>`;
    }).join('');

    container.innerHTML = html;
}

// ============================================================================
// Inspector Filters (same as Analytics)
// ============================================================================

let inspFilterTimeout = null;

function debounceInspFilter() {
    clearTimeout(inspFilterTimeout);
    inspFilterTimeout = setTimeout(() => {
        applyInspFilters();
    }, 400);
}

function clearInspFilters() {
    document.getElementById('insp-filter-user').value = '';
    document.getElementById('insp-filter-app').value = 'all';
    document.getElementById('insp-filter-ticket').value = 'all';
    document.getElementById('insp-filter-date').value = 'all';
    applyInspFilters();
}

async function applyInspFilters() {
    try {
        const params = new URLSearchParams();

        const userSearch = document.getElementById('insp-filter-user')?.value?.trim();
        const appFilter = document.getElementById('insp-filter-app')?.value;
        const ticketFilter = document.getElementById('insp-filter-ticket')?.value;
        const dateFilter = document.getElementById('insp-filter-date')?.value;

        if (userSearch) params.append('user', userSearch);
        if (appFilter && appFilter !== 'all') params.append('app_id', appFilter);
        if (ticketFilter && ticketFilter !== 'all') params.append('ticket_status', ticketFilter);
        if (dateFilter && dateFilter !== 'all') params.append('date', dateFilter);
        params.append('limit', '100');

        const queryString = params.toString() ? `?${params.toString()}` : '?limit=100';
        const res = await fetch(`/inspector/conversations${queryString}`);
        const data = await res.json();

        if (data.success) {
            inspectorConversations = data.data;
            renderInspectorConvList(inspectorConversations);
        }
    } catch (e) {
        console.error('Failed to filter conversations:', e);
        document.getElementById('insp-conv-list').innerHTML = '<div class="text-red-400 text-sm">Failed to load</div>';
    }
}

function loadInspAppList() {
    // Populate app dropdown for inspector
    const selector = document.getElementById('insp-filter-app');
    if (!selector) return;

    fetch(`${ADMIN_API}/analytics/apps`)
        .then(res => res.json())
        .then(data => {
            if (data.success && data.apps) {
                // Start with "All Apps" option
                selector.innerHTML = '<option value="all">All Apps</option>';
                data.apps.forEach(app => {
                    const appId = app.app_id || app;
                    const appName = app.name || app;
                    selector.innerHTML += `<option value="${appId}">${appName}</option>`;
                });
            }
        })
        .catch(e => console.error('Failed to load apps:', e));
}

function formatInspDateTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 4) return `${diffHours} hours ago`;

    if (date.toDateString() === now.toDateString()) {
        return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function selectInspConversation(senderId) {
    // Find by sender_id_full or sender_id (for backward compatibility)
    selectedInspConv = inspectorConversations.find(c =>
        c.sender_id_full === senderId || c.sender_id === senderId
    );

    // Store the full sender_id for API calls
    if (selectedInspConv) {
        selectedInspConv.sender_id = senderId;  // Ensure we have the full ID
    }

    document.getElementById('insp-selected-conv').textContent = selectedInspConv?.display_name || senderId.substring(0, 12) + '...';

    // Re-render list to show selection
    renderInspectorConvList(inspectorConversations);

    // Load messages using the full sender_id
    await loadConversationMessages(senderId);
}

async function loadConversationMessages(senderId) {
    try {
        const res = await fetch(`/inspector/conversation/${senderId}`);
        const data = await res.json();

        if (data.success) {
            renderConversationMessages(data.data.messages);
        }
    } catch (e) {
        console.error('Failed to load messages:', e);
    }
}

function renderConversationMessages(messages) {
    const container = document.getElementById('insp-conv-messages');

    if (!messages || messages.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-sm text-center py-8">No messages in this conversation</div>';
        return;
    }

    const html = messages.map(m => {
        const isUser = m.role === 'user' || m.sender === 'user';
        const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';

        return `
        <div class="flex ${isUser ? 'justify-start' : 'justify-end'}">
            <div class="max-w-[80%] ${isUser ? 'bg-gray-100' : 'bg-purple-100'} rounded-lg p-3">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-xs font-medium ${isUser ? 'text-gray-600' : 'text-purple-600'}">
                        ${isUser ? '👤 User' : '🤖 Bot'}
                    </span>
                    <span class="text-xs text-gray-400">${time}</span>
                </div>
                <div class="text-sm">${escapeHtml(m.text || m.content || '')}</div>
                ${m.intent ? `<div class="mt-1 text-xs text-green-600">Intent: ${m.intent}</div>` : ''}
            </div>
        </div>`;
    }).join('');

    container.innerHTML = html;
}

// ============================================================================
// Turn Debugger Tab
// ============================================================================

async function debugSelectedConversation() {
    if (!selectedInspConv) {
        showToast('Please select a conversation first', true);
        return;
    }

    showInspectorTab('debugger');
    document.getElementById('debug-conv-id').textContent = `Sender: ${selectedInspConv.sender_id_short}`;

    try {
        const res = await fetch(`/inspector/conversation/${selectedInspConv.sender_id}/debug`);
        const data = await res.json();

        if (data.success) {
            renderDebugTurns(data.turns, data.current_slots);
        } else {
            document.getElementById('debug-turns-container').innerHTML = `
                <div class="text-yellow-600 text-center py-4">
                    ⚠️ ${data.error || 'Could not load debug data'}. 
                    <br><span class="text-sm text-gray-500">Make sure Rasa Core is running on port 5005.</span>
                </div>`;
        }
    } catch (e) {
        document.getElementById('debug-turns-container').innerHTML = `
            <div class="text-red-400 text-center py-4">Failed to load debug data: ${e.message}</div>`;
    }
}

function renderDebugTurns(turns, currentSlots) {
    const container = document.getElementById('debug-turns-container');

    if (!turns || turns.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-center py-8">No debug data available for this conversation</div>';
        return;
    }

    const html = turns.map((turn, i) => {
        const intent = turn.intent || {};
        const intentRanking = turn.intent_ranking || [];
        const entities = turn.entities || [];
        const actions = turn.actions || [];
        const botResponses = turn.bot_responses || [];
        const slotsBefore = turn.slots_before || {};
        const slotsAfter = turn.slots_after || {};

        // Find slot changes
        const slotChanges = [];
        for (const [key, value] of Object.entries(slotsAfter)) {
            if (slotsBefore[key] !== value) {
                slotChanges.push({ slot: key, from: slotsBefore[key], to: value });
            }
        }

        return `
        <div class="border rounded-lg p-4 bg-white">
            <div class="flex justify-between items-center mb-3">
                <span class="font-semibold text-gray-700">Turn ${i + 1}</span>
                <span class="text-xs text-gray-400">${turn.timestamp || ''}</span>
            </div>
            
            <!-- User Message -->
            <div class="bg-gray-50 rounded p-3 mb-3">
                <div class="text-xs text-gray-500 mb-1">👤 User:</div>
                <div class="font-medium">"${escapeHtml(turn.text)}"</div>
            </div>
            
            <!-- Intent -->
            <div class="grid grid-cols-2 gap-4 mb-3">
                <div>
                    <div class="text-xs font-medium text-gray-500 mb-1">🎯 Detected Intent</div>
                    <div class="flex items-center gap-2">
                        <span class="px-2 py-1 bg-green-100 text-green-700 rounded text-sm font-medium">${intent.name || 'unknown'}</span>
                        <span class="text-xs text-gray-500">${Math.round((intent.confidence || 0) * 100)}%</span>
                    </div>
                    ${intentRanking.length > 1 ? `
                    <div class="text-xs text-gray-400 mt-1">
                        Others: ${intentRanking.slice(1, 3).map(r => `${r.name} (${Math.round((r.confidence || 0) * 100)}%)`).join(', ')}
                    </div>` : ''}
                </div>
                
                <div>
                    <div class="text-xs font-medium text-gray-500 mb-1">📦 Entities</div>
                    ${entities.length > 0 ? entities.map(e => `
                        <span class="inline-block px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs mr-1 mb-1">
                            ${e.entity}: "${e.value}"
                        </span>
                    `).join('') : '<span class="text-xs text-gray-400">None</span>'}
                </div>
            </div>
            
            <!-- Slot Changes -->
            ${slotChanges.length > 0 ? `
            <div class="mb-3">
                <div class="text-xs font-medium text-gray-500 mb-1">🔄 Slot Changes</div>
                <div class="space-y-1">
                    ${slotChanges.map(sc => `
                        <div class="text-xs">
                            <span class="font-mono text-purple-600">${sc.slot}</span>: 
                            <span class="text-gray-400">${sc.from || 'null'}</span> → 
                            <span class="text-green-600 font-medium">${sc.to || 'null'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
            
            <!-- Actions -->
            ${actions.length > 0 ? `
            <div class="mb-3">
                <div class="text-xs font-medium text-gray-500 mb-1">⚡ Actions Triggered</div>
                <div class="flex flex-wrap gap-1">
                    ${actions.map(a => `
                        <span class="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs">
                            ${a.name} <span class="text-gray-400">(${a.policy || 'policy'})</span>
                        </span>
                    `).join('')}
                </div>
            </div>` : ''}
            
            <!-- Bot Responses -->
            ${botResponses.length > 0 ? `
            <div class="bg-purple-50 rounded p-3">
                <div class="text-xs text-purple-600 mb-1">🤖 Bot Response:</div>
                ${botResponses.map(r => `<div class="text-sm">${escapeHtml(r.text || JSON.stringify(r.data))}</div>`).join('')}
            </div>` : ''}
        </div>`;
    }).join('');

    container.innerHTML = html;
}

// ============================================================================
// Live NLU Tester Tab
// ============================================================================

function setTestMessage(text) {
    document.getElementById('nlu-test-input').value = text;
}

async function testNLUParse() {
    const text = document.getElementById('nlu-test-input').value.trim();

    if (!text) {
        showToast('Please enter a message to test', true);
        return;
    }

    const resultsContainer = document.getElementById('nlu-test-results');
    resultsContainer.innerHTML = '<div class="text-gray-400 text-center py-4">Parsing...</div>';

    try {
        const res = await fetch(`/inspector/parse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        const data = await res.json();

        if (data.success) {
            renderNLUResults(data);
        } else {
            resultsContainer.innerHTML = `
                <div class="text-yellow-600 text-center py-4">
                    ⚠️ ${data.error}
                    <br><span class="text-sm text-gray-500">Make sure Rasa Core is running on port 5005.</span>
                </div>`;
        }
    } catch (e) {
        resultsContainer.innerHTML = `<div class="text-red-400 text-center py-4">Parse failed: ${e.message}</div>`;
    }
}

function renderNLUResults(data) {
    const container = document.getElementById('nlu-test-results');

    const intent = data.intent || {};
    const ranking = data.intent_ranking || [];
    const entities = data.entities || [];

    container.innerHTML = `
        <!-- Primary Intent -->
        <div class="card p-4 border-2 border-green-200">
            <div class="text-xs text-gray-500 mb-1">Primary Intent</div>
            <div class="flex items-center justify-between">
                <span class="text-lg font-bold text-green-700">${intent.name || 'unknown'}</span>
                <span class="text-2xl font-bold text-green-600">${Math.round((intent.confidence || 0) * 100)}%</span>
            </div>
            <div class="mt-2 bg-gray-200 rounded-full h-2 overflow-hidden">
                <div class="bg-green-500 h-full" style="width: ${(intent.confidence || 0) * 100}%"></div>
            </div>
        </div>
        
        <!-- Intent Ranking -->
        ${ranking.length > 1 ? `
        <div>
            <div class="text-xs text-gray-500 mb-2">Intent Ranking</div>
            <div class="space-y-2">
                ${ranking.slice(0, 5).map((r, i) => `
                    <div class="flex items-center gap-2">
                        <span class="w-6 text-xs text-gray-400">#${i + 1}</span>
                        <span class="flex-1 font-mono text-sm">${r.name}</span>
                        <span class="text-sm ${i === 0 ? 'text-green-600 font-medium' : 'text-gray-500'}">${Math.round((r.confidence || 0) * 100)}%</span>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
        
        <!-- Entities -->
        <div>
            <div class="text-xs text-gray-500 mb-2">Extracted Entities (${entities.length})</div>
            ${entities.length > 0 ? `
            <div class="space-y-2">
                ${entities.map(e => `
                    <div class="flex items-center gap-2 p-2 bg-blue-50 rounded">
                        <span class="px-2 py-1 bg-blue-500 text-white rounded text-xs">${e.entity}</span>
                        <span class="font-medium">"${e.value}"</span>
                        ${e.confidence ? `<span class="text-xs text-gray-500">(${Math.round(e.confidence * 100)}%)</span>` : ''}
                    </div>
                `).join('')}
            </div>` : '<div class="text-gray-400 text-sm">No entities extracted</div>'}
        </div>
    `;
}

// ============================================================================
// Slot State Tab
// ============================================================================

async function loadRecentConvsForSlots() {
    try {
        const res = await fetch(`/inspector/conversations?limit=10`);
        const data = await res.json();

        if (data.success) {
            const html = data.data.map(c => `
                <button onclick="setSlotSenderId('${c.sender_id}')" 
                    class="block w-full text-left px-2 py-1 text-xs rounded hover:bg-gray-100 truncate">
                    ${c.display_name || c.sender_id_short}
                </button>
            `).join('');
            document.getElementById('slot-recent-convs').innerHTML = html;
        }
    } catch (e) {
        console.error('Failed to load recent convs:', e);
    }
}

function setSlotSenderId(senderId) {
    document.getElementById('slot-sender-id').value = senderId;
}

async function lookupSlotState() {
    const senderId = document.getElementById('slot-sender-id').value.trim();

    if (!senderId) {
        showToast('Please enter a sender ID', true);
        return;
    }

    const container = document.getElementById('slot-state-display');
    container.innerHTML = '<div class="text-gray-400 text-center py-4">Loading...</div>';

    try {
        const res = await fetch(`/inspector/conversation/${senderId}/tracker`);
        const data = await res.json();

        if (data.success) {
            renderSlotState(data);
        } else {
            container.innerHTML = `
                <div class="text-yellow-600 text-center py-4">
                    ⚠️ ${data.error}
                </div>`;
        }
    } catch (e) {
        container.innerHTML = `<div class="text-red-400 text-center py-4">Failed: ${e.message}</div>`;
    }
}

function renderSlotState(data) {
    const container = document.getElementById('slot-state-display');
    const slots = data.slots || {};
    const slotEntries = Object.entries(slots);

    if (slotEntries.length === 0) {
        container.innerHTML = '<div class="text-gray-400 text-center py-4">No slots set for this conversation</div>';
        return;
    }

    const html = `
        <div class="mb-4">
            <span class="text-xs text-gray-500">Latest Action:</span>
            <span class="ml-2 px-2 py-1 bg-orange-100 text-orange-700 rounded text-sm">${data.latest_action || 'None'}</span>
            ${data.active_loop?.name ? `<span class="ml-2 px-2 py-1 bg-purple-100 text-purple-700 rounded text-sm">Loop: ${data.active_loop.name}</span>` : ''}
        </div>
        <div class="space-y-2">
            ${slotEntries.map(([name, value]) => {
        const hasValue = value !== null && value !== undefined && value !== '';
        return `
                <div class="flex items-center justify-between p-2 rounded ${hasValue ? 'bg-green-50' : 'bg-gray-50'}">
                    <span class="font-mono text-sm ${hasValue ? 'text-green-700' : 'text-gray-500'}">${name}</span>
                    <span class="text-sm ${hasValue ? 'font-medium' : 'text-gray-400'}">
                        ${hasValue ? JSON.stringify(value) : 'null'}
                    </span>
                </div>`;
    }).join('')}
        </div>
    `;

    container.innerHTML = html;
}

// ============================================================================
// Domain Tab
// ============================================================================

async function loadDomainInfo() {
    try {
        const res = await fetch(`/inspector/domain/info`);
        const data = await res.json();

        if (data.success) {
            renderDomainInfo(data);
        } else {
            document.getElementById('domain-intents').innerHTML = `<div class="text-yellow-600 text-xs">${data.error}</div>`;
        }
    } catch (e) {
        console.error('Failed to load domain:', e);
    }
}

function renderDomainInfo(data) {
    // Intents
    document.getElementById('domain-intent-count').textContent = (data.intents || []).length;
    document.getElementById('domain-intents').innerHTML = (data.intents || []).map(i =>
        `<div class="px-2 py-1 bg-green-50 rounded text-green-700 font-mono">${i}</div>`
    ).join('');

    // Entities
    document.getElementById('domain-entity-count').textContent = (data.entities || []).length;
    document.getElementById('domain-entities').innerHTML = (data.entities || []).map(e =>
        `<div class="px-2 py-1 bg-blue-50 rounded text-blue-700 font-mono">${e}</div>`
    ).join('');

    // Slots
    document.getElementById('domain-slot-count').textContent = (data.slots || []).length;
    document.getElementById('domain-slots').innerHTML = (data.slots || []).map(s =>
        `<div class="px-2 py-1 bg-purple-50 rounded text-purple-700 font-mono">${s}</div>`
    ).join('');

    // Actions
    document.getElementById('domain-action-count').textContent = (data.actions || []).length;
    document.getElementById('domain-actions').innerHTML = (data.actions || []).map(a =>
        `<div class="px-2 py-1 bg-orange-50 rounded text-orange-700 font-mono text-xs">${a}</div>`
    ).join('');

    // Responses
    document.getElementById('domain-response-count').textContent = (data.responses || []).length;
    document.getElementById('domain-responses').innerHTML = (data.responses || []).map(r =>
        `<div class="px-2 py-1 bg-pink-50 rounded text-pink-700 font-mono text-xs">${r}</div>`
    ).join('');
}

// ============================================================================
// Tab Navigation
// ============================================================================

function showInspectorTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.inspector-tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.inspector-tab').forEach(el => {
        el.classList.remove('border-purple-600', 'text-purple-600');
        el.classList.add('border-transparent', 'text-gray-500');
    });

    // Show selected tab
    const tabContent = document.getElementById(`inspector-tab-${tabName}`);
    const tabButton = document.querySelector(`.inspector-tab[data-tab="${tabName}"]`);

    if (tabContent) tabContent.classList.remove('hidden');
    if (tabButton) {
        tabButton.classList.add('border-purple-600', 'text-purple-600');
        tabButton.classList.remove('border-transparent', 'text-gray-500');
    }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}
