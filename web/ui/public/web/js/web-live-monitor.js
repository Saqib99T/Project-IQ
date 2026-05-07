// ═══════════════════════════════════════════════════════════════════════════
// Admin Live Monitor — Phase 6/7
// Shows real-time queue state, operator load, and force-handoff capability.
// Auto-refreshes every 15s when section is visible.
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _refreshTimer   = null;
    let _rendered       = false;

    // ── Section shell HTML ───────────────────────────────────────────────────
    const SHELL = `
    <div class="p-6 space-y-6 max-w-6xl mx-auto">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-gray-800">Live Monitor</h2>
          <p class="text-sm text-gray-500 mt-0.5">Real-time handoff queue &amp; operator status</p>
        </div>
        <div class="flex items-center gap-3">
          <span id="lm-last-updated" class="text-xs text-gray-400"></span>
          <button onclick="lmRefresh()"
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- KPI row -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <div class="text-xs text-gray-400 mb-1">Waiting</div>
          <div id="lm-kpi-waiting" class="text-3xl font-bold text-amber-500">—</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <div class="text-xs text-gray-400 mb-1">Active</div>
          <div id="lm-kpi-active" class="text-3xl font-bold text-blue-500">—</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <div class="text-xs text-gray-400 mb-1">Avg Wait</div>
          <div id="lm-kpi-avgwait" class="text-3xl font-bold text-gray-700">—</div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl p-4">
          <div class="text-xs text-gray-400 mb-1">Operators Online</div>
          <div id="lm-kpi-online" class="text-3xl font-bold text-green-500">—</div>
        </div>
      </div>

      <!-- Waiting queue -->
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span class="font-semibold text-gray-700 text-sm">Waiting Queue</span>
          <button onclick="lmShowForceHandoff()"
            class="text-xs text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-3 py-1.5 font-semibold transition-colors">
            + Force Handoff
          </button>
        </div>
        <div id="lm-waiting-table" class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th class="px-4 py-2 text-left">User / App</th>
                <th class="px-4 py-2 text-left">Priority</th>
                <th class="px-4 py-2 text-left">Trigger</th>
                <th class="px-4 py-2 text-left">Wait</th>
                <th class="px-4 py-2 text-left">Team</th>
                <th class="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody id="lm-waiting-body" class="divide-y divide-gray-100 text-gray-700">
              <tr><td colspan="6" class="px-4 py-6 text-center text-gray-400 text-xs">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Active conversations -->
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <span class="font-semibold text-gray-700 text-sm">Active Conversations</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th class="px-4 py-2 text-left">User / App</th>
                <th class="px-4 py-2 text-left">Operator</th>
                <th class="px-4 py-2 text-left">Duration</th>
                <th class="px-4 py-2 text-left">Priority</th>
              </tr>
            </thead>
            <tbody id="lm-active-body" class="divide-y divide-gray-100 text-gray-700">
              <tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 text-xs">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Operators panel -->
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="px-4 py-3 border-b border-gray-100">
          <span class="font-semibold text-gray-700 text-sm">Operators</span>
        </div>
        <div id="lm-operators" class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div class="text-xs text-gray-400 text-center col-span-full py-4">Loading…</div>
        </div>
      </div>

    </div>

    <!-- Force Handoff modal -->
    <div id="lm-force-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 class="font-bold text-gray-800 mb-1">Force Handoff</h3>
        <p class="text-sm text-gray-500 mb-4">Immediately queue a conversation for a human operator.</p>
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-semibold text-gray-600 mb-1">Sender ID</label>
            <input id="lm-force-sender" type="text" placeholder="user_abc123"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
            <input id="lm-force-reason" type="text" placeholder="admin_override"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-600 mb-1">Target Team (optional)</label>
            <input id="lm-force-team" type="text" placeholder="it_support"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-amber-400">
          </div>
        </div>
        <div id="lm-force-error" class="hidden mt-3 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2"></div>
        <div class="flex gap-2 mt-4">
          <button onclick="lmCloseForceModal()"
            class="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
          <button onclick="lmExecuteForce()"
            class="flex-1 bg-amber-500 text-white rounded-lg py-2 text-sm font-semibold hover:bg-amber-600">Force Handoff</button>
        </div>
      </div>
    </div>`;

    // ── Init (called by showSection via window.lmInit) ────────────────────────
    window.lmInit = function () {
        if (!_rendered) {
            document.getElementById('section-live-monitor').innerHTML = SHELL;
            _rendered = true;
        }
        lmRefresh();
        clearInterval(_refreshTimer);
        _refreshTimer = setInterval(lmRefresh, 15000);
    };

    window.lmDestroy = function () {
        clearInterval(_refreshTimer);
        _refreshTimer = null;
    };

    // ── Data fetch ────────────────────────────────────────────────────────────
    window.lmRefresh = async function () {
        try {
            const r = await fetch('/admin/monitor/queue');
            const d = await r.json();
            if (!d.success) return;
            renderKPIs(d);
            renderWaiting(d.waiting || []);
            renderActive(d.assigned || []);
            renderOperators(d.operators || []);
            document.getElementById('lm-last-updated').textContent =
                'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            // Update sidebar badge
            const badge = document.getElementById('live-monitor-badge');
            if (badge) {
                const w = d.waiting_count || 0;
                if (w > 0) { badge.textContent = w; badge.classList.remove('hidden'); }
                else badge.classList.add('hidden');
            }
        } catch (e) {
            console.warn('[LiveMonitor] refresh error', e);
        }
    };

    function renderKPIs(d) {
        setText('lm-kpi-waiting', d.waiting_count ?? '—');
        setText('lm-kpi-active',  d.assigned_count ?? '—');
        setText('lm-kpi-avgwait', d.avg_wait_mins != null ? d.avg_wait_mins + 'm' : '—');
        const online = (d.operators || []).filter(o => o.status === 'available' || o.status === 'busy').length;
        setText('lm-kpi-online', online);
    }

    function renderWaiting(items) {
        const tbody = document.getElementById('lm-waiting-body');
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-gray-400 text-xs">No conversations waiting</td></tr>';
            return;
        }
        tbody.innerHTML = items.map(it => {
            const senderId  = esc(it.sender_id || '—');
            const appId     = esc(it.app_id || 'General');
            const prio      = parseInt(it.priority || 5);
            const prioCls   = prio >= 7 ? 'bg-red-100 text-red-700' : prio >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
            const trigger   = esc((it.trigger_reason || '').replace(/_/g, ' '));
            const wait      = it.queued_at ? waitLabel(it.queued_at) : '?';
            const team      = esc(it.target_team || '—');
            return `<tr class="hover:bg-gray-50">
              <td class="px-4 py-2.5">
                <div class="font-medium text-gray-800">${senderId}</div>
                <div class="text-xs text-gray-400">${appId}</div>
              </td>
              <td class="px-4 py-2.5"><span class="text-xs font-semibold px-2 py-0.5 rounded ${prioCls}">P${prio}</span></td>
              <td class="px-4 py-2.5 text-xs text-gray-600 capitalize">${trigger}</td>
              <td class="px-4 py-2.5 text-xs font-mono text-gray-600">${wait}</td>
              <td class="px-4 py-2.5 text-xs text-gray-600">${team}</td>
              <td class="px-4 py-2.5">
                <button onclick="lmPrefillForce('${esc(it.sender_id || '')}')"
                  class="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 rounded px-2 py-1">
                  Re-queue
                </button>
              </td>
            </tr>`;
        }).join('');
    }

    function renderActive(items) {
        const tbody = document.getElementById('lm-active-body');
        if (!tbody) return;
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400 text-xs">No active conversations</td></tr>';
            return;
        }
        tbody.innerHTML = items.map(it => {
            const senderId  = esc(it.sender_id || '—');
            const appId     = esc(it.app_id || 'General');
            const opName    = esc(it.operator_name || it.operator_id || '—');
            const duration  = it.assigned_at ? waitLabel(it.assigned_at) : '?';
            const prio      = parseInt(it.priority || 5);
            const prioCls   = prio >= 7 ? 'bg-red-100 text-red-700' : prio >= 4 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700';
            return `<tr class="hover:bg-gray-50">
              <td class="px-4 py-2.5">
                <div class="font-medium text-gray-800">${senderId}</div>
                <div class="text-xs text-gray-400">${appId}</div>
              </td>
              <td class="px-4 py-2.5 text-xs text-gray-700">${opName}</td>
              <td class="px-4 py-2.5 text-xs font-mono text-gray-600">${duration}</td>
              <td class="px-4 py-2.5"><span class="text-xs font-semibold px-2 py-0.5 rounded ${prioCls}">P${prio}</span></td>
            </tr>`;
        }).join('');
    }

    function renderOperators(ops) {
        const el = document.getElementById('lm-operators');
        if (!el) return;
        if (!ops.length) {
            el.innerHTML = '<div class="text-xs text-gray-400 text-center col-span-full py-4">No operators found</div>';
            return;
        }
        const statusColors = {
            available: 'bg-green-100 text-green-700',
            busy:      'bg-blue-100 text-blue-700',
            away:      'bg-amber-100 text-amber-700',
            offline:   'bg-gray-100 text-gray-400',
        };
        el.innerHTML = ops.map(op => {
            const cls    = statusColors[op.status] || statusColors.offline;
            const load   = op.current_load || 0;
            const max    = op.max_concurrent || 3;
            const pct    = Math.round((load / max) * 100);
            const barCls = pct >= 90 ? 'bg-red-400' : pct >= 60 ? 'bg-amber-400' : 'bg-green-400';
            const last   = op.last_seen ? new Date(op.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
            return `<div class="border border-gray-200 rounded-xl p-3">
              <div class="flex items-center justify-between mb-2">
                <span class="font-medium text-sm text-gray-800">${esc(op.display_name)}</span>
                <span class="text-xs px-2 py-0.5 rounded-full font-semibold ${cls}">${esc(op.status)}</span>
              </div>
              ${op.team ? `<div class="text-xs text-gray-400 mb-2">${esc(op.team)}</div>` : ''}
              <div class="flex items-center gap-2 mb-1">
                <div class="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div class="h-full rounded-full ${barCls}" style="width:${pct}%"></div>
                </div>
                <span class="text-xs text-gray-500 shrink-0">${load}/${max}</span>
              </div>
              <div class="text-xs text-gray-400">Last seen ${last}</div>
            </div>`;
        }).join('');
    }

    // ── Force Handoff modal ───────────────────────────────────────────────────
    window.lmShowForceHandoff = function () {
        document.getElementById('lm-force-sender').value = '';
        document.getElementById('lm-force-reason').value = 'admin_override';
        document.getElementById('lm-force-team').value   = '';
        document.getElementById('lm-force-error').classList.add('hidden');
        document.getElementById('lm-force-modal').classList.remove('hidden');
    };

    window.lmPrefillForce = function (senderId) {
        lmShowForceHandoff();
        document.getElementById('lm-force-sender').value = senderId;
    };

    window.lmCloseForceModal = function () {
        document.getElementById('lm-force-modal').classList.add('hidden');
    };

    window.lmExecuteForce = async function () {
        const sender = document.getElementById('lm-force-sender').value.trim();
        const reason = document.getElementById('lm-force-reason').value.trim() || 'admin_override';
        const team   = document.getElementById('lm-force-team').value.trim();
        const errEl  = document.getElementById('lm-force-error');

        if (!sender) { errEl.textContent = 'Sender ID is required'; errEl.classList.remove('hidden'); return; }
        errEl.classList.add('hidden');

        try {
            const r = await fetch('/admin/handoff/force', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ sender_id: sender, trigger_reason: reason, target_team: team || undefined }),
            });
            const d = await r.json();
            if (!r.ok) { errEl.textContent = d.error || 'Force failed'; errEl.classList.remove('hidden'); return; }
            lmCloseForceModal();
            lmRefresh();
            if (typeof showToast === 'function') showToast('Handoff queued successfully');
        } catch (e) {
            errEl.textContent = 'Network error';
            errEl.classList.remove('hidden');
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function waitLabel(ts) {
        if (!ts) return '?';
        const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        if (secs < 60)   return secs + 's';
        if (secs < 3600) return Math.floor(secs / 60) + 'm';
        return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
    }

})();
