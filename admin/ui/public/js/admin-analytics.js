// Analytics Logic

// Uses /admin/analytics/* endpoints via the relative path defined in core
const ANALYTICS_API_BASE = ADMIN_API;

let intentsChart = null;
let feedbackChart = null;
let currentAppFilter = 'all';

async function loadAppList() {
    try {
        const res = await fetch(`${ANALYTICS_API_BASE}/analytics/apps`);
        const data = await res.json();
        const selector = document.getElementById('analytics-app-filter');
        if (!selector) return;

        selector.innerHTML = '<option value="all">All Apps</option>';

        if (data.success && data.apps && data.apps.length > 0) {
            // Apps from chat_apps table have app_id and name
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
    } catch (e) {
        console.error('Failed to load app list:', e);
        const selector = document.getElementById('analytics-app-filter');
        if (selector) selector.innerHTML = '<option value="all">All Apps</option><option value="IT">IT Support</option><option value="Accounting">Accounting Support</option>';
    }
}

function filterAnalytics() {
    const selector = document.getElementById('analytics-app-filter');
    currentAppFilter = selector.value;
    loadAnalytics(currentAppFilter);
}

function refreshAnalytics() {
    loadAnalytics(currentAppFilter);
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

        // Conversations Table
        const convsRes = await fetch(`${ANALYTICS_API_BASE}/analytics/conversations${appParam}`);
        const convsJson = await convsRes.json();
        const convsData = convsJson.data || convsJson;
        renderConversationsTable(convsData || []);

    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

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

function renderConversationsTable(conversations) {
    const tbody = document.getElementById('conversations-table');
    if (!tbody) return;

    tbody.innerHTML = conversations.slice(0, 10).map(conv => `
        <tr class="border-b border-gray-100">
            <td class="py-3 font-mono text-xs">${conv.sender_id || 'Unknown'}</td>
            <td class="py-3">
                <span class="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">${conv.app_id || 'General'}</span>
            </td>
            <td class="py-3">${conv.message_count || 0}</td>
            <td class="py-3">
                ${(conv.intents || []).slice(0, 2).map(i =>
        `<span class="px-2 py-1 bg-gray-100 rounded text-xs mr-1">${i}</span>`
    ).join('')}
            </td>
            <td class="py-3">
                ${conv.feedback === 'positive' ? '👍' : conv.feedback === 'negative' ? '👎' : '—'}
            </td>
        </tr>
    `).join('');
}
