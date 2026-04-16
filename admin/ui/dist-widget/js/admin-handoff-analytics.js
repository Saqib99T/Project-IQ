// ═══════════════════════════════════════════════════════════════════════════
// Admin Handoff Analytics — Phase 8
// Metrics: volume, avg wait/handle, resolution rate, operator perf, CSAT.
// Pure CSS charts — no external dependencies.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _rendered = false;
    let _data     = null;

    // ── Shell ─────────────────────────────────────────────────────────────────
    const SHELL = `
    <div class="p-6 space-y-6 max-w-6xl mx-auto">

      <!-- Header + filters -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-xl font-bold text-gray-800">Handoff Analytics</h2>
          <p class="text-sm text-gray-500 mt-0.5">Handoff volume, wait times, operator performance & CSAT</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <select id="ha-days" onchange="haLoad()"
            class="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-400">
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <select id="ha-app" onchange="haLoad()"
            class="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">All apps</option>
          </select>
          <button onclick="haLoad()"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- KPI cards -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" id="ha-kpis">
        ${kpiSkeleton(6)}
      </div>

      <!-- Daily volume chart + CSAT distribution -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">

        <!-- Daily volume bar chart -->
        <div class="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-5">
          <div class="flex items-center justify-between mb-4">
            <span class="font-semibold text-gray-700 text-sm">Daily Volume</span>
            <div class="flex items-center gap-3 text-xs text-gray-500">
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-blue-500"></span> Total</span>
              <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded-sm bg-green-400"></span> Resolved</span>
            </div>
          </div>
          <div id="ha-daily-chart" class="flex items-end gap-1 h-40 overflow-x-auto">
            <div class="text-xs text-gray-400 m-auto">Loading…</div>
          </div>
          <div id="ha-daily-labels" class="flex gap-1 mt-1 text-xs text-gray-400 overflow-x-auto"></div>
        </div>

        <!-- CSAT distribution -->
        <div class="bg-white border border-gray-200 rounded-xl p-5">
          <div class="font-semibold text-gray-700 text-sm mb-4">CSAT Distribution</div>
          <div id="ha-csat-chart" class="space-y-2">
            <div class="text-xs text-gray-400">Loading…</div>
          </div>
        </div>

      </div>

      <!-- Two column: trigger breakdown + top intents -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

        <div class="bg-white border border-gray-200 rounded-xl p-5">
          <div class="font-semibold text-gray-700 text-sm mb-4">Handoff Triggers</div>
          <div id="ha-triggers" class="space-y-2">
            <div class="text-xs text-gray-400">Loading…</div>
          </div>
        </div>

        <div class="bg-white border border-gray-200 rounded-xl p-5">
          <div class="font-semibold text-gray-700 text-sm mb-4">Top Intents at Handoff</div>
          <div id="ha-intents" class="space-y-2">
            <div class="text-xs text-gray-400">Loading…</div>
          </div>
        </div>

      </div>

      <!-- Operator performance table -->
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="px-5 py-3 border-b border-gray-100">
          <span class="font-semibold text-gray-700 text-sm">Operator Performance</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th class="px-4 py-3 text-left">Operator</th>
                <th class="px-4 py-3 text-left">Team</th>
                <th class="px-4 py-3 text-right">Handled</th>
                <th class="px-4 py-3 text-right">Resolved</th>
                <th class="px-4 py-3 text-right">Res. Rate</th>
                <th class="px-4 py-3 text-right">Avg Handle</th>
                <th class="px-4 py-3 text-right">Avg Wait</th>
                <th class="px-4 py-3 text-right">CSAT</th>
              </tr>
            </thead>
            <tbody id="ha-op-table" class="divide-y divide-gray-100 text-gray-700">
              <tr><td colspan="8" class="px-4 py-8 text-center text-gray-400 text-xs">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>`;

    function kpiSkeleton(n) {
        return Array(n).fill(0).map(() =>
            `<div class="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
               <div class="h-2 bg-gray-200 rounded w-2/3 mb-3"></div>
               <div class="h-7 bg-gray-100 rounded w-1/2"></div>
             </div>`
        ).join('');
    }

    // ── Init ──────────────────────────────────────────────────────────────────
    window.haInit = async function () {
        if (!_rendered) {
            document.getElementById('section-handoff-analytics').innerHTML = SHELL;
            _rendered = true;
            await populateAppFilter();
        }
        haLoad();
    };

    async function populateAppFilter() {
        try {
            const r = await fetch('/admin/analytics/apps');
            const d = await r.json();
            const sel = document.getElementById('ha-app');
            if (!sel) return;
            (d.apps || []).forEach(app => {
                const opt = document.createElement('option');
                opt.value       = app.app_id || app;
                opt.textContent = app.app_id || app;
                sel.appendChild(opt);
            });
        } catch (_) {}
    }

    // ── Load data ─────────────────────────────────────────────────────────────
    window.haLoad = async function () {
        const days  = document.getElementById('ha-days')?.value  || 7;
        const appId = document.getElementById('ha-app')?.value   || '';
        const url   = `/admin/handoff/analytics?days=${days}${appId ? '&app_id=' + encodeURIComponent(appId) : ''}`;
        try {
            const r = await fetch(url);
            _data = await r.json();
            if (!_data.success) return;
            renderKPIs(_data.kpis);
            renderDailyChart(_data.daily || []);
            renderCsat(_data.csat_dist || []);
            renderHorizontalBars('ha-triggers', _data.triggers || [], 'trigger_reason', 'count', 'bg-amber-400');
            renderHorizontalBars('ha-intents',  _data.top_intents || [], 'intent', 'count', 'bg-blue-400');
            renderOpTable(_data.operators || []);
        } catch (e) {
            console.warn('[HandoffAnalytics] load error', e);
        }
    };

    // ── KPIs ──────────────────────────────────────────────────────────────────
    function renderKPIs(k) {
        const cards = [
            { label: 'Total Handoffs',   value: k.total_handoffs ?? '—',                           color: 'text-gray-800' },
            { label: 'Resolved',         value: k.resolved ?? '—',                                 color: 'text-green-600' },
            { label: 'Resolution Rate',  value: k.resolution_rate != null ? k.resolution_rate + '%' : '—', color: 'text-blue-600' },
            { label: 'Avg Wait',         value: k.avg_wait_mins   != null ? k.avg_wait_mins + 'm'   : '—', color: 'text-amber-600' },
            { label: 'Avg Handle',       value: k.avg_handle_mins != null ? k.avg_handle_mins + 'm' : '—', color: 'text-purple-600' },
            { label: 'Avg CSAT',         value: k.avg_csat        != null ? '★ ' + k.avg_csat       : '—', color: 'text-yellow-500' },
        ];
        const el = document.getElementById('ha-kpis');
        if (!el) return;
        el.innerHTML = cards.map(c => `
          <div class="bg-white border border-gray-200 rounded-xl p-4">
            <div class="text-xs text-gray-400 mb-1">${c.label}</div>
            <div class="text-2xl font-bold ${c.color}">${c.value}</div>
          </div>`).join('');
    }

    // ── Daily volume bar chart (pure CSS) ─────────────────────────────────────
    function renderDailyChart(daily) {
        const chart  = document.getElementById('ha-daily-chart');
        const labels = document.getElementById('ha-daily-labels');
        if (!chart || !labels) return;

        if (!daily.length) {
            chart.innerHTML  = '<div class="text-xs text-gray-400 m-auto">No data for this period</div>';
            labels.innerHTML = '';
            return;
        }

        const maxTotal = Math.max(...daily.map(d => d.total || 0), 1);
        const barW = Math.max(20, Math.floor(560 / daily.length) - 2);

        chart.innerHTML = daily.map(d => {
            const totalPct    = Math.round(((d.total    || 0) / maxTotal) * 100);
            const resolvedPct = Math.round(((d.resolved || 0) / (d.total || 1)) * totalPct);
            const label       = d.day ? d.day.slice(5) : ''; // MM-DD
            return `
              <div class="flex flex-col items-center flex-shrink-0 group relative" style="width:${barW}px">
                <div class="absolute bottom-full mb-1 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10">
                  ${esc(d.day)}: ${d.total} total, ${d.resolved || 0} resolved, ${d.avg_wait_mins || 0}m avg wait
                </div>
                <div class="w-full flex flex-col justify-end" style="height:100%">
                  <div class="w-full rounded-t relative overflow-hidden bg-blue-100" style="height:${Math.max(totalPct, 2)}%">
                    <div class="absolute bottom-0 left-0 right-0 bg-green-400 rounded-t" style="height:${resolvedPct}%"></div>
                    <div class="absolute top-0 left-0 right-0 bg-blue-500" style="height:${100 - resolvedPct}%"></div>
                  </div>
                </div>
              </div>`;
        }).join('');

        // Show only a subset of labels to avoid crowding
        const step = daily.length > 14 ? Math.ceil(daily.length / 10) : 1;
        labels.innerHTML = daily.map((d, i) => {
            const show = i % step === 0 || i === daily.length - 1;
            return `<div class="flex-shrink-0 text-center" style="width:${barW}px">${show ? (d.day ? d.day.slice(5) : '') : ''}</div>`;
        }).join('');
    }

    // ── CSAT distribution ─────────────────────────────────────────────────────
    function renderCsat(dist) {
        const el = document.getElementById('ha-csat-chart');
        if (!el) return;
        if (!dist.length) {
            el.innerHTML = '<div class="text-xs text-gray-400">No ratings yet</div>';
            return;
        }
        const maxCount = Math.max(...dist.map(d => d.count || 0), 1);
        const stars    = ['★', '★★', '★★★', '★★★★', '★★★★★'];
        const colors   = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-lime-400', 'bg-green-500'];

        // Fill missing ratings
        const byRating = {};
        dist.forEach(d => { byRating[d.rating] = d.count; });

        el.innerHTML = [1, 2, 3, 4, 5].map(r => {
            const count = byRating[r] || 0;
            const pct   = Math.round((count / maxCount) * 100);
            return `
              <div class="flex items-center gap-2 text-xs">
                <span class="text-yellow-400 w-16 shrink-0">${stars[r - 1]}</span>
                <div class="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div class="h-full rounded-full ${colors[r - 1]}" style="width:${pct}%"></div>
                </div>
                <span class="text-gray-500 w-6 text-right">${count}</span>
              </div>`;
        }).join('');
    }

    // ── Horizontal bar for triggers / intents ─────────────────────────────────
    function renderHorizontalBars(elId, items, labelKey, countKey, barColor) {
        const el = document.getElementById(elId);
        if (!el) return;
        if (!items.length) {
            el.innerHTML = '<div class="text-xs text-gray-400">No data</div>';
            return;
        }
        const maxVal = Math.max(...items.map(i => i[countKey] || 0), 1);
        el.innerHTML = items.map(item => {
            const label = (item[labelKey] || '—').replace(/_/g, ' ');
            const count = item[countKey] || 0;
            const pct   = Math.round((count / maxVal) * 100);
            return `
              <div class="flex items-center gap-2 text-xs">
                <span class="text-gray-600 truncate w-36 shrink-0 capitalize" title="${esc(label)}">${esc(label)}</span>
                <div class="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div class="h-full rounded-full ${barColor}" style="width:${pct}%"></div>
                </div>
                <span class="text-gray-500 w-6 text-right">${count}</span>
              </div>`;
        }).join('');
    }

    // ── Operator table ────────────────────────────────────────────────────────
    function renderOpTable(ops) {
        const tbody = document.getElementById('ha-op-table');
        if (!tbody) return;
        if (!ops.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-gray-400 text-xs">No operator data for this period</td></tr>';
            return;
        }
        tbody.innerHTML = ops.map(op => {
            const handled  = op.handled  || 0;
            const resolved = op.resolved || 0;
            const resRate  = handled ? Math.round(resolved / handled * 100) : 0;
            const resColor = resRate >= 80 ? 'text-green-600' : resRate >= 50 ? 'text-amber-600' : 'text-red-500';
            const csat     = op.avg_csat != null ? '★ ' + op.avg_csat : '—';
            const csatColor = op.avg_csat >= 4 ? 'text-green-600' : op.avg_csat >= 3 ? 'text-amber-500' : 'text-red-400';
            return `<tr class="hover:bg-gray-50">
              <td class="px-4 py-3 font-medium text-gray-800">${esc(op.display_name)}</td>
              <td class="px-4 py-3 text-xs text-gray-500">${esc(op.team || '—')}</td>
              <td class="px-4 py-3 text-right font-mono">${handled}</td>
              <td class="px-4 py-3 text-right font-mono">${resolved}</td>
              <td class="px-4 py-3 text-right font-semibold ${resColor}">${resRate}%</td>
              <td class="px-4 py-3 text-right font-mono">${op.avg_handle_mins != null ? op.avg_handle_mins + 'm' : '—'}</td>
              <td class="px-4 py-3 text-right font-mono">${op.avg_wait_mins   != null ? op.avg_wait_mins   + 'm' : '—'}</td>
              <td class="px-4 py-3 text-right font-semibold ${csatColor}">${csat}</td>
            </tr>`;
        }).join('');
    }

    // ── Helper ────────────────────────────────────────────────────────────────
    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

})();
