/**
 * System Users — admin panel section
 * CRUD for operator / admin accounts that access Project IQ.
 */

const SU = {
    operators: [],
    deleteTargetId: null,
    viewTargetId: null,
    KNOWN_APPS: ['IT', 'Accounting'],

    /* ── helpers ─────────────────────────────────────────────────────────── */
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

    /* ── load & render ───────────────────────────────────────────────────── */
    async load() {
        const showAll = document.getElementById('su-status-filter')?.value === 'all';
        try {
            const res = await fetch(`/admin/operators?include_inactive=${showAll}`, { headers: this.headers() });
            const data = await res.json();
            this.operators = data.operators || [];
            this.render();
        } catch (e) {
            document.getElementById('su-tbody').innerHTML =
                `<tr><td colspan="8" class="py-8 text-center text-red-400">Failed to load: ${e.message}</td></tr>`;
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
        document.getElementById('su-count').textContent = `${list.length} user${list.length !== 1 ? 's' : ''}`;
        const tbody = document.getElementById('su-tbody');
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

    /* ── create modal ────────────────────────────────────────────────────── */
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
            display_name:    name,
            email:           document.getElementById('su-f-email').value.trim() || null,
            is_admin:        document.getElementById('su-f-role').value === 'admin',
            team:            document.getElementById('su-f-team').value.trim() || null,
            app_ids:         this.getSelectedApps(),
            max_concurrent:  parseInt(document.getElementById('su-f-max').value) || 3,
        };
        if (pw) body.new_password = pw;

        const btn = document.getElementById('su-save-btn');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            let res;
            if (id) {
                if (document.getElementById('su-f-active-wrap').classList.contains('hidden') === false)
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

    /* ── view modal ──────────────────────────────────────────────────────── */
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

    editFromView() {
        this.closeView();
        if (this.viewTargetId) this.openEdit(this.viewTargetId);
    },

    /* ── delete / reactivate ─────────────────────────────────────────────── */
    openDelete(id) {
        const op = this.operators.find(o => o.id === id);
        if (!op) return;
        this.deleteTargetId = id;
        document.getElementById('su-del-name').textContent =
            `"${op.display_name}" will be deactivated and lose access.`;
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

/* ── global wrappers (called from HTML onclick) ───────────────────────────── */
function suLoad()        { SU.load(); }
function suFilter()      { SU.render(); }
function suOpenCreate()  { SU.openCreate(); }
function suCloseModal()  { SU.closeModal(); }
function suSave()        { SU.save(); }
function suCloseView()   { SU.closeView(); }
function suEditFromView(){ SU.editFromView(); }
function suCloseDelete() { SU.closeDelete(); }
function suConfirmDelete(){ SU.confirmDelete(); }

/* ── section lifecycle (called by web-core.js showSection) ───────────────── */
function initSystemUsers() { SU.load(); }
