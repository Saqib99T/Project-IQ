import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'
import { useIam } from '../../widget/hooks/useIam'
import { useAdminOrgScope } from '../AdminOrgScope'

const ALL_ROLES   = ['User', 'Bot', 'Operator', 'Admin']
const ROLE_STYLE  = {
    Admin:    'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    Operator: 'bg-blue-100 dark:bg-blue-500/10  text-blue-700 dark:text-blue-400',
    User:     'bg-gray-100 dark:bg-slate-800  text-gray-600 dark:text-slate-400',
    Bot:      'bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400',
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ onClose, onInvited, isAdmin }) {
    const { call }     = useApi()
    const [form, setForm] = useState({ email: '', first_name: '', last_name: '', roles: ['User'] })
    const [saving, setSaving] = useState(false)
    const [error, setError]   = useState(null)

    const toggle = (role) => setForm(f => {
        const has = f.roles.includes(role)
        const next = has ? f.roles.filter(r => r !== role) : [...f.roles, role]
        return { ...f, roles: next.length ? next : ['User'] }
    })

    const handleSubmit = async (e) => {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            await call('/portal/api/admin/users/invite', {
                method: 'POST',
                body:   JSON.stringify(form),
            })
            onInvited()
            onClose()
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Invite user</h3>
                    <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 hover:dark:text-slate-400 text-xl">×</button>
                </div>

                {error && (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Email *</label>
                        <input
                            type="email" required
                            value={form.email}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                            placeholder="user@example.com"
                            className="w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">First name</label>
                            <input
                                value={form.first_name}
                                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                                placeholder="Jane"
                                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">Last name</label>
                            <input
                                value={form.last_name}
                                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                                placeholder="Smith"
                                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-2">Roles</label>
                        <div className="flex gap-2 flex-wrap">
                            {ALL_ROLES.filter(r => r !== 'Admin' || isAdmin).map(role => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => toggle(role)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                        form.roles.includes(role)
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-400 border-gray-300 dark:border-slate-600 hover:border-blue-400'
                                    }`}
                                >
                                    {role}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} className="flex-1 btn-ghost">Cancel</button>
                        <button type="submit" disabled={saving} className="flex-1 btn-primary">
                            {saving ? 'Sending invite…' : 'Send invite'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}


// ── Role editor (inline) ──────────────────────────────────────────────────────

function RoleEditor({ user: u, onUpdated, isAdmin }) {
    const { call }     = useApi()
    const [roles, setRoles] = useState(u.client_roles)
    const [saving, setSaving] = useState(false)

    const toggle = (role) => {
        const has  = roles.includes(role)
        const next = has ? roles.filter(r => r !== role) : [...roles, role]
        if (!next.length) return
        setRoles(next)
    }

    const save = async () => {
        setSaving(true)
        try {
            await call(`/portal/api/admin/users/${u.sub}/roles`, {
                method: 'PATCH',
                body:   JSON.stringify({ roles }),
            })
            onUpdated()
        } catch (e) {
            alert(`Failed: ${e.message}`)
        } finally {
            setSaving(false)
        }
    }

    const changed = JSON.stringify([...roles].sort()) !== JSON.stringify([...u.client_roles].sort())

    return (
        <div className="flex items-center gap-1 flex-wrap">
            {ALL_ROLES.filter(r => r !== 'Admin' || isAdmin).map(role => (
                <button
                    key={role}
                    onClick={() => toggle(role)}
                    className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                        roles.includes(role)
                            ? (ROLE_STYLE[role] || 'bg-gray-100 dark:bg-slate-800') + ' border-transparent'
                            : 'bg-white dark:bg-slate-900 text-gray-400 dark:text-slate-500 border-gray-200 dark:border-slate-700 hover:border-gray-400 hover:dark:border-slate-500'
                    }`}
                >
                    {role}
                </button>
            ))}
            {changed && (
                <button onClick={save} disabled={saving}
                    className="ml-1 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50">
                    {saving ? '…' : 'Save'}
                </button>
            )}
        </div>
    )
}


// ── Main page ─────────────────────────────────────────────────────────────────

export default function UsersPage() {
    const { call }   = useApi()
    const { user: me } = useIam()
    const [users, setUsers]       = useState([])
    const [loading, setLoading]   = useState(true)
    const [error, setError]       = useState(null)
    const [showInvite, setShowInvite] = useState(false)
    const [deletingSub, setDeletingSub] = useState(null)

    // super_admin (platform) and org_admin (tenant admin) can see/assign the Admin role.
    const isPlatformAdmin = me?.realm_roles?.includes('super_admin')
        || me?.realm_roles?.includes('org_admin') || false
    // Super admin: show the tenant picked in the switcher; with none, fall back to
    // the logged-in org. (Backend ignores this for tenant admins — own org only.)
    const { orgId: selectedOrg } = useAdminOrgScope()
    const orgId = selectedOrg || me?.organization_id || ''

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        try {
            const data = await call(`/portal/api/admin/users${orgId ? `?org_id=${orgId}` : ''}`)
            setUsers(data.users || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, orgId])

    useEffect(() => { fetchUsers() }, [fetchUsers])

    const handleDelete = async (u) => {
        if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return
        setDeletingSub(u.sub)
        try {
            await call(`/portal/api/admin/users/${u.sub}`, { method: 'DELETE' })
            setUsers(prev => prev.filter(x => x.sub !== u.sub))
        } catch (e) {
            alert(`Delete failed: ${e.message}`)
        } finally {
            setDeletingSub(null)
        }
    }

    return (
        <div className="max-w-5xl space-y-5">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Users</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{users.length} members in org</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={fetchUsers} className="btn-ghost text-xs">↻ Refresh</button>
                    <button onClick={() => setShowInvite(true)} className="btn-primary text-xs">
                        + Invite user
                    </button>
                </div>
            </div>

            {error && (
                <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>
            )}

            <div className="card overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-5 py-3 text-left">User</th>
                            <th className="px-5 py-3 text-left">Roles</th>
                            <th className="px-5 py-3 text-left">Status</th>
                            <th className="px-5 py-3 text-right"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                        {loading && (
                            <tr>
                                <td colSpan={4} className="px-5 py-10 text-center">
                                    <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        )}
                        {!loading && users.map(u => (
                            <tr key={u.sub} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                <td className="px-5 py-3">
                                    <div className="font-medium text-gray-900 dark:text-slate-100">
                                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.username}
                                    </div>
                                    <div className="text-xs text-gray-400 dark:text-slate-500">{u.email}</div>
                                </td>
                                <td className="px-5 py-3">
                                    <RoleEditor
                                        user={u}
                                        onUpdated={fetchUsers}
                                        isAdmin={isPlatformAdmin}
                                    />
                                </td>
                                <td className="px-5 py-3">
                                    {u.email_verified
                                        ? <span className="badge bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400">Verified</span>
                                        : <span className="badge bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">Pending invite</span>}
                                    {!u.enabled && (
                                        <span className="ml-1 badge bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400">Disabled</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-right">
                                    {u.sub !== me?.sub && (
                                        <button
                                            onClick={() => handleDelete(u)}
                                            disabled={deletingSub === u.sub}
                                            className="text-xs text-red-500 hover:text-red-700 hover:dark:text-red-400 disabled:opacity-40"
                                        >
                                            {deletingSub === u.sub ? 'Deleting…' : 'Remove'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!loading && users.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-5 py-12 text-center text-gray-400 dark:text-slate-500">
                                    No users found — invite the first member
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {showInvite && (
                <InviteModal
                    onClose={() => setShowInvite(false)}
                    onInvited={fetchUsers}
                    isAdmin={isPlatformAdmin}
                />
            )}
        </div>
    )
}
