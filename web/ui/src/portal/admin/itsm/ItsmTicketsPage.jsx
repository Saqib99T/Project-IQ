import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { TicketCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'pending', 'resolved', 'closed']

export default function ItsmTicketsPage() {
    const navigate = useNavigate()
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const tenantNames = useTenantDirectory(tenantId === null)
    const [status, setStatus] = useState('all')

    const { data, loading, error, reload } = useItsmResource(
        () => get('/tickets', status === 'all' ? {} : { status }),
        [get, status]
    )
    const tickets = data?.tickets || data?.items || []

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                    {STATUS_FILTERS.map(s => (
                        <button
                            key={s}
                            onClick={() => setStatus(s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                                status === s
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            {s.replace(/_/g, ' ')}
                        </button>
                    ))}
                </div>
                <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                tickets.length === 0
                    ? <EmptyState>No tickets found{status !== 'all' ? ` with status "${status.replace(/_/g, ' ')}"` : ''}.</EmptyState>
                    : (
                        <div className="space-y-2.5">
                            {tickets.map(t => (
                                <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/admin/itsm/tickets/${t.id}`)} tenantNames={tenantId === null ? tenantNames : null} />
                            ))}
                        </div>
                    )
            )}
        </div>
    )
}
