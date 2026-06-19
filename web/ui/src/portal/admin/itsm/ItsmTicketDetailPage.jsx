import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { useItsmPermissions } from '../../../shared/itsm/useItsmPermissions'
import { StatusBadge, PriorityBadge, LoadingSpinner, ErrorBanner } from '../../../shared/itsm/primitives'
import TicketEditPanel from '../../../shared/itsm/TicketEditPanel'
import CommentsSection from '../../../shared/itsm/CommentsSection'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function ItsmTicketDetailPage() {
    const { ticketId } = useParams()
    const navigate = useNavigate()
    const location = useLocation()
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const { isAgent } = useItsmPermissions()

    // Route-aware: this page renders under both /admin/itsm/tickets/:id and
    // /operator/tickets/:id — send "Back" to the right list.
    const isOperator = location.pathname.startsWith('/operator')
    const listPath = isOperator ? '/operator/tickets' : '/admin/itsm'

    const { data: ticket, loading, error, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}`),
        [get, ticketId]
    )

    return (
        <div className="space-y-4">
            <button onClick={() => navigate(listPath)} className="btn-ghost text-xs">← Back to tickets</button>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && ticket && (
                <div className="card p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <p className="text-xs font-mono text-gray-400 dark:text-slate-500">{ticket.ticket_number || ticket.id}</p>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{ticket.title}</h2>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusBadge status={ticket.status} />
                            <PriorityBadge priority={ticket.priority} />
                        </div>
                    </div>

                    <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">{ticket.description || 'No description provided.'}</p>

                    {/* Agents (incl. operators) get inline status/priority/assignee/team editing */}
                    {isAgent && (
                        <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                            <TicketEditPanel ticket={ticket} onUpdated={reload} />
                        </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-gray-100 dark:border-slate-800 text-sm">
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Type</p>
                            <p className="text-gray-800 dark:text-slate-200 capitalize">{(ticket.type || '—').replace(/_/g, ' ')}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Product</p>
                            <p className="text-gray-800 dark:text-slate-200">{ticket.product_name || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Requester</p>
                            <p className="text-gray-800 dark:text-slate-200">{ticket.requester_name || ticket.requester_email || ticket.requester_id || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Assignee</p>
                            <p className="text-gray-800 dark:text-slate-200">{ticket.assignee_name || ticket.assignee_id || 'Unassigned'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">SLA</p>
                            <p className={`text-gray-800 dark:text-slate-200 ${ticket.sla_breached ? 'text-red-600 dark:text-red-400 font-medium' : ''}`}>
                                {ticket.sla_breached ? 'Breached' : 'Within SLA'}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Created</p>
                            <p className="text-gray-800 dark:text-slate-200">{formatDate(ticket.created_at)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-gray-400 dark:text-slate-500 uppercase tracking-wide">Updated</p>
                            <p className="text-gray-800 dark:text-slate-200">{formatDate(ticket.updated_at)}</p>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
                    </div>
                </div>
            )}

            {/* Comments — visible to all; posting/internal-note controls gate by role */}
            {!loading && !error && ticket && (
                <div className="card p-6">
                    <CommentsSection ticketId={ticket.id} />
                </div>
            )}
        </div>
    )
}
