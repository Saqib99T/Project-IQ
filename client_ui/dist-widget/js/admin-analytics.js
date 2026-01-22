// Analytics Logic with Advanced Filters

// Uses /admin/analytics/* endpoints via the relative path defined in core
const ANALYTICS_API_BASE = `${ADMIN_API}/admin`;

let intentsChart = null;
let feedbackChart = null;
let currentAppFilter = 'all';
let convFilterTimeout = null;

async function loadAppList() {
    try {
        const res = await fetch(`${ANALYTICS_API_BASE}/analytics/apps`);
        const data = await res.json();

        // Populate both app dropdowns
        const selectors = [
            document.getElementById('analytics-app-filter'),
            document.getElementById('conv-filter-app')
        ];

        selectors.forEach(selector => {
            if (!selector) return;
            selector.innerHTML = '<option value="all">All Apps</option>';

            if (data.success && data.apps && data.apps.length > 0) {
                data.apps.forEach(app => {
                    const appId = app.app_id || app;
                    const appName = app.name || app;
                    selector.innerHTML += `<option value="${appId}">${appName}</option>`;
                });
            } else {
                // Fallback defaults
                selector.innerHTML += '<option value="IT">IT Support</option>';
                selector.innerHTML += '<option value="Accounting">Accounting Support</option>';
                selector.innerHTML += '<option value="HR">Human Resources</option>';
                selector.innerHTML += '<option value="General">General Support</option>';
            }
        });
    } catch (e) {
        console.error('Failed to load app list:', e);
    }
}

function filterAnalytics() {
    const selector = document.getElementById('analytics-app-filter');
    currentAppFilter = selector.value;
    loadAnalytics(currentAppFilter);
}

function refreshAnalytics() {
    loadAnalytics(currentAppFilter);
    applyConvFilters();
    showToast('Analytics refreshed!');
}

async function loadAnalytics(appId = 'all') {
    try {
        const appParam = appId && appId !== 'all' ? `?app_id=${appId}` : '';

        // Load summary
        const summaryRes = await fetch(`${ANALYTICS_API_BASE}/analytics/summary${appParam}`);
        const summaryJson = await summaryRes.json();
        const summary = summaryJson.data || summaryJson;

        document.getElementById('stat-conversations').textContent = summary.total_conversations || 0;
        document.getElementById('stat-messages').textContent = summary.total_messages || 0;
        document.getElementById('stat-positive').textContent = summary.feedback_positive || 0;
        document.getElementById('stat-resolution').textContent = (summary.resolution_rate || 0) + '%';

        // Intents Chart
        const intentsRes = await fetch(`${ANALYTICS_API_BASE}/analytics/intents${appParam}`);
        const intentsJson = await intentsRes.json();
        const intentsData = intentsJson.data || intentsJson;
        renderIntentsChart(intentsData.top_intents || []);

        // Feedback Chart
        const feedbackRes = await fetch(`${ANALYTICS_API_BASE}/analytics/feedback${appParam}`);
        const feedbackJson = await feedbackRes.json();
        const feedbackData = feedbackJson.data || feedbackJson;
        renderFeedbackChart(feedbackData.positive || 0, feedbackData.negative || 0);

        // Load conversations with filters
        await applyConvFilters();

    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

// ============================================================================
// Conversation Filters
// ============================================================================

function debounceConvFilter() {
    // Debounce user search input
    clearTimeout(convFilterTimeout);
    convFilterTimeout = setTimeout(() => {
        applyConvFilters();
    }, 400);
}

function clearConvFilters() {
    document.getElementById('conv-filter-user').value = '';
    document.getElementById('conv-filter-app').value = 'all';
    document.getElementById('conv-filter-ticket').value = 'all';
    document.getElementById('conv-filter-date').value = 'all';
    applyConvFilters();
}

async function applyConvFilters() {
    try {
        // Build query string from filters
        const params = new URLSearchParams();

        const userSearch = document.getElementById('conv-filter-user')?.value?.trim();
        const appFilter = document.getElementById('conv-filter-app')?.value;
        const ticketFilter = document.getElementById('conv-filter-ticket')?.value;
        const dateFilter = document.getElementById('conv-filter-date')?.value;

        if (userSearch) params.append('user', userSearch);
        if (appFilter && appFilter !== 'all') params.append('app_id', appFilter);
        if (ticketFilter && ticketFilter !== 'all') params.append('ticket_status', ticketFilter);
        if (dateFilter && dateFilter !== 'all') {
            params.append('date', dateFilter);

            if (dateFilter === 'custom') {
                const dateFrom = document.getElementById('conv-filter-date-from')?.value;
                const dateTo = document.getElementById('conv-filter-date-to')?.value;
                if (dateFrom) params.append('date_from', dateFrom);
                if (dateTo) params.append('date_to', dateTo);
            }
        }

        const queryString = params.toString() ? `?${params.toString()}` : '';
        const res = await fetch(`${ANALYTICS_API_BASE}/analytics/conversations${queryString}`);
        const json = await res.json();
        const conversations = json.data || [];

        // Update count
        const countEl = document.getElementById('conv-count');
        if (countEl) countEl.textContent = `${conversations.length} conversations`;

        // Show/hide no results message
        const noResults = document.getElementById('conv-no-results');
        const table = document.getElementById('conversations-table');

        if (conversations.length === 0) {
            if (noResults) noResults.classList.remove('hidden');
            if (table) table.innerHTML = '';
        } else {
            if (noResults) noResults.classList.add('hidden');
            renderConversationsTable(conversations);
        }

    } catch (e) {
        console.error('Failed to filter conversations:', e);
    }
}

// ============================================================================
// Chart Rendering
// ============================================================================

function renderIntentsChart(intents) {
    const ctx = document.getElementById('intentsChart');
    if (!ctx) return;

    if (intentsChart) intentsChart.destroy();

    const labels = intents.slice(0, 6).map(i => i[0]);
    const data = intents.slice(0, 6).map(i => i[1]);

    intentsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Count',
                data: data,
                backgroundColor: 'rgba(99, 102, 241, 0.8)',
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderFeedbackChart(positive, negative) {
    const ctx = document.getElementById('feedbackChart');
    if (!ctx) return;

    if (feedbackChart) feedbackChart.destroy();

    feedbackChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Positive', 'Negative'],
            datasets: [{
                data: [positive, negative],
                backgroundColor: ['#10b981', '#ef4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

// ============================================================================
// Conversations Table
// ============================================================================

function renderConversationsTable(conversations) {
    const tbody = document.getElementById('conversations-table');
    if (!tbody) return;

    tbody.innerHTML = conversations.map(conv => {
        // Ticket status badge
        let ticketBadge = '<span class="text-gray-400">—</span>';
        if (conv.ticket_activity === 'created') {
            ticketBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">🎫 Created</span>`;
        } else if (conv.ticket_activity === 'updated') {
            ticketBadge = `<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">✏️ Updated</span>`;
        }
        if (conv.resolved) {
            ticketBadge = `<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">✅ Resolved</span>`;
        }

        // Feedback badge
        let feedbackBadge = '—';
        if (conv.feedback === 'positive') feedbackBadge = '👍';
        else if (conv.feedback === 'negative') feedbackBadge = '👎';

        // Format date with full date+time
        const lastActivity = conv.last_activity ? formatDateTime(conv.last_activity) : '—';

        // Display name
        const displayName = conv.display_name || conv.sender_id || 'Unknown';

        return `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="py-3 pr-2">
                <div class="font-medium text-sm">${displayName}</div>
                ${conv.user_name && conv.user_name !== displayName ? `<div class="text-xs text-gray-400">${conv.sender_id}</div>` : ''}
            </td>
            <td class="py-3 pr-2">
                <span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">${conv.app_id || 'General'}</span>
            </td>
            <td class="py-3 pr-2 text-center">
                <span class="font-medium">${conv.message_count || 0}</span>
            </td>
            <td class="py-3 pr-2">
                ${ticketBadge}
                ${conv.ticket_id ? `<div class="text-xs text-gray-400 mt-1">#${conv.ticket_id}</div>` : ''}
            </td>
            <td class="py-3 pr-2">
                ${(conv.intents || []).slice(0, 2).map(i =>
            `<span class="px-2 py-0.5 bg-gray-100 rounded text-xs mr-1">${i}</span>`
        ).join('')}
            </td>
            <td class="py-3 pr-2 text-center text-lg">
                ${feedbackBadge}
            </td>
            <td class="py-3 pr-2 text-xs text-gray-500">
                ${lastActivity}
            </td>
            <td class="py-3">
                <button onclick="viewConversation('${conv.sender_id_full || conv.sender_id}')" 
                    class="text-purple-600 hover:text-purple-800 text-xs font-medium">
                    View →
                </button>
            </td>
        </tr>
    `}).join('');
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    // For very recent (< 1 hour), show relative
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 4) return `${diffHours} hours ago`;

    // For today, show "Today HH:MM"
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return `Today ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // For yesterday
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    // For older dates, show full date and time
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function viewConversation(senderId) {
    // Switch to Inspector and load this conversation
    if (window.showSection) {
        showSection('inspector');
        setTimeout(() => {
            if (window.loadConversationDetails) {
                loadConversationDetails(senderId);
            }
        }, 300);
    }
}
