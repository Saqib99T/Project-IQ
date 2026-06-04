import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'
import { useIam } from '../../widget/hooks/useIam'

const ALL_ROLES   = ['Member', 'Operator', 'Admin']
const ROLE_STYLE  = {
    Admin:    'bg-amber-100 text-amber-700',
    Operator: 'bg-blue-100  text-blue-700',
    Member:   'bg-gray-100  text-gray-600',
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ onClose, onInvited, isAdmin }) {
    const { call }     = useApi()
    const [form, setForm] = useState({ email: '', first_name: '', last_name: '', roles: ['Member'] })
    const [saving, setSaving] = useState(false)
    const [error, setError]   = useState(null)

    const toggle = (role) => setForm(f => {
        const has = f.roles.includes(role)
        const next = has ? f.roles.filter(r => r !== role) : [...f.roles, role]
        return { ...f, roles: next.length ? next : ['Member'] }
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
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Invite user</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                </div>

                {error && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
                        <input
                            type="email" required
                            value={form.email}
                            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                            placeholder="user@example.com"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">First name</label>
                            <input
                                value={form.first_name}
                                onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                                placeholder="Jane"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Last name</label>
                            <input
                                value={form.last_name}
                                onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                                placeholder="Smith"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-2">Roles</label>
                        <div className="flex gap-2 flex-wrap">
                            {ALL_ROLES.filter(r => r !== 'Admin' || isAdmin).map(role => (
                                <button
                                    key={role}
                                    type="button"
                                    onClick={() => toggle(role)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                        form.roles.includes(role)
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
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
                            ? (ROLE_STYLE[role] || 'bg-gray-100') + ' border-transparent'
                            : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
                    }`}
                >
                    {role}
                </button>
            ))}
            {changed && (
                <button onClick={save} disabled={saving}
                    className="ml-1 text-xs text-blue-600 hover:underline disabled:opacity-50">
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

    const isPlatformAdmin = me?.realm_roles?.includes('super_admin') || false
    const orgId = me?.organization_id || ''

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
                    <h2 className="text-xl font-semibold text-gray-900">Users</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{users.length} members in org</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={fetchUsers} className="btn-ghost text-xs">↻ Refresh</button>
                    <button onClick={() => setShowInvite(true)} className="btn-primary text-xs">
                        + Invite user
                    </button>
                </div>
            </div>

            {error && (
                <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
            )}

            <div className="card overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-5 py-3 text-left">User</th>
                            <th className="px-5 py-3 text-left">Roles</th>
                            <th className="px-5 py-3 text-left">Status</th>
                            <th className="px-5 py-3 text-right"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading && (
                            <tr>
                                <td colSpan={4} className="px-5 py-10 text-center">
                                    <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        )}
                        {!loading && users.map(u => (
                            <tr key={u.sub} className="hover:bg-gray-50">
                                <td className="px-5 py-3">
                                    <div className="font-medium text-gray-900">
                                        {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.username}
                                    </div>
                                    <div className="text-xs text-gray-400">{u.email}</div>
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
                                        ? <span className="badge bg-green-100 text-green-700">Verified</span>
                                        : <span className="badge bg-amber-100 text-amber-600">Pending invite</span>}
                                    {!u.enabled && (
                                        <span className="ml-1 badge bg-red-100 text-red-600">Disabled</span>
                                    )}
                                </td>
                                <td className="px-5 py-3 text-right">
                                    {u.sub !== me?.sub && (
                                        <button
                                            onClick={() => handleDelete(u)}
                                            disabled={deletingSub === u.sub}
                                            className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                                        >
                                            {deletingSub === u.sub ? 'Deleting…' : 'Remove'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {!loading && users.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-5 py-12 text-center text-gray-400">
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
