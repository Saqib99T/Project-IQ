import { useState } from 'react'
import { ChevronRight, ChevronDown, UserPlus, X, Crown } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import { Badge, IconButton, useToast, useConfirm } from '../../../shared/itsm/ui'

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name ? `${name} (${u.email})` : u.email
}

function TeamMembers({ team, allUsers }) {
    const { get, post, remove } = useItsmApi()
    const { toast } = useToast()
    const confirm = useConfirm()
    const [adding, setAdding] = useState(false)
    const [busy, setBusy] = useState(false)
    const { data: members, loading, reload } = useItsmResource(
        () => get(`/tenant/teams/${team.id}/members`), [get, team.id]
    )
    const memberList = members || []
    const memberIds = new Set(memberList.map(m => m.user_id))
    const candidates = allUsers.filter(u => !memberIds.has(u.id))

    const add = async (userId) => {
        setBusy(true)
        try { await post(`/tenant/teams/${team.id}/members`, { user_id: userId }); setAdding(false); reload() }
        catch (err) { toast(err.message || 'Failed to add', 'error') } finally { setBusy(false) }
    }
    const removeMember = async (m) => {
        const ok = await confirm({ title: 'Remove member?', message: `Remove ${m.name} from ${team.name}?`, danger: true, confirmLabel: 'Remove' })
        if (!ok) return
        setBusy(true)
        try { await remove(`/tenant/teams/${team.id}/members/${m.user_id}`); reload() }
        catch (err) { toast(err.message || 'Failed to remove', 'error') } finally { setBusy(false) }
    }

    return (
        <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Members</span>
                {candidates.length > 0 && (
                    <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                        <UserPlus className="w-3.5 h-3.5" /> Add
                    </button>
                )}
            </div>
            {adding && (
                <select className="select" disabled={busy} defaultValue="" onChange={e => e.target.value && add(e.target.value)}>
                    <option value="">Select a user to add…</option>
                    {candidates.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                </select>
            )}
            {loading ? <p className="text-xs text-slate-400">Loading…</p> : memberList.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">No members yet.</p>
            ) : (
                <ul className="space-y-1">
                    {memberList.map(m => (
                        <li key={m.user_id} className="flex items-center justify-between gap-2 text-sm px-2 py-1 rounded bg-white dark:bg-slate-800/60">
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-slate-700 dark:text-slate-300">{m.name}</span>
                                {m.is_lead && <Badge tone="amber" icon={Crown}>Lead</Badge>}
                            </span>
                            <IconButton icon={X} label="Remove" size="sm" className="hover:text-red-600 dark:hover:text-red-400" onClick={() => removeMember(m)} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function NewTeamModal({ open, onClose, onCreated }) {
    const { get, post } = useItsmApi()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [leadId, setLeadId] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const { data: users } = useItsmResource(() => (open ? get('/tenant/users', { limit: 100 }) : Promise.resolve(null)), [get, open])
    const userList = users?.items || []

    const reset = () => { setName(''); setDescription(''); setLeadId(''); setError(null) }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const team = await post('/tenant/teams', { name, description: description || null, lead_id: leadId || null })
            reset()
            onCreated(team)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New team">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required minLength={1} maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Network operations" />
                </FormField>
                <FormField label="Description (optional)">
                    <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
                </FormField>
                <FormField label="Team lead (optional)">
                    <select className="select" value={leadId} onChange={e => setLeadId(e.target.value)}>
                        <option value="">No lead</option>
                        {userList.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                    </select>
                </FormField>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim()}>
                        {submitting ? 'Creating…' : 'Create team'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default function TeamsSection() {
    const { get } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const [expanded, setExpanded] = useState(null)

    const { data: teams, loading, error, reload } = useItsmResource(() => get('/tenant/teams'), [get])
    const { data: users } = useItsmResource(() => get('/tenant/users', { limit: 100 }), [get])
    const list = teams || []
    const allUsers = users?.items || []
    const userMap = Object.fromEntries(allUsers.map(u => [u.id, u]))

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Teams</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New team</button>
            </div>

            <NewTeamModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                list.length === 0
                    ? <EmptyState>No teams configured.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {list.map(t => {
                                const open = expanded === t.id
                                return (
                                    <li key={t.id} className="text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                        <button onClick={() => setExpanded(open ? null : t.id)} className="w-full flex items-start gap-2 text-left">
                                            {open ? <ChevronDown className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />}
                                            <span className="min-w-0">
                                                <span className="block text-slate-700 dark:text-slate-300">{t.name}</span>
                                                <span className="block text-xs text-slate-400 dark:text-slate-500">
                                                    {t.description || 'No description'} · Lead: {t.lead_id ? (userMap[t.lead_id] ? userLabel(userMap[t.lead_id]) : t.lead_id) : '—'}
                                                </span>
                                            </span>
                                        </button>
                                        {open && <TeamMembers team={t} allUsers={allUsers} />}
                                    </li>
                                )
                            })}
                        </ul>
                    )
            )}
        </div>
    )
}
