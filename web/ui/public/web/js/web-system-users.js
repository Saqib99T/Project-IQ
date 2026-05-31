/**
 * Manage Users — admin panel section
 * Tabs: System Users (operators/admins) | Client Users (end-users from conversations)
 */

/* ════════════════════════════════════════════════════════════════════════════
   SECTION SHELL — rendered once into #section-system-users
   ════════════════════════════════════════════════════════════════════════════ */
function initSystemUsers() {
    const section = document.getElementById('section-system-users');
    if (section.dataset.built) { SU.load(); CU.load(); return; }
    section.dataset.built = '1';
    section.innerHTML = `
<div class="p-6 max-w-7xl mx-auto">
  <!-- Page header -->
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Manage Users</h1>
      <p class="text-gray-500 text-sm mt-0.5">System accounts and client users</p>
    </div>
  </div>

  <!-- Tabs -->
  <div class="border-b border-gray-200 mb-6">
    <nav class="flex gap-6" id="mu-tabs">
      <button onclick="muTab('system')" id="mu-tab-system"
        class="mu-tab pb-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-600 transition-colors">
        System Users
      </button>
      <button onclick="muTab('client')" id="mu-tab-client"
        class="mu-tab pb-3 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 transition-colors">
        Client Users
      </button>
    </nav>
  </div>

  <!-- ── SYSTEM USERS PANEL ──────────────────────────────────────── -->
  <div id="mu-panel-system">
    <div class="flex flex-col sm:flex-row gap-3 mb-4">
      <input id="su-search" type="text" placeholder="Search by name, email, username…"
        oninput="suFilter()"
        class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      <select id="su-role-filter" onchange="suFilter()"
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        <option value="">All roles</option>
        <option value="admin">Admin</option>
        <option value="operator">Operator</option>
      </select>
      <select id="su-status-filter" onchange="suLoad()"
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        <option value="active">Active only</option>
        <option value="all">Include inactive</option>
      </select>
      <button onclick="suOpenCreate()"
        class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2 whitespace-nowrap">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Add User
      </button>
    </div>
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Users</span>
        <span id="su-count" class="text-xs text-gray-400">—</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 border-b border-gray-100">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Role</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Team</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Apps</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Auth</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Seen</th>
              <th class="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody id="su-tbody" class="divide-y divide-gray-50"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ── CLIENT USERS PANEL ──────────────────────────────────────── -->
  <div id="mu-panel-client" class="hidden">
    <div class="flex flex-col sm:flex-row gap-3 mb-4">
      <input id="cu-search" type="text" placeholder="Search by username…"
        oninput="CU.load()"
        class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      <select id="cu-app-filter" onchange="CU.load()"
        class="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        <option value="">All apps</option>
        <option value="IT">IT</option>
        <option value="Accounting">Accounting</option>
        <option value="General">General</option>
      </select>
    </div>
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-6 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Client Users</span>
        <div class="flex items-center gap-3">
          <span id="cu-count" class="text-xs text-gray-400">—</span>
          <button onclick="CU.openCreate()" class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add User
          </button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 border-b border-gray-100">
            <tr>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Username</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">App</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Conversations</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">First Seen</th>
              <th class="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Active</th>
              <th class="px-6 py-3"></th>
            </tr>
          </thead>
          <tbody id="cu-tbody" class="divide-y divide-gray-50"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- ── System Users: Create/Edit Modal ──────────────────────────────── -->
<div id="su-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 id="su-modal-title" class="text-base font-bold text-gray-800">Add System User</h2>
      <button onclick="suCloseModal()" class="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="p-6 space-y-4">
      <input type="hidden" id="su-edit-id">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Display Name *</label>
          <input id="su-f-name" type="text" placeholder="Jane Smith"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Username *</label>
          <input id="su-f-username" type="text" placeholder="jsmith"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Email</label>
        <input id="su-f-email" type="email" placeholder="jane@company.com"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select id="su-f-role"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">Team</label>
          <input id="su-f-team" type="text" placeholder="IT Support"
            class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Max Concurrent Sessions</label>
        <input id="su-f-max" type="number" min="1" max="20" value="3"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1.5">Assigned Apps</label>
        <div id="su-f-apps" class="flex flex-wrap gap-3"></div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-600 mb-1">Password <span id="su-pw-hint" class="text-gray-400">(min 8 chars)</span></label>
        <input id="su-f-password" type="password" placeholder="••••••••"
          class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div id="su-f-active-wrap" class="hidden flex items-center gap-2">
        <input id="su-f-active" type="checkbox" checked class="rounded text-indigo-600">
        <label for="su-f-active" class="text-sm text-gray-700">Active</label>
      </div>
      <div id="su-modal-error" class="hidden bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg"></div>
    </div>
    <div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
      <button onclick="suCloseModal()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
      <button id="su-save-btn" onclick="suSave()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Save</button>
    </div>
  </div>
</div>

<!-- ── System Users: View Modal ──────────────────────────────────────── -->
<div id="su-view-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 class="text-base font-bold text-gray-800">User Details</h2>
      <button onclick="suCloseView()" class="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="su-view-body" class="p-6"></div>
    <div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
      <button onclick="suCloseView()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Close</button>
      <button onclick="suEditFromView()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Edit</button>
    </div>
  </div>
</div>

<!-- ── System Users: Deactivate Confirm Modal ────────────────────────── -->
<div id="su-del-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div class="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
    <h3 class="text-base font-bold text-gray-800 mb-2">Deactivate User?</h3>
    <p id="su-del-name" class="text-sm text-gray-500 mb-6"></p>
    <div class="flex justify-end gap-3">
      <button onclick="suCloseDelete()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
      <button onclick="suConfirmDelete()" class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">Deactivate</button>
    </div>
  </div>
</div>

<!-- ── Client Users: Create/Edit Modal ──────────────────────────────── -->
<div id="cu-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 id="cu-modal-title" class="text-base font-bold text-gray-800">Add Client User</h2>
      <button onclick="CU.closeModal()" class="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="p-6 space-y-4">
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">First Name</label>
          <input id="cu-f-firstname" type="text" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Last Name</label>
          <input id="cu-f-lastname" type="text" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
        </div>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">Username <span class="text-red-400">*</span></label>
        <input id="cu-f-username" type="text" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-1">Email</label>
        <input id="cu-f-email" type="email" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-600 mb-2">App Access</label>
        <div class="flex flex-wrap gap-3">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" id="cu-f-app-IT"         value="IT"         class="w-4 h-4 rounded border-gray-300 text-indigo-600">
            <span class="text-sm text-gray-700">IT</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" id="cu-f-app-Accounting"  value="Accounting" class="w-4 h-4 rounded border-gray-300 text-indigo-600">
            <span class="text-sm text-gray-700">Accounting</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" id="cu-f-app-General"    value="General"    class="w-4 h-4 rounded border-gray-300 text-indigo-600">
            <span class="text-sm text-gray-700">General</span>
          </label>
        </div>
      </div>
      <div id="cu-f-pw-wrap">
        <label class="block text-xs font-semibold text-gray-600 mb-1">Password <span class="text-red-400">*</span></label>
        <input id="cu-f-password" type="password" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <div id="cu-f-pw-change-wrap" class="hidden">
        <label class="block text-xs font-semibold text-gray-600 mb-1">New Password <span class="text-gray-400">(leave blank to keep current)</span></label>
        <input id="cu-f-new-password" type="password" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
      </div>
      <p id="cu-modal-err" class="hidden text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2"></p>
    </div>
    <div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
      <button onclick="CU.closeModal()" class="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
      <button onclick="CU.save()" class="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Save</button>
    </div>
  </div>
</div>`;

    SU.load();
    CU.load();
}

/* ── Tab switcher ──────────────────────────────────────────────────────────── */
function muTab(tab) {
    document.getElementById('mu-panel-system').classList.toggle('hidden', tab !== 'system');
    document.getElementById('mu-panel-client').classList.toggle('hidden', tab !== 'client');
    document.querySelectorAll('.mu-tab').forEach(btn => {
        const active = btn.id === `mu-tab-${tab}`;
        btn.classList.toggle('border-indigo-600', active);
        btn.classList.toggle('text-indigo-600', active);
        btn.classList.toggle('border-transparent', !active);
        btn.classList.toggle('text-gray-500', !active);
    });
}


/* ════════════════════════════════════════════════════════════════════════════
   SU — System Users (operators / admins)
   ════════════════════════════════════════════════════════════════════════════ */
const SU = {
    operators: [],
    deleteTargetId: null,
    viewTargetId: null,
    KNOWN_APPS: ['IT', 'Accounting'],

    token() { return AdminAuth.getSessionToken(); },
    headers() { return { 'Content-Type': 'application/json', 'X-Session-Token': this.token() }; },

    relTime(iso) {
        if (!iso) return '—';
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    },

    roleBadge(op) {
        return op.is_admin
            ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">Admin</span>'
            : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Operator</span>';
    },

    statusDot(op) {
        if (!op.is_active) return '<span class="text-xs text-gray-400">Inactive</span>';
        const colors = { online: 'bg-green-500', available: 'bg-green-500', busy: 'bg-amber-500', away: 'bg-yellow-400', offline: 'bg-gray-300' };
        const c = colors[op.status] || 'bg-gray-300';
        return `<span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${c}"></span><span class="text-xs text-gray-600 capitalize">${op.status || 'offline'}</span></span>`;
    },

    authBadge(op) {
        return op.iam_sub
            ? '<span class="px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700">IAM</span>'
            : '<span class="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Local</span>';
    },

    async load() {
        const showAll = document.getElementById('su-status-filter')?.value === 'all';
        try {
            const res = await fetch(`/admin/operators?include_inactive=${showAll}`, { headers: this.headers() });
            const data = await res.json();
            this.operators = data.operators || [];
            this.render();
        } catch (e) {
            const tb = document.getElementById('su-tbody');
            if (tb) tb.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-red-400">Failed to load: ${e.message}</td></tr>`;
        }
    },

    filter() {
        const q    = (document.getElementById('su-search')?.value || '').toLowerCase();
        const role = document.getElementById('su-role-filter')?.value || '';
        return this.operators.filter(op => {
            const matchQ = !q || op.display_name?.toLowerCase().includes(q) || op.email?.toLowerCase().includes(q) || op.username?.toLowerCase().includes(q);
            const matchR = !role || (role === 'admin' ? op.is_admin : !op.is_admin);
            return matchQ && matchR;
        });
    },

    render() {
        const list = this.filter();
        const cnt = document.getElementById('su-count');
        if (cnt) cnt.textContent = `${list.length} user${list.length !== 1 ? 's' : ''}`;
        const tbody = document.getElementById('su-tbody');
        if (!tbody) return;
        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="py-12 text-center text-gray-400">No users found</td></tr>';
            return;
        }
        tbody.innerHTML = list.map(op => `
          <tr class="hover:bg-gray-50 transition-colors ${!op.is_active ? 'opacity-50' : ''}">
            <td class="px-6 py-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                     style="background:${this.avatarColor(op.display_name)}">
                  ${(op.display_name || op.username || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p class="font-medium text-gray-800 leading-tight">${op.display_name || op.username}</p>
                  <p class="text-xs text-gray-400">${op.email || op.username}</p>
                </div>
              </div>
            </td>
            <td class="px-6 py-3">${this.roleBadge(op)}</td>
            <td class="px-6 py-3 text-gray-500">${op.team || '—'}</td>
            <td class="px-6 py-3">
              <div class="flex flex-wrap gap-1">
                ${(op.app_ids || []).map(a => `<span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">${a}</span>`).join('') || '<span class="text-gray-400 text-xs">—</span>'}
              </div>
            </td>
            <td class="px-6 py-3">${this.authBadge(op)}</td>
            <td class="px-6 py-3">${this.statusDot(op)}</td>
            <td class="px-6 py-3 text-xs text-gray-400">${this.relTime(op.last_seen)}</td>
            <td class="px-6 py-3">
              <div class="flex items-center justify-end gap-1">
                <button onclick="SU.openView(${op.id})" title="View"
                  class="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
                <button onclick="SU.openEdit(${op.id})" title="Edit"
                  class="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                ${op.is_active ? `
                <button onclick="SU.openDelete(${op.id})" title="Deactivate"
                  class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                </button>` : `
                <button onclick="SU.reactivate(${op.id})" title="Reactivate"
                  class="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                </button>`}
              </div>
            </td>
          </tr>`).join('');
    },

    avatarColor(name) {
        const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];
        let h = 0;
        for (const c of (name || 'U')) h = (h << 5) - h + c.charCodeAt(0);
        return colors[Math.abs(h) % colors.length];
    },

    openCreate() {
        document.getElementById('su-modal-title').textContent = 'Add System User';
        document.getElementById('su-edit-id').value = '';
        document.getElementById('su-f-name').value = '';
        document.getElementById('su-f-username').value = '';
        document.getElementById('su-f-email').value = '';
        document.getElementById('su-f-role').value = 'operator';
        document.getElementById('su-f-team').value = '';
        document.getElementById('su-f-max').value = '3';
        document.getElementById('su-f-password').value = '';
        document.getElementById('su-pw-hint').textContent = '(min 8 chars)';
        document.getElementById('su-f-active-wrap').classList.add('hidden');
        document.getElementById('su-modal-error').classList.add('hidden');
        document.getElementById('su-f-username').disabled = false;
        this.renderAppCheckboxes([]);
        document.getElementById('su-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('su-f-name').focus(), 50);
    },

    openEdit(id) {
        const op = this.operators.find(o => o.id === id);
        if (!op) return;
        document.getElementById('su-modal-title').textContent = 'Edit System User';
        document.getElementById('su-edit-id').value = id;
        document.getElementById('su-f-name').value = op.display_name || '';
        document.getElementById('su-f-username').value = op.username || '';
        document.getElementById('su-f-username').disabled = true;
        document.getElementById('su-f-email').value = op.email || '';
        document.getElementById('su-f-role').value = op.is_admin ? 'admin' : 'operator';
        document.getElementById('su-f-team').value = op.team || '';
        document.getElementById('su-f-max').value = op.max_concurrent || 3;
        document.getElementById('su-f-password').value = '';
        document.getElementById('su-pw-hint').textContent = '(leave blank to keep current)';
        document.getElementById('su-f-active-wrap').classList.remove('hidden');
        document.getElementById('su-f-active').checked = op.is_active !== false;
        document.getElementById('su-modal-error').classList.add('hidden');
        this.renderAppCheckboxes(op.app_ids || []);
        document.getElementById('su-modal').classList.remove('hidden');
    },

    renderAppCheckboxes(selected) {
        document.getElementById('su-f-apps').innerHTML = this.KNOWN_APPS.map(app => `
          <label class="flex items-center gap-1.5 cursor-pointer text-sm">
            <input type="checkbox" value="${app}" class="su-app-cb rounded text-blue-600"
              ${selected.includes(app) ? 'checked' : ''}>
            ${app}
          </label>`).join('');
    },

    getSelectedApps() {
        return [...document.querySelectorAll('.su-app-cb:checked')].map(cb => cb.value);
    },

    async save() {
        const id   = document.getElementById('su-edit-id').value;
        const name = document.getElementById('su-f-name').value.trim();
        const user = document.getElementById('su-f-username').value.trim().toLowerCase();
        const err  = document.getElementById('su-modal-error');
        err.classList.add('hidden');

        if (!name) { err.textContent = 'Display name is required.'; err.classList.remove('hidden'); return; }
        if (!id && !user) { err.textContent = 'Username is required.'; err.classList.remove('hidden'); return; }

        const pw = document.getElementById('su-f-password').value;
        if (pw && pw.length < 8) { err.textContent = 'Password must be at least 8 characters.'; err.classList.remove('hidden'); return; }

        const body = {
            display_name:   name,
            email:          document.getElementById('su-f-email').value.trim() || null,
            is_admin:       document.getElementById('su-f-role').value === 'admin',
            team:           document.getElementById('su-f-team').value.trim() || null,
            app_ids:        this.getSelectedApps(),
            max_concurrent: parseInt(document.getElementById('su-f-max').value) || 3,
        };
        if (pw) body.new_password = pw;

        const btn = document.getElementById('su-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            let res;
            if (id) {
                if (!document.getElementById('su-f-active-wrap').classList.contains('hidden'))
                    body.is_active = document.getElementById('su-f-active').checked;
                res = await fetch(`/admin/operators/${id}`, {
                    method: 'PUT', headers: this.headers(), body: JSON.stringify(body)
                });
            } else {
                body.username = user;
                if (pw) body.password = pw;
                res = await fetch('/admin/operators', {
                    method: 'POST', headers: this.headers(), body: JSON.stringify(body)
                });
            }
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Save failed');
            this.closeModal();
            await this.load();
            showToast(id ? 'User updated.' : 'User created.');
        } catch (e) {
            err.textContent = e.message;
            err.classList.remove('hidden');
        } finally {
            btn.disabled = false; btn.textContent = 'Save';
        }
    },

    closeModal() { document.getElementById('su-modal').classList.add('hidden'); },

    async openView(id) {
        this.viewTargetId = id;
        try {
            const res  = await fetch(`/admin/operators/${id}`, { headers: this.headers() });
            const data = await res.json();
            const op   = data.operator;
            const stats = op.stats || {};
            document.getElementById('su-view-body').innerHTML = `
              <div class="flex items-center gap-4 pb-4 border-b border-gray-100 mb-2">
                <div class="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
                     style="background:${this.avatarColor(op.display_name)}">
                  ${(op.display_name || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p class="text-base font-bold text-gray-800">${op.display_name}</p>
                  <p class="text-sm text-gray-500">${op.email || op.username}</p>
                  <div class="flex gap-2 mt-1">${this.roleBadge(op)} ${this.authBadge(op)}</div>
                </div>
              </div>
              ${this.viewRow('Username', op.username)}
              ${this.viewRow('Team', op.team || '—')}
              ${this.viewRow('Apps', (op.app_ids || []).join(', ') || '—')}
              ${this.viewRow('Max Sessions', op.max_concurrent)}
              ${this.viewRow('Status', op.status || 'offline')}
              ${this.viewRow('Last Seen', this.relTime(op.last_seen))}
              ${this.viewRow('Active', op.is_active ? 'Yes' : 'No')}
              ${this.viewRow('IAM Linked', op.iam_sub ? 'Yes (' + op.iam_sub.substring(0,8) + '…)' : 'Not yet linked')}
              <div class="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3 text-center">
                <div class="bg-blue-50 rounded-xl p-3">
                  <p class="text-2xl font-bold text-blue-700">${stats.total_assigned || 0}</p>
                  <p class="text-xs text-blue-500 mt-0.5">Total Handled</p>
                </div>
                <div class="bg-green-50 rounded-xl p-3">
                  <p class="text-2xl font-bold text-green-700">${stats.resolved || 0}</p>
                  <p class="text-xs text-green-500 mt-0.5">Resolved</p>
                </div>
                <div class="bg-amber-50 rounded-xl p-3">
                  <p class="text-2xl font-bold text-amber-700">${op.current_load || 0}</p>
                  <p class="text-xs text-amber-500 mt-0.5">Active Now</p>
                </div>
              </div>`;
            document.getElementById('su-view-modal').classList.remove('hidden');
        } catch (e) { showToast('Failed to load user details.', true); }
    },

    viewRow(label, value) {
        return `<div class="flex justify-between py-1.5 border-b border-gray-50">
          <span class="text-gray-500 text-xs">${label}</span>
          <span class="font-medium text-gray-800 text-xs">${value}</span>
        </div>`;
    },

    closeView() { document.getElementById('su-view-modal').classList.add('hidden'); },
    editFromView() { this.closeView(); if (this.viewTargetId) this.openEdit(this.viewTargetId); },

    openDelete(id) {
        const op = this.operators.find(o => o.id === id);
        if (!op) return;
        this.deleteTargetId = id;
        document.getElementById('su-del-name').textContent = `"${op.display_name}" will be deactivated and lose access.`;
        document.getElementById('su-del-modal').classList.remove('hidden');
    },

    closeDelete() { document.getElementById('su-del-modal').classList.add('hidden'); this.deleteTargetId = null; },

    async confirmDelete() {
        if (!this.deleteTargetId) return;
        try {
            const res = await fetch(`/admin/operators/${this.deleteTargetId}`, { method: 'DELETE', headers: this.headers() });
            if (!res.ok) throw new Error((await res.json()).error);
            this.closeDelete();
            await this.load();
            showToast('User deactivated.');
        } catch (e) { showToast(e.message, true); }
    },

    async reactivate(id) {
        try {
            const res = await fetch(`/admin/operators/${id}`, {
                method: 'PUT', headers: this.headers(),
                body: JSON.stringify({ is_active: true })
            });
            if (!res.ok) throw new Error((await res.json()).error);
            await this.load();
            showToast('User reactivated.');
        } catch (e) { showToast(e.message, true); }
    },
};


/* ════════════════════════════════════════════════════════════════════════════
   CU — Client Users (end-users from conversations table)
   ════════════════════════════════════════════════════════════════════════════ */
const CU = {
    users: [],

    relTime(iso) {
        if (!iso) return '—';
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        const d = Math.floor(h / 24);
        if (d < 30) return `${d}d ago`;
        return new Date(iso).toLocaleDateString();
    },

    appBadge(apps) {
        const colors = { IT: 'bg-blue-100 text-blue-700', Accounting: 'bg-green-100 text-green-700', General: 'bg-gray-100 text-gray-600' };
        const list = Array.isArray(apps) ? apps : [apps || 'General'];
        return list.map(a => {
            const cls = colors[a] || 'bg-gray-100 text-gray-600';
            return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${a}</span>`;
        }).join(' ');
    },

    avatarColor(name) {
        const colors = ['#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444','#06b6d4','#ec4899'];
        let h = 0;
        for (const c of (name || 'U')) h = (h << 5) - h + c.charCodeAt(0);
        return colors[Math.abs(h) % colors.length];
    },

    async load() {
        const search = (document.getElementById('cu-search')?.value || '').trim();
        const appId  = document.getElementById('cu-app-filter')?.value || '';
        const tbody  = document.getElementById('cu-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-gray-400">Loading…</td></tr>';
        try {
            const params = new URLSearchParams();
            if (search) params.set('search', search);
            if (appId)  params.set('app_id', appId);
            const res  = await fetch(`/admin/client-users?${params}`, {
                headers: { 'X-Session-Token': AdminAuth.getSessionToken() }
            });
            const data = await res.json();
            this.users = data.users || [];
            this.render();
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load: ${e.message}</td></tr>`;
        }
    },

    render() {
        const cnt = document.getElementById('cu-count');
        if (cnt) cnt.textContent = `${this.users.length} user${this.users.length !== 1 ? 's' : ''}`;
        const tbody = document.getElementById('cu-tbody');
        if (!tbody) return;
        if (!this.users.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-12 text-center text-gray-400">No client users found</td></tr>';
            return;
        }
        tbody.innerHTML = this.users.map(u => {
            const displayName = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.user_name;
            const initials = displayName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase() || '?';
            return `
          <tr class="hover:bg-gray-50 transition-colors">
            <td class="px-6 py-3">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                     style="background:${this.avatarColor(u.user_name)}">
                  ${initials}
                </div>
                <div>
                  <p class="font-medium text-gray-800 leading-tight">${displayName}</p>
                  <p class="text-xs text-gray-400">${u.user_name}${u.email ? ' · ' + u.email : ''}</p>
                </div>
              </div>
            </td>
            <td class="px-6 py-3">${u.apps && u.apps.length ? this.appBadge(u.apps) : '<span class="text-xs text-gray-300">—</span>'}</td>
            <td class="px-6 py-3">
              ${u.conv_count ? `<span class="inline-flex items-center gap-1 text-sm font-semibold text-gray-700">
                <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                ${u.conv_count}
              </span>` : '<span class="text-xs text-gray-300">—</span>'}
            </td>
            <td class="px-6 py-3 text-xs text-gray-400">${u.first_seen ? new Date(u.first_seen).toLocaleDateString() : '—'}</td>
            <td class="px-6 py-3 text-xs text-gray-400">${u.last_active ? this.relTime(u.last_active) : '—'}</td>
            <td class="px-6 py-3">
              <div class="flex items-center gap-2">
                <button onclick="CU.openEdit(${JSON.stringify(u).replace(/"/g,'&quot;')})" title="Edit user"
                  class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  Edit
                </button>
                ${u.conv_count ? `<button onclick="CU.viewHistory('${u.user_name}')" title="View history"
                  class="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg border border-indigo-200 transition-colors">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  History
                </button>` : ''}
              </div>
            </td>
          </tr>`;
        }).join('');
    },

    _editTarget: null,

    _APPS: ['IT', 'Accounting', 'General'],

    _setAppChecks(apps) {
        this._APPS.forEach(a => {
            const el = document.getElementById(`cu-f-app-${a}`);
            if (el) el.checked = Array.isArray(apps) && apps.includes(a);
        });
    },

    _getAppChecks() {
        return this._APPS.filter(a => {
            const el = document.getElementById(`cu-f-app-${a}`);
            return el && el.checked;
        });
    },

    openCreate() {
        this._editTarget = null;
        document.getElementById('cu-modal-title').textContent = 'Add Client User';
        document.getElementById('cu-f-firstname').value  = '';
        document.getElementById('cu-f-lastname').value   = '';
        document.getElementById('cu-f-username').value   = '';
        document.getElementById('cu-f-email').value      = '';
        document.getElementById('cu-f-password').value   = '';
        document.getElementById('cu-f-username').disabled = false;
        document.getElementById('cu-f-pw-wrap').classList.remove('hidden');
        document.getElementById('cu-f-pw-change-wrap').classList.add('hidden');
        document.getElementById('cu-modal-err').classList.add('hidden');
        this._setAppChecks([]);
        document.getElementById('cu-modal').classList.remove('hidden');
    },

    openEdit(u) {
        this._editTarget = u;
        document.getElementById('cu-modal-title').textContent = 'Edit Client User';
        document.getElementById('cu-f-firstname').value  = u.firstname || '';
        document.getElementById('cu-f-lastname').value   = u.lastname  || '';
        document.getElementById('cu-f-username').value   = u.user_name || '';
        document.getElementById('cu-f-email').value      = u.email     || '';
        document.getElementById('cu-f-username').disabled = true;
        document.getElementById('cu-f-pw-wrap').classList.add('hidden');
        document.getElementById('cu-f-pw-change-wrap').classList.remove('hidden');
        document.getElementById('cu-f-new-password').value = '';
        document.getElementById('cu-modal-err').classList.add('hidden');
        this._setAppChecks(u.apps || []);
        document.getElementById('cu-modal').classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('cu-modal').classList.add('hidden');
    },

    async save() {
        const err = document.getElementById('cu-modal-err');
        err.classList.add('hidden');
        const body = {
            firstname: document.getElementById('cu-f-firstname').value.trim(),
            lastname:  document.getElementById('cu-f-lastname').value.trim(),
            username:  document.getElementById('cu-f-username').value.trim(),
            email:     document.getElementById('cu-f-email').value.trim(),
            apps:      this._getAppChecks(),
        };
        if (!this._editTarget) {
            body.password = document.getElementById('cu-f-password').value;
            if (!body.username) { this._showErr('Username is required'); return; }
            if (!body.password) { this._showErr('Password is required'); return; }
        } else {
            const pw = document.getElementById('cu-f-new-password').value;
            if (pw) body.password = pw;
        }
        try {
            const method = this._editTarget ? 'PUT' : 'POST';
            const url    = this._editTarget
                ? `/admin/client-users/${encodeURIComponent(this._editTarget.user_name)}`
                : '/admin/client-users';
            const res  = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json', 'X-Session-Token': AdminAuth.getSessionToken() },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!data.success) { this._showErr(data.error || 'Save failed'); return; }
            this.closeModal();
            showToast(this._editTarget ? 'User updated' : 'User created');
            this.load();
        } catch (e) { this._showErr(e.message); }
    },

    _showErr(msg) {
        const el = document.getElementById('cu-modal-err');
        el.textContent = msg;
        el.classList.remove('hidden');
    },

    viewHistory(userName) {
        showSection('chat-history');
        setTimeout(() => {
            const el = document.getElementById('ch-search');
            if (el) { el.value = userName; if (window.chLoad) chLoad(1); }
        }, 300);
    },
};


/* ── global wrappers ──────────────────────────────────────────────────────── */
function suLoad()         { SU.load(); }
function suFilter()       { SU.render(); }
function suOpenCreate()   { SU.openCreate(); }
function suCloseModal()   { SU.closeModal(); }
function suSave()         { SU.save(); }
function suCloseView()    { SU.closeView(); }
function suEditFromView() { SU.editFromView(); }
function suCloseDelete()  { SU.closeDelete(); }
function suConfirmDelete(){ SU.confirmDelete(); }
