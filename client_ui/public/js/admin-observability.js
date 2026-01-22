// Observability Dashboard Logic

let observabilityInterval = null;

async function loadObservability() {
    const t = Date.now();
    await Promise.all([
        checkServiceHealth(t),
        loadMetrics(t),
        loadDatabaseStats(t),
        loadLogs(t)
    ]);
    updateLastUpdated();

    // Auto-refresh every 10 seconds for real-time feel
    if (!observabilityInterval) {
        observabilityInterval = setInterval(refreshObservability, 10000);
    }
}

async function refreshObservability() {
    await loadObservability();
}

function updateLastUpdated() {
    const el = document.getElementById('obs-last-updated');
    if (el) {
        el.textContent = 'Last updated: ' + new Date().toLocaleTimeString();
    }
}

// Service Health Checks
async function checkServiceHealth() {
    const services = ['rasa', 'actions', 'database'];

    for (const service of services) {
        const statusEl = document.getElementById(`health-${service}`);
        const iconEl = document.getElementById(`health-${service}-icon`);

        try {
            const res = await fetch(`${ADMIN_API}/health/${service}?t=${t || Date.now()}`);
            const data = await res.json();

            if (data.healthy) {
                statusEl.textContent = 'Online';
                statusEl.className = 'text-xl font-semibold text-green-600';
                iconEl.className = 'w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-2xl';
            } else {
                statusEl.textContent = 'Offline';
                statusEl.className = 'text-xl font-semibold text-red-600';
                iconEl.className = 'w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-2xl';
            }
        } catch (e) {
            statusEl.textContent = 'Error';
            statusEl.className = 'text-xl font-semibold text-yellow-600';
            iconEl.className = 'w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center text-2xl';
        }
    }
}

// Load Metrics including System Metrics
async function loadMetrics(t) {
    try {
        const res = await fetch(`${ADMIN_API}/observability/metrics?t=${t || Date.now()}`);
        const data = await res.json();

        if (data.success) {
            const metrics = data.data;

            // CPU
            const cpu = metrics.cpu_percent || 0;
            const cpuEl = document.getElementById('metric-cpu');
            const cpuBar = document.getElementById('metric-cpu-bar');
            if (cpuEl) cpuEl.textContent = cpu.toFixed(1);
            if (cpuBar) cpuBar.style.width = cpu + '%';
            const cpuCores = document.getElementById('cpu-cores');
            if (cpuCores) cpuCores.textContent = (metrics.cpu_count || '--') + ' cores';

            // Memory
            const memPercent = metrics.memory_percent || 0;
            const memEl = document.getElementById('metric-memory');
            const memBar = document.getElementById('metric-memory-bar');
            if (memEl) memEl.textContent = memPercent.toFixed(1);
            if (memBar) memBar.style.width = memPercent + '%';
            const memUsed = ((metrics.memory_used || 0) / (1024 * 1024 * 1024)).toFixed(1);
            const memTotal = ((metrics.memory_total || 0) / (1024 * 1024 * 1024)).toFixed(1);
            const memUsedEl = document.getElementById('memory-used');
            const memTotalEl = document.getElementById('memory-total');
            if (memUsedEl) memUsedEl.textContent = memUsed;
            if (memTotalEl) memTotalEl.textContent = memTotal;

            // Disk
            const diskPercent = metrics.disk_percent || 0;
            const diskEl = document.getElementById('metric-disk');
            const diskBar = document.getElementById('metric-disk-bar');
            if (diskEl) diskEl.textContent = diskPercent.toFixed(1);
            if (diskBar) diskBar.style.width = diskPercent + '%';
            const diskUsed = ((metrics.disk_used || 0) / (1024 * 1024 * 1024)).toFixed(1);
            const diskTotal = ((metrics.disk_total || 0) / (1024 * 1024 * 1024)).toFixed(1);
            const diskUsedEl = document.getElementById('disk-used');
            const diskTotalEl = document.getElementById('disk-total');
            if (diskUsedEl) diskUsedEl.textContent = diskUsed;
            if (diskTotalEl) diskTotalEl.textContent = diskTotal;

            // Update service cards with per-service metrics
            const services = metrics.services || {};

            // Service 1: Rasa Core
            const rasaMetrics = services.rasa || {cpu: 0, memory: 0};
            const cpuEl1 = document.getElementById('service-cpu');
            const memEl1 = document.getElementById('service-memory');
            const diskEl1 = document.getElementById('service-disk');
            if (cpuEl1) cpuEl1.textContent = rasaMetrics.cpu.toFixed(1) + '%';
            if (memEl1) memEl1.textContent = rasaMetrics.memory.toFixed(1) + '%';
            if (diskEl1) diskEl1.textContent = diskPercent.toFixed(1) + '%';

            // Service 2: Action Server
            const actionsMetrics = services.actions || {cpu: 0, memory: 0};
            const cpuEl2 = document.getElementById('service-cpu-2');
            const memEl2 = document.getElementById('service-memory-2');
            const diskEl2 = document.getElementById('service-disk-2');
            if (cpuEl2) cpuEl2.textContent = actionsMetrics.cpu.toFixed(1) + '%';
            if (memEl2) memEl2.textContent = actionsMetrics.memory.toFixed(1) + '%';
            if (diskEl2) diskEl2.textContent = diskPercent.toFixed(1) + '%';

            // Service 3: Database
            const dbMetrics = services.database || {cpu: 0, memory: 0};
            const cpuEl3 = document.getElementById('service-cpu-3');
            const memEl3 = document.getElementById('service-memory-3');
            const diskEl3 = document.getElementById('service-disk-3');
            if (cpuEl3) cpuEl3.textContent = dbMetrics.cpu.toFixed(1) + '%';
            if (memEl3) memEl3.textContent = dbMetrics.memory.toFixed(1) + '%';
            if (diskEl3) diskEl3.textContent = diskPercent.toFixed(1) + '%';

            // Service 4: Admin API
            const adminMetrics = services.admin || {cpu: 0, memory: 0};
            const cpuEl4 = document.getElementById('service-cpu-4');
            const memEl4 = document.getElementById('service-memory-4');
            const diskEl4 = document.getElementById('service-disk-4');
            if (cpuEl4) cpuEl4.textContent = adminMetrics.cpu.toFixed(1) + '%';
            if (memEl4) memEl4.textContent = adminMetrics.memory.toFixed(1) + '%';
            if (diskEl4) diskEl4.textContent = diskPercent.toFixed(1) + '%';

            // Response Time
            const responseTime = metrics.avg_response_time || 0;
            document.getElementById('metric-response-time').textContent = responseTime;
            document.getElementById('metric-response-bar').style.width = Math.min(100, responseTime / 10) + '%';

            // Throughput
            const throughput = metrics.throughput || 0;
            document.getElementById('metric-throughput').textContent = throughput.toFixed(1);
            document.getElementById('metric-throughput-bar').style.width = Math.min(100, throughput * 10) + '%';

            // Error Rate
            const errorRate = metrics.error_rate || 0;
            document.getElementById('metric-error-rate').textContent = errorRate.toFixed(1);
            document.getElementById('metric-error-bar').style.width = Math.min(100, errorRate * 10) + '%';
        }
    } catch (e) {
        console.error('Failed to load metrics:', e);
    }
}

// Load Database Stats
async function loadDatabaseStats(t) {
    try {
        const res = await fetch(`${ADMIN_API}/observability/database/stats?t=${t || Date.now()}`);
        const data = await res.json();

        if (data.success) {
            const stats = data.data;
            const container = document.getElementById('db-stats');

            let html = '';
            if (stats.tables) {
                for (const [table, count] of Object.entries(stats.tables)) {
                    html += `
                        <div class="flex justify-between items-center py-2 border-b border-gray-100">
                            <span class="text-gray-600">${table}</span>
                            <span class="font-semibold text-gray-800">${count.toLocaleString()} rows</span>
                        </div>
                    `;
                }
            }

            if (stats.activity) {
                html += `
                    <div class="flex justify-between items-center py-2 border-b border-gray-100 mt-4">
                        <span class="text-gray-600">Messages (last hour)</span>
                        <span class="font-semibold text-blue-600">${stats.activity.messages_last_hour || 0}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-gray-600">Conversations (today)</span>
                        <span class="font-semibold text-purple-600">${stats.activity.conversations_today || 0}</span>
                    </div>
                `;
            }

            container.innerHTML = html || '<div class="text-gray-400">No data available</div>';

            // Update recent activity panel
            const activityContainer = document.getElementById('recent-activity');
            if (stats.activity) {
                activityContainer.innerHTML = `
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-gray-600">📨 Messages (last hour)</span>
                        <span class="font-semibold">${stats.activity.messages_last_hour || 0}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-gray-600">💬 Conversations (today)</span>
                        <span class="font-semibold">${stats.activity.conversations_today || 0}</span>
                    </div>
                    <div class="flex justify-between items-center py-2 border-b border-gray-100">
                        <span class="text-gray-600">⏱️ Avg Response Time</span>
                        <span class="font-semibold">${stats.performance?.avg_response_ms || 0} ms</span>
                    </div>
                `;
            }
        }
    } catch (e) {
        console.error('Failed to load database stats:', e);
    }
}

// Load Logs
let allLogs = [];

async function loadLogs(t) {
    try {
        const res = await fetch(`${ADMIN_API}/observability/logs?t=${t || Date.now()}`);
        const data = await res.json();

        if (data.success) {
            allLogs = data.data || [];
            renderLogs(allLogs);
        }
    } catch (e) {
        console.error('Failed to load logs:', e);
        document.getElementById('log-viewer').innerHTML = '<div class="text-red-400">Failed to load logs</div>';
    }
}

function filterLogs() {
    const levelFilter = document.getElementById('log-level-filter').value;
    const sourceFilter = document.getElementById('log-source-filter').value;

    let filtered = allLogs;

    if (levelFilter !== 'all') {
        filtered = filtered.filter(log => log.level?.toLowerCase() === levelFilter);
    }

    if (sourceFilter !== 'all') {
        filtered = filtered.filter(log => log.source?.toLowerCase() === sourceFilter);
    }

    renderLogs(filtered);
}

function renderLogs(logs) {
    const viewer = document.getElementById('log-viewer');

    if (!logs || logs.length === 0) {
        viewer.innerHTML = '<div class="text-gray-500">No logs available</div>';
        return;
    }

    const levelColors = {
        error: 'text-red-400',
        warning: 'text-yellow-400',
        info: 'text-blue-400',
        debug: 'text-gray-500'
    };

    let html = '';
    for (const log of logs.slice(-50)) { // Last 50 logs
        const levelClass = levelColors[log.level?.toLowerCase()] || 'text-gray-300';
        const time = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '';
        html += `<div class="py-1 border-b border-gray-800">
            <span class="text-gray-500">${time}</span>
            <span class="${levelClass} font-semibold ml-2">[${log.level || 'INFO'}]</span>
            <span class="text-purple-400 ml-1">${log.source || 'system'}</span>
            <span class="ml-2">${log.message || ''}</span>
        </div>`;
    }

    viewer.innerHTML = html;
    viewer.scrollTop = viewer.scrollHeight;
}

// Cleanup on section change
function cleanupObservability() {
    if (observabilityInterval) {
        clearInterval(observabilityInterval);
        observabilityInterval = null;
    }
}
