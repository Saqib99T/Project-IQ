import { useState } from 'react'
import { useItsmApi, useItsmResource } from './useItsmApi'
import { ErrorBanner } from './primitives'

const STATUSES = ['open', 'in_progress', 'pending', 'pending_approval', 'approved', 'rejected', 'resolved', 'closed', 'cancelled']
const PRIORITIES = ['low', 'medium', 'high', 'critical']

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name ? `${name} (${u.email})` : u.email
}

/**
 * Inline-editable ticket fields — each select auto-saves via PATCH /tickets/{id}
 * on change. Requires agent-or-above ITSM role on the backend (enforced server-side).
 *
 * Shared by the portal (admin + operator) and the standalone itsm-app.
 */
export default function TicketEditPanel({ ticket, onUpdated }) {
    const { get, patch } = useItsmApi()
    const [saving, setSaving] = useState(null)
    const [error, setError] = useState(null)

    const { data: users }  = useItsmResource(() => get('/tenant/users', { limit: 100 }), [get])
    const { data: teams }  = useItsmResource(() => get('/tenant/teams'), [get])
    // Only offer statuses the state machine actually allows from the current one
    // (plus the current status itself). Picking an unreachable status otherwise
    // returns a 409 "Cannot transition from X to Y". Reloads when status changes.
    const { data: trans }  = useItsmResource(
        () => get(`/tickets/${ticket.id}/transitions`), [get, ticket.id, ticket.status])
    const userList = users?.items || []
    const teamList = teams || []
    const statusOptions = trans?.valid
        ? [ticket.status, ...trans.valid.filter(s => s !== ticket.status)]
        : STATUSES

    const save = async (field, value) => {
        if (!value && (field === 'assignee_id' || field === 'team_id')) return
        setSaving(field)
        setError(null)
        try {
            // itsm-service's UpdateTicketRequest drops null fields (exclude_none),
            // so clearing assignee/team back to "Unassigned" isn't possible via PATCH.
            const updated = await patch(`/tickets/${ticket.id}`, { [field]: value })
            onUpdated(updated)
        } catch (err) {
            setError(err)
        } finally {
            setSaving(null)
        }
    }

    return (
        <div className="space-y-3">
            {error && <ErrorBanner message={error.message} />}
            <div className="grid grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</span>
                    <select
                        className="select text-sm" value={ticket.status} disabled={saving === 'status'}
                        onChange={e => save('status', e.target.value)}
                    >
                        {statusOptions.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Priority</span>
                    <select
                        className="select text-sm" value={ticket.priority} disabled={saving === 'priority'}
                        onChange={e => save('priority', e.target.value)}
                    >
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Assignee</span>
                    <select
                        className="select text-sm" value={ticket.assignee_id || ''} disabled={saving === 'assignee_id'}
                        onChange={e => save('assignee_id', e.target.value || null)}
                    >
                        <option value="">Unassigned</option>
                        {userList.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Team</span>
                    <select
                        className="select text-sm" value={ticket.team_id || ''} disabled={saving === 'team_id'}
                        onChange={e => save('team_id', e.target.value || null)}
                    >
                        <option value="">No team</option>
                        {teamList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                </label>
            </div>
        </div>
    )
}
