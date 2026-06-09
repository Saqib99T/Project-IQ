import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

function NewSlaPolicyModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [responseMinutes, setResponseMinutes] = useState('60')
    const [resolutionMinutes, setResolutionMinutes] = useState('480')
    const [businessHoursOnly, setBusinessHoursOnly] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => { setName(''); setResponseMinutes('60'); setResolutionMinutes('480'); setBusinessHoursOnly(true); setError(null) }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const policy = await post('/tenant/sla-policies', {
                name,
                response_time_minutes: Number(responseMinutes),
                resolution_time_minutes: Number(resolutionMinutes),
                business_hours_only: businessHoursOnly,
            })
            reset()
            onCreated(policy)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New SLA policy">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard support" />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Response time (minutes)">
                        <input type="number" className="input" required min={1} value={responseMinutes} onChange={e => setResponseMinutes(e.target.value)} />
                    </FormField>
                    <FormField label="Resolution time (minutes)">
                        <input type="number" className="input" required min={1} value={resolutionMinutes} onChange={e => setResolutionMinutes(e.target.value)} />
                    </FormField>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={businessHoursOnly} onChange={e => setBusinessHoursOnly(e.target.checked)} />
                    Business hours only
                </label>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim()}>
                        {submitting ? 'Creating…' : 'Create policy'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

export default function SlaPoliciesSection() {
    const { get, patch } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const [savingId, setSavingId] = useState(null)
    const [error, setError] = useState(null)

    const { data: policies, loading, reload } = useItsmResource(() => get('/tenant/sla-policies'), [get])
    const list = policies || []

    const updateField = async (policy, field, value) => {
        setSavingId(policy.id); setError(null)
        try {
            await patch(`/tenant/sla-policies/${policy.id}`, { [field]: value })
            reload()
        } catch (err) { setError(err) } finally { setSavingId(null) }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">SLA policies</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New policy</button>
            </div>

            <NewSlaPolicyModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                list.length === 0
                    ? <EmptyState>No SLA policies configured.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {list.map(p => (
                                <li key={p.id} className="flex items-center justify-between gap-3 text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{p.name}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">
                                            Respond in {p.response_time_minutes}m · resolve in {p.resolution_time_minutes}m
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                                        <input
                                            type="checkbox" checked={p.business_hours_only} disabled={savingId === p.id}
                                            onChange={e => updateField(p, 'business_hours_only', e.target.checked)}
                                        />
                                        Business hours only
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
