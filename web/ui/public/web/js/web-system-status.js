// admin-system-status.js — System Status section

(function () {
    let _refreshTimer = null;
    let _cdTimer = null;
    let _cdSec = 30;

    // ── called by admin-core showSection ──────────────────────────────────
    window.initSystemStatus = function () {
        _render_shell();
        _load();
    };

    function _barClass(pct) {
        if (pct > 90) return 'bg-red-500';
        if (pct > 75) return 'bg-yellow-400';
        return 'bg-green-500';
    }

    function _dot(ok) {
        const cls = ok ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50';
        return `<span class="inline-block w-2 h-2 rounded-full ${cls} shadow-sm flex-shrink-0 mt-1"></span>`;
    }

    function _badge(ok, label) {
        const cls = ok
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700';
        return `<span class="text-xs font-semibold px-2 py-0.5 rounded-full ${cls} ml-auto">${label}</span>`;
    }

    function _card(title, icon, body, full = false) {
        return `
        <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ${full ? 'col-span-full' : ''}">
            <div class="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50">
                <span class="text-base">${icon}</span>
                <span class="text-sm font-semibold text-gray-700 uppercase tracking-wide">${title}</span>
            </div>
            <div class="p-4">${body}</div>
        </div>`;
    }

    function _row(ok, name, detail, badgeHtml = '') {
        return `
        <div class="flex items-start gap-3 py-2 border-b border-gray-50 last:border-0">
            ${_dot(ok)}
            <span class="text-sm font-medium text-gray-800 w-32 flex-shrink-0">${name}</span>
            <span class="text-sm text-gray-500 flex-1">${detail}</span>
            ${badgeHtml}
        </div>`;
    }

    function _render_shell() {
        const sec = document.getElementById('section-system-status');
        sec.innerHTML = `
        <div class="flex justify-between items-center mb-6">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">System Status</h1>
                <p class="text-gray-500 text-sm" id="ss-timestamp">Loading…</p>
            </div>
            <div class="flex items-center gap-3">
                <span class="text-xs text-gray-400" id="ss-countdown"></span>
                <button onclick="window._ssRefresh()"
                    class="flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-100 transition-colors text-sm font-medium">
                    <svg class="w-4 h-4" id="ss-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    Refresh
                </button>
            </div>
        </div>
        <div id="ss-grid" class="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div class="col-span-full text-center py-16 text-gray-400">
                <svg class="w-8 h-8 animate-spin mx-auto mb-3 text-blue-400" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Fetching status…
            </div>
        </div>`;
        window._ssRefresh = () => _load();
    }

    function _startCountdown() {
        clearInterval(_cdTimer);
        _cdSec = 30;
        _cdTimer = setInterval(() => {
            _cdSec--;
            const el = document.getElementById('ss-countdown');
            if (el) el.textContent = `Auto-refresh in ${_cdSec}s`;
            if (_cdSec <= 0) { clearInterval(_cdTimer); _load(); }
        }, 1000);
    }

    async function _load() {
        clearInterval(_cdTimer);
        const spin = document.getElementById('ss-spin');
        if (spin) spin.classList.add('animate-spin');
        try {
            const res = await fetch('/api/status');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();
            _renderData(d);
            _startCountdown();
        } catch (e) {
            const grid = document.getElementById('ss-grid');
            if (grid) grid.innerHTML = `
                <div class="col-span-full bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 text-sm">
                    ⚠ Could not fetch status data: ${e.message}
                </div>`;
        } finally {
            if (spin) spin.classList.remove('animate-spin');
        }
    }

    function _renderData(d) {
        const ts = document.getElementById('ss-timestamp');
        if (ts) ts.textContent = 'Last updated: ' + d.timestamp;

        const cards = [];

        // Services
        cards.push(_card('Systemd Services', '⚙️',
            d.services.map(s => _row(s.ok, s.name,
                s.ok ? `mem: ${s.mem} · up: ${s.uptime}` : s.state,
                _badge(s.ok, s.ok ? 'active' : s.state)
            )).join('')
        ));

        // Ports
        cards.push(_card('Open Ports', '🔌',
            d.ports.map(p => _row(p.ok, ':' + p.port, p.label,
                _badge(p.ok, p.ok ? 'listening' : 'closed')
            )).join('')
        ));

        // Docker
        function _containerRow(c) {
            // Strip common prefix to keep names short
            let display = c.name
                .replace(/^firecrawl-selfhost_/, '')
                .replace(/_1$/, '');
            // Map to friendly names
            const labels = { api: 'Firecrawl API', redis: 'Redis', rabbitmq: 'RabbitMQ',
                             'nuq-postgres': 'PostgreSQL (NUQ)', 'playwright-service': 'Playwright',
                             glpi: 'ITSM', 'glpi-db': 'ITSM DB' };
            const label = labels[display] || display;
            return `
            <div class="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                ${_dot(c.ok)}
                <span class="text-sm font-medium text-gray-800 flex-1">${label}</span>
                <span class="text-xs text-gray-400 whitespace-nowrap">${c.status}</span>
            </div>`;
        }
        cards.push(_card('Docker Containers', '🐳',
            d.containers.length
                ? d.containers.map(_containerRow).join('')
                : '<p class="text-sm text-gray-400 py-2">No matching containers found</p>'
        ));

        // Health
        cards.push(_card('App Health', '🩺',
            d.health.map(h => _row(h.ok, h.name, h.detail)).join('')
        ));

        // Resources (full width)
        const r = d.resources;
        const diskRows = r.disk.slice(1).map(dl => {
            const p = dl.raw.split(/\s+/);
            const pctCls = dl.pct > 90 ? 'text-red-600' : dl.pct > 75 ? 'text-yellow-600' : 'text-green-600';
            return `<tr class="border-t border-gray-50">
                <td class="py-1.5 pr-4 text-xs font-mono text-gray-600">${p[0] || ''}</td>
                <td class="py-1.5 pr-4 text-xs text-gray-500">${p[1] || ''}</td>
                <td class="py-1.5 pr-4 text-xs text-gray-500">${p[2] || ''}</td>
                <td class="py-1.5 pr-4 text-xs text-gray-500">${p[3] || ''}</td>
                <td class="py-1.5 pr-4 text-xs font-medium ${pctCls}">${p[4] || ''}</td>
                <td class="py-1.5 text-xs text-gray-500">${p[5] || ''}</td>
            </tr>`;
        }).join('');

        const resHtml = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
            <div>
                <p class="text-xs text-gray-500 mb-1">CPU Usage</p>
                <p class="text-2xl font-bold text-gray-800">${r.cpu_used != null ? r.cpu_used + '%' : 'n/a'}</p>
                <div class="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${_barClass(r.cpu_used || 0)}" style="width:${r.cpu_used || 0}%"></div>
                </div>
            </div>
            <div>
                <p class="text-xs text-gray-500 mb-1">Memory (${r.mem_used} / ${r.mem_total})</p>
                <p class="text-2xl font-bold text-gray-800">${r.mem_pct}%</p>
                <div class="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full rounded-full ${_barClass(r.mem_pct)}" style="width:${r.mem_pct}%"></div>
                </div>
            </div>
            <div>
                <p class="text-xs text-gray-500 mb-1">Swap</p>
                <p class="text-lg font-semibold text-gray-700">${r.swap_used} / ${r.swap_total}</p>
            </div>
            <div>
                <p class="text-xs text-gray-500 mb-1">Load Avg (${r.cpus} CPUs)</p>
                <p class="text-lg font-semibold text-gray-700">${r.load}</p>
            </div>
        </div>
        <table class="w-full text-left">
            <thead><tr class="text-xs text-gray-400 font-medium">
                <th class="pb-1 pr-4">Filesystem</th><th class="pb-1 pr-4">Size</th>
                <th class="pb-1 pr-4">Used</th><th class="pb-1 pr-4">Avail</th>
                <th class="pb-1 pr-4">Use%</th><th class="pb-1">Mount</th>
            </tr></thead>
            <tbody>${diskRows}</tbody>
        </table>`;
        cards.push(_card('System Resources', '📊', resHtml, true));

        // Recent Errors
        const errHtml = d.errors.map(e => e.errors.length
            ? `<div class="mb-3">
                <p class="text-xs font-semibold text-yellow-700 mb-1">${e.service}</p>
                ${e.errors.map(l => `<p class="text-xs font-mono text-gray-400 truncate py-0.5">${l}</p>`).join('')}
               </div>`
            : _row(true, e.service, 'no recent errors')
        ).join('');
        cards.push(_card('Recent Errors', '⚠️', errHtml));

        // Model
        const m = d.model;
        const modelHtml = m.found
            ? _row(true, 'Latest', '') +
              `<div class="ml-5 mt-1">
                <p class="text-xs font-mono text-blue-600">${m.name}</p>
                <p class="text-xs text-gray-400 mt-0.5">Size: ${m.size} · Trained: ${m.trained}</p>
                <p class="text-xs text-gray-400">Total on disk: ${m.count}</p>
               </div>`
            : _row(false, 'No model', 'Retrain needed');
        cards.push(_card('ML Platform Model', '🤖', modelHtml));

        const grid = document.getElementById('ss-grid');
        if (grid) grid.innerHTML = cards.join('');
    }

})();
