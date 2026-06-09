import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import { useConfirm } from '../../../shared/itsm/ui'
import NewWebhookModal from './NewWebhookModal'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

const STATUS_STYLES = {
    delivered: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    failed:    'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    pending:   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    retrying:  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}

function DeliveriesModal({ endpoint, onClose }) {
    const { get } = useItsmApi()
    const { data, loading, error } = useItsmResource(
        () => endpoint ? get(`/webhooks-config/endpoints/${endpoint.id}/deliveries`) : Promise.resolve(null),
        [get, endpoint?.id]
    )
    const deliveries = data?.items || []

    return (
        <Modal open={!!endpoint} onClose={onClose} title={endpoint ? `Deliveries — ${endpoint.name}` : ''} maxWidth="max-w-2xl">
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && (
                deliveries.length === 0
                    ? <EmptyState>No deliveries recorded for this endpoint yet.</EmptyState>
                    : (
                        <div className="space-y-1.5 max-h-96 overflow-y-auto">
                            {deliveries.map(d => (
                                <div key={d.id} className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono text-xs text-slate-600 dark:text-slate-300">{d.event_type}</span>
                                        <span className={`badge ${STATUS_STYLES[d.status] || 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{d.status}</span>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                        Attempt {d.attempt_count} · {d.response_status_code ? `HTTP ${d.response_status_code}` : 'no response'}
                                        {d.delivered_at ? ` · delivered ${formatDate(d.delivered_at)}` : d.next_retry_at ? ` · retry ${formatDate(d.next_retry_at)}` : ''}
                                    </p>
                                    {d.error_message && <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {d.error_message}</p>}
                                </div>
                            ))}
                        </div>
                    )
            )}
        </Modal>
    )
}

export default function WebhooksSection() {
    const { get, post, patch, remove } = useItsmApi()
    const confirm = useConfirm()
    const [showNew, setShowNew] = useState(false)
    const [deliveriesEndpoint, setDeliveriesEndpoint] = useState(null)
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data, loading, reload } = useItsmResource(() => get('/webhooks-config/endpoints'), [get])
    const endpoints = data?.items || []

    const toggleActive = async (ep) => {
        setBusyId(ep.id); setError(null)
        try {
            if (ep.is_active) await patch(`/webhooks-config/endpoints/${ep.id}`, { is_active: false })
            else await post(`/webhooks-config/endpoints/${ep.id}/enable`, {})
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    const test = async (ep) => {
        setBusyId(ep.id); setError(null)
        try {
            await post(`/webhooks-config/endpoints/${ep.id}/test`, {})
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    const del = async (ep) => {
        if (!(await confirm({ title: 'Delete endpoint?', message: `Delete webhook endpoint "${ep.name}"?`, danger: true, confirmLabel: 'Delete' }))) return
        setBusyId(ep.id); setError(null)
        try {
            await remove(`/webhooks-config/endpoints/${ep.id}`)
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Webhook endpoints</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New endpoint</button>
            </div>

            <NewWebhookModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />
            <DeliveriesModal endpoint={deliveriesEndpoint} onClose={() => setDeliveriesEndpoint(null)} />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && (
                endpoints.length === 0
                    ? <EmptyState>No webhook endpoints configured.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {endpoints.map(ep => (
                                <li key={ep.id} className="flex items-center justify-between gap-3 text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300 truncate">{ep.name}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                                            {ep.url} · {ep.events.join(', ') || 'no events'} · {ep.failure_count} failures
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <button onClick={() => setDeliveriesEndpoint(ep)} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">Deliveries</button>
                                        <button onClick={() => test(ep)} disabled={busyId === ep.id} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Test</button>
                                        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                            <input type="checkbox" checked={ep.is_active} disabled={busyId === ep.id} onChange={() => toggleActive(ep)} />
                                            Active
                                        </label>
                                        <button onClick={() => del(ep)} disabled={busyId === ep.id} className="text-xs text-red-600 dark:text-red-400 hover:underline">Delete</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
