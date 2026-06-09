import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'

const TYPES = ['scheduled', 'reactive', 'preventive']
const STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled']

function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString()
}

function NewMaintenanceModal({ open, onClose, assetId, onCreated }) {
    const { post } = useItsmApi()
    const [type, setType] = useState('scheduled')
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [scheduledDate, setScheduledDate] = useState('')
    const [cost, setCost] = useState('')
    const [notes, setNotes] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => {
        setType('scheduled'); setTitle(''); setDescription(''); setScheduledDate('')
        setCost(''); setNotes(''); setError(null)
    }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const record = await post(`/assets/${assetId}/maintenance`, {
                type, title, description: description || null,
                scheduled_date: scheduledDate,
                cost: cost ? Number(cost) : null,
                notes: notes || null,
            })
            reset()
            onCreated(record)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="Schedule maintenance">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Title">
                    <input className="input" required minLength={1} maxLength={500} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Annual battery replacement" />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Type">
                        <select className="select" value={type} onChange={e => setType(e.target.value)}>
                            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Scheduled date">
                        <input type="date" className="input" required value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
                    </FormField>
                </div>
                <FormField label="Description">
                    <textarea className="input min-h-[80px] text-sm" value={description} onChange={e => setDescription(e.target.value)} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Estimated cost">
                        <input type="number" step="0.01" min="0" className="input" value={cost} onChange={e => setCost(e.target.value)} />
                    </FormField>
                    <FormField label="Notes">
                        <input className="input" value={notes} onChange={e => setNotes(e.target.value)} />
                    </FormField>
                </div>
                {error && <ErrorBanner message={error.message} />}
                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !title.trim() || !scheduledDate}>
                        {submitting ? 'Scheduling…' : 'Schedule'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default function MaintenanceSection({ assetId }) {
    const { get, patch } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const [savingId, setSavingId] = useState(null)
    const [error, setError] = useState(null)

    const { data, loading, reload } = useItsmResource(
        () => get(`/assets/${assetId}/maintenance`),
        [get, assetId]
    )
    const records = data?.items || data || []

    const updateStatus = async (record, status) => {
        setSavingId(record.id); setError(null)
        try {
            const body = { status }
            if (status === 'completed' && !record.completed_date) {
                body.completed_date = new Date().toISOString().slice(0, 10)
            }
            await patch(`/assets/${assetId}/maintenance/${record.id}`, body)
            reload()
        } catch (err) { setError(err) } finally { setSavingId(null) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Maintenance</h3>
                <button onClick={() => setShowNew(true)} className="btn-ghost text-xs py-1.5">+ Schedule</button>
            </div>

            <NewMaintenanceModal
                open={showNew}
                onClose={() => setShowNew(false)}
                assetId={assetId}
                onCreated={() => { setShowNew(false); reload() }}
            />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                records.length === 0
                    ? <EmptyState>No maintenance records.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {records.map(r => (
                                <li key={r.id} className="flex items-center justify-between gap-3 text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{r.title}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">
                                            {r.type} · scheduled {formatDate(r.scheduled_date)}
                                            {r.completed_date ? ` · completed ${formatDate(r.completed_date)}` : ''}
                                            {r.cost != null ? ` · ${r.cost}` : ''}
                                        </p>
                                    </div>
                                    <select
                                        className="select text-xs py-1 shrink-0" value={r.status} disabled={savingId === r.id}
                                        onChange={e => updateStatus(r, e.target.value)}
                                    >
                                        {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                                    </select>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
