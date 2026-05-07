// ═══════════════════════════════════════════════════════════════════════════
// Admin Routing Rules — Phase 7
// CRUD UI for handoff_routing_rules table.
// Match types: intent | keyword | app_id | entity
// ═══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    let _rules     = [];
    let _editingId = null;

    // ── Section shell ─────────────────────────────────────────────────────────
    const SHELL = `
    <div class="p-6 space-y-6 max-w-4xl mx-auto">

      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-gray-800">Routing Rules</h2>
          <p class="text-sm text-gray-500 mt-0.5">
            Control which team or skill handles a handoff based on intent, keyword, or app.
            Rules are evaluated top-to-bottom — first match wins.
          </p>
        </div>
        <button onclick="rrOpenNew()"
          class="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          New Rule
        </button>
      </div>

      <!-- How it works -->
      <div class="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800 leading-relaxed">
        <strong>How rules work:</strong>
        When a user is handed off, we check each active rule in <em>sort order</em>.
        If <strong>match_type = intent</strong> and the last user intent matches <strong>match_value</strong>, the conversation is routed to that team/skill.
        <strong>keyword</strong> checks the last user message text.
        <strong>app_id</strong> matches the chat app.
        <strong>priority_boost</strong> increases the queue priority (1–10).
      </div>

      <!-- Rules table -->
      <div class="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
              <tr>
                <th class="px-4 py-3 text-left w-8">#</th>
                <th class="px-4 py-3 text-left">Name</th>
                <th class="px-4 py-3 text-left">Match</th>
                <th class="px-4 py-3 text-left">Value</th>
                <th class="px-4 py-3 text-left">Team</th>
                <th class="px-4 py-3 text-left">Skill</th>
                <th class="px-4 py-3 text-left">Boost</th>
                <th class="px-4 py-3 text-left">Active</th>
                <th class="px-4 py-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody id="rr-table-body" class="divide-y divide-gray-100 text-gray-700">
              <tr><td colspan="9" class="px-4 py-8 text-center text-gray-400 text-xs">Loading…</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- Rule modal (create / edit) -->
    <div id="rr-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 id="rr-modal-title" class="font-bold text-gray-800 mb-4">New Routing Rule</h3>
        <div class="space-y-3">

          <div>
            <label class="block text-xs font-semibold text-gray-600 mb-1">Rule Name <span class="text-red-500">*</span></label>
            <input id="rr-f-name" type="text" placeholder="e.g. VPN issues → network team"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Match Type <span class="text-red-500">*</span></label>
              <select id="rr-f-match-type"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400 bg-white">
                <option value="intent">intent</option>
                <option value="keyword">keyword</option>
                <option value="app_id">app_id</option>
                <option value="entity">entity</option>
              </select>
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Match Value <span class="text-red-500">*</span></label>
              <input id="rr-f-match-value" type="text" placeholder="e.g. request_vpn_access"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Target Team</label>
              <input id="rr-f-team" type="text" placeholder="e.g. network_support"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Required Skill</label>
              <input id="rr-f-skill" type="text" placeholder="e.g. vpn_expert"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Priority Boost (0–10)</label>
              <input id="rr-f-boost" type="number" min="0" max="10" value="0"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-600 mb-1">Sort Order</label>
              <input id="rr-f-order" type="number" min="0" value="99"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-400">
            </div>
          </div>

          <div class="flex items-center gap-2 pt-1">
            <input type="checkbox" id="rr-f-active" checked class="rounded">
            <label for="rr-f-active" class="text-sm text-gray-700">Active</label>
          </div>

        </div>
        <div id="rr-modal-error" class="hidden mt-3 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2"></div>
        <div class="flex gap-2 mt-5">
          <button onclick="rrCloseModal()"
            class="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
          <button onclick="rrSave()"
            class="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-semibold hover:bg-blue-700">Save</button>
        </div>
      </div>
    </div>

    <!-- Delete confirm modal -->
    <div id="rr-delete-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
        <div class="text-4xl mb-3">🗑</div>
        <h3 class="font-bold text-gray-800 mb-1">Delete rule?</h3>
        <p class="text-sm text-gray-500 mb-5" id="rr-delete-name"></p>
        <div class="flex gap-2">
          <button onclick="rrCloseDeleteModal()"
            class="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
          <button onclick="rrExecuteDelete()"
            class="flex-1 bg-red-500 text-white rounded-lg py-2 text-sm font-semibold hover:bg-red-600">Delete</button>
        </div>
      </div>
    </div>`;

    let _deleteId = null;

    // ── Init ──────────────────────────────────────────────────────────────────
    window.rrInit = function () {
        const sec = document.getElementById('section-routing-rules');
        if (sec && !sec.innerHTML.trim()) sec.innerHTML = SHELL;
        rrLoad();
    };

    // ── Load rules ────────────────────────────────────────────────────────────
    window.rrLoad = async function () {
        try {
            const r = await fetch('/admin/handoff/routing');
            const d = await r.json();
            _rules = d.rules || [];
            renderTable();
        } catch (e) {
            console.warn('[RoutingRules] load error', e);
        }
    };

    function renderTable() {
        const tbody = document.getElementById('rr-table-body');
        if (!tbody) return;
        if (!_rules.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="px-4 py-8 text-center text-gray-400 text-xs">
              No rules yet. Click <strong>New Rule</strong> to add one.
            </td></tr>`;
            return;
        }
        tbody.innerHTML = _rules.map(r => {
            const mtBadge = matchTypeBadge(r.match_type);
            const activeCls = r.is_active ? 'text-green-600' : 'text-gray-300';
            const activeIcon = r.is_active ? '●' : '○';
            const boostBadge = r.priority_boost > 0
                ? `<span class="text-xs bg-red-100 text-red-600 rounded px-1.5 py-0.5 font-semibold">+${r.priority_boost}</span>`
                : '<span class="text-gray-300">—</span>';
            return `<tr class="hover:bg-gray-50">
              <td class="px-4 py-3 text-gray-400 font-mono text-xs">${r.sort_order}</td>
              <td class="px-4 py-3 font-medium text-gray-800">${esc(r.rule_name)}</td>
              <td class="px-4 py-3">${mtBadge}</td>
              <td class="px-4 py-3 font-mono text-xs text-gray-600">${esc(r.match_value)}</td>
              <td class="px-4 py-3 text-xs text-gray-600">${esc(r.target_team || '—')}</td>
              <td class="px-4 py-3 text-xs text-gray-600">${esc(r.required_skill || '—')}</td>
              <td class="px-4 py-3">${boostBadge}</td>
              <td class="px-4 py-3 text-sm font-bold ${activeCls}">${activeIcon}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-1">
                  <button onclick="rrToggleActive(${r.id}, ${!r.is_active})"
                    class="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2 py-1">
                    ${r.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onclick="rrOpenEdit(${r.id})"
                    class="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-1">
                    Edit
                  </button>
                  <button onclick="rrConfirmDelete(${r.id}, '${esc(r.rule_name)}')"
                    class="text-xs text-red-500 hover:text-red-700 border border-red-200 rounded px-2 py-1">
                    Delete
                  </button>
                </div>
              </td>
            </tr>`;
        }).join('');
    }

    function matchTypeBadge(t) {
        const map = {
            intent:  'bg-blue-100 text-blue-700',
            keyword: 'bg-purple-100 text-purple-700',
            app_id:  'bg-teal-100 text-teal-700',
            entity:  'bg-orange-100 text-orange-700',
        };
        const cls = map[t] || 'bg-gray-100 text-gray-600';
        return `<span class="text-xs font-semibold px-2 py-0.5 rounded ${cls}">${esc(t)}</span>`;
    }

    // ── Modal: New ────────────────────────────────────────────────────────────
    window.rrOpenNew = function () {
        _editingId = null;
        document.getElementById('rr-modal-title').textContent = 'New Routing Rule';
        setField('rr-f-name', '');
        setField('rr-f-match-type', 'intent');
        setField('rr-f-match-value', '');
        setField('rr-f-team', '');
        setField('rr-f-skill', '');
        setField('rr-f-boost', '0');
        setField('rr-f-order', '99');
        document.getElementById('rr-f-active').checked = true;
        document.getElementById('rr-modal-error').classList.add('hidden');
        document.getElementById('rr-modal').classList.remove('hidden');
    };

    // ── Modal: Edit ────────────────────────────────────────────────────────────
    window.rrOpenEdit = function (id) {
        const r = _rules.find(x => x.id === id);
        if (!r) return;
        _editingId = id;
        document.getElementById('rr-modal-title').textContent = 'Edit Routing Rule';
        setField('rr-f-name',        r.rule_name);
        setField('rr-f-match-type',  r.match_type);
        setField('rr-f-match-value', r.match_value);
        setField('rr-f-team',        r.target_team || '');
        setField('rr-f-skill',       r.required_skill || '');
        setField('rr-f-boost',       r.priority_boost ?? 0);
        setField('rr-f-order',       r.sort_order ?? 99);
        document.getElementById('rr-f-active').checked = !!r.is_active;
        document.getElementById('rr-modal-error').classList.add('hidden');
        document.getElementById('rr-modal').classList.remove('hidden');
    };

    window.rrCloseModal = function () {
        document.getElementById('rr-modal').classList.add('hidden');
    };

    // ── Save (create or update) ───────────────────────────────────────────────
    window.rrSave = async function () {
        const errEl = document.getElementById('rr-modal-error');
        errEl.classList.add('hidden');

        const payload = {
            rule_name:      document.getElementById('rr-f-name').value.trim(),
            match_type:     document.getElementById('rr-f-match-type').value,
            match_value:    document.getElementById('rr-f-match-value').value.trim(),
            target_team:    document.getElementById('rr-f-team').value.trim() || null,
            required_skill: document.getElementById('rr-f-skill').value.trim() || null,
            priority_boost: parseInt(document.getElementById('rr-f-boost').value) || 0,
            sort_order:     parseInt(document.getElementById('rr-f-order').value) || 99,
            is_active:      document.getElementById('rr-f-active').checked,
        };

        if (!payload.rule_name) { showErr('Rule name is required'); return; }
        if (!payload.match_value) { showErr('Match value is required'); return; }

        try {
            const isNew = _editingId === null;
            const url   = isNew ? '/admin/handoff/routing' : `/admin/handoff/routing/${_editingId}`;
            const r     = await fetch(url, {
                method:  isNew ? 'POST' : 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });
            const d = await r.json();
            if (!r.ok) { showErr(d.error || 'Save failed'); return; }
            rrCloseModal();
            await rrLoad();
            if (typeof showToast === 'function') showToast(isNew ? 'Rule created' : 'Rule updated');
        } catch (e) {
            showErr('Network error');
        }

        function showErr(msg) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    };

    // ── Toggle active ─────────────────────────────────────────────────────────
    window.rrToggleActive = async function (id, newState) {
        try {
            await fetch(`/admin/handoff/routing/${id}`, {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ is_active: newState }),
            });
            await rrLoad();
        } catch (e) { console.warn('[RoutingRules] toggle error', e); }
    };

    // ── Delete ────────────────────────────────────────────────────────────────
    window.rrConfirmDelete = function (id, name) {
        _deleteId = id;
        document.getElementById('rr-delete-name').textContent = name;
        document.getElementById('rr-delete-modal').classList.remove('hidden');
    };

    window.rrCloseDeleteModal = function () {
        document.getElementById('rr-delete-modal').classList.add('hidden');
        _deleteId = null;
    };

    window.rrExecuteDelete = async function () {
        if (!_deleteId) return;
        try {
            await fetch(`/admin/handoff/routing/${_deleteId}`, { method: 'DELETE' });
            rrCloseDeleteModal();
            await rrLoad();
            if (typeof showToast === 'function') showToast('Rule deleted');
        } catch (e) { console.warn('[RoutingRules] delete error', e); }
    };

    // ── Helpers ───────────────────────────────────────────────────────────────
    function setField(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

})();
