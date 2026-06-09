import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'

function formatValue(v) {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function TicketHistorySection({ ticketId }) {
    const { get } = useItsmApi()
    const { data: history, loading, error } = useItsmResource(() => get(`/tickets/${ticketId}/history`), [get, ticketId])
    const entries = history || []

    return (
        <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">History</h3>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && entries.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No changes recorded yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="space-y-2">
                    {entries.map(entry => (
                        <li key={entry.id} className="text-sm border-l-2 border-slate-200 dark:border-slate-700 pl-3 py-0.5">
                            <p className="text-slate-700 dark:text-slate-300">
                                <span className="font-medium capitalize">{entry.field_changed.replace(/_/g, ' ')}</span> changed
                                {' '}from <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatValue(entry.old_value)}</span>
                                {' '}to <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{formatValue(entry.new_value)}</span>
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(entry.changed_at)}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
