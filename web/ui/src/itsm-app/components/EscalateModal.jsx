import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../shared/itsm/primitives'

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name ? `${name} (${u.email})` : u.email
}

export default function EscalateModal({ open, onClose, ticketId, onEscalated }) {
    const { get, post } = useItsmApi()
    const [escalatedTo, setEscalatedTo] = useState('')
    const [reason, setReason] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const { data: users } = useItsmResource(() => (open ? get('/tenant/users', { limit: 100 }) : Promise.resolve(null)), [get, open])
    const userList = users?.items || []

    const close = () => { if (!submitting) { setEscalatedTo(''); setReason(''); setError(null); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            await post(`/tickets/${ticketId}/escalate`, { escalated_to: escalatedTo || null, reason })
            setEscalatedTo(''); setReason('')
            onEscalated()
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="Escalate ticket">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Escalate to (optional — defaults to team lead)">
                    <select className="select" value={escalatedTo} onChange={e => setEscalatedTo(e.target.value)}>
                        <option value="">Team lead (default)</option>
                        {userList.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                    </select>
                </FormField>
                <FormField label="Reason">
                    <textarea
                        className="input min-h-[100px]" required minLength={1} maxLength={2000}
                        value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="Why does this ticket need escalation?"
                    />
                </FormField>
                {error && <ErrorBanner message={error.message} />}
                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !reason.trim()}>
                        {submitting ? 'Escalating…' : 'Escalate'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
