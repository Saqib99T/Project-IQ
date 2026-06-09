import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function AuditLogSection() {
    const { get } = useItsmApi()
    const [page, setPage] = useState(1)
    const pageSize = 25

    const { data, loading, error } = useItsmResource(
        () => get('/tenant/audit-log', { page, page_size: pageSize }),
        [get, page]
    )
    const items = data?.items || []
    const total = data?.total || 0
    const hasMore = page * pageSize < total

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Audit log</h3>
                <span className="text-xs text-slate-400 dark:text-slate-500">{total} entries</span>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && items.length === 0 && <EmptyState>No audit log entries.</EmptyState>}

            {items.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map(entry => (
                        <li key={entry.id} className="py-2 text-sm">
                            <p className="text-slate-800 dark:text-slate-200">
                                <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{entry.http_method}</span>
                                {' '}<span className="font-mono text-xs">{entry.endpoint}</span>
                            </p>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                {entry.actor_email} ({entry.platform_role}) · {formatDate(entry.accessed_at)}
                                {entry.action ? ` · ${entry.action}` : ''}
                            </p>
                        </li>
                    ))}
                </ul>
            )}

            {(page > 1 || hasMore) && (
                <div className="flex items-center justify-between pt-1">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost text-xs py-1.5">← Previous</button>
                    <span className="text-xs text-slate-400 dark:text-slate-500">Page {page}</span>
                    <button onClick={() => setPage(p => p + 1)} disabled={!hasMore} className="btn-ghost text-xs py-1.5">Next →</button>
                </div>
            )}
        </div>
    )
}
