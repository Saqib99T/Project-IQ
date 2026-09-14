import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PackageX, RefreshCw, ExternalLink } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { PageHeader, FilterBar, DataTable, Pagination, Badge, Button, useToast } from '../../shared/itsm/ui'

const PROVIDERS = ['shopify', 'amazon', 'walmart', 'ebay', 'etsy']
// Matches app/models/ticket.py's TicketStatus enum in itsm-service.
const TICKET_STATUSES = ['open', 'in_progress', 'pending', 'pending_approval', 'approved', 'rejected', 'resolved', 'closed', 'cancelled']

const LINK_TYPE_TONE = { return: 'amber', replacement: 'indigo' }
const TICKET_STATUS_TONE = {
    open: 'blue', in_progress: 'indigo', pending: 'amber', pending_approval: 'amber',
    approved: 'green', rejected: 'red', resolved: 'green', closed: 'gray', cancelled: 'red',
}

function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : '—'
}

// Kept as a dedicated page (not folded into TicketsPage) per the decision to
// give marketplace-triggered return/replacement requests their own view —
// each row is still a real Ticket underneath and opens the same
// TicketDetailPage everything else uses, including any buyer messages that
// land there as ordinary comments once a connector's messaging actually
// produces one (see MarketplacesSection's messaging-capability note).
export default function MarketplaceReturnsPage() {
    const { get, post } = useItsmApi()
    const { toast } = useToast()
    const navigate = useNavigate()
    const [provider, setProvider] = useState('')
    const [linkType, setLinkType] = useState('')
    const [ticketStatus, setTicketStatus] = useState('')
    const [linkedFrom, setLinkedFrom] = useState('')
    const [linkedTo, setLinkedTo] = useState('')
    const [offset, setOffset] = useState(0)
    const [syncing, setSyncing] = useState(false)
    const limit = 50

    const { data, loading, error, reload } = useItsmResource(
        () => get('/marketplaces/returns', {
            provider: provider || undefined,
            link_type: linkType || undefined,
            ticket_status: ticketStatus || undefined,
            linked_from: linkedFrom ? new Date(linkedFrom).toISOString() : undefined,
            linked_to: linkedTo ? new Date(linkedTo).toISOString() : undefined,
            limit,
            offset,
        }),
        [get, provider, linkType, ticketStatus, linkedFrom, linkedTo, offset],
    )
    const items = data?.items || []
    const total = data?.total ?? 0

    const setFilter = (setter) => (value) => { setter(value); setOffset(0) }

    // Hits /marketplaces/sync (all connected providers at once) — a repeat
    // sync is safe: map_return_to_ticket() keys each ticket's idempotency
    // on the return case's external_case_id, so an already-synced case
    // won't produce a duplicate ticket, only genuinely new cases do.
    const syncAll = async () => {
        setSyncing(true)
        try {
            const result = await post('/marketplaces/sync?kind=returns', {})
            if (result.error) throw new Error(result.error)
            const failed = (result.results || []).filter(r => r.error)
            const totalCreated = (result.results || []).reduce((sum, r) => sum + (r.tickets_created || 0), 0)
            if (failed.length) {
                toast(`Created ${totalCreated} tickets, ${failed.length} marketplace(s) failed`, 'error')
            } else if (!result.results?.length) {
                toast('No connected marketplaces to sync', 'info')
            } else {
                toast(`Created ${totalCreated} return/replacement ticket(s) across ${result.results.length} marketplace(s)`, 'success')
            }
            reload()
        } catch (err) {
            toast(err.message, 'error')
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Returns & Replacements"
                subtitle="Return and replacement requests synced from connected marketplaces — each one is a regular ticket underneath."
                icon={PackageX}
                actions={
                    <Button variant="secondary" size="sm" disabled={syncing} onClick={syncAll}>
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing…' : 'Sync now'}
                    </Button>
                }
            />

            <FilterBar>
                <select className="input text-sm w-auto" value={provider} onChange={e => setFilter(setProvider)(e.target.value)}>
                    <option value="">All marketplaces</option>
                    {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="input text-sm w-auto" value={linkType} onChange={e => setFilter(setLinkType)(e.target.value)}>
                    <option value="">Returns + replacements</option>
                    <option value="return">Returns only</option>
                    <option value="replacement">Replacements only</option>
                </select>
                <select className="input text-sm w-auto" value={ticketStatus} onChange={e => setFilter(setTicketStatus)(e.target.value)}>
                    <option value="">All ticket statuses</option>
                    {TICKET_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <input type="date" className="input text-sm w-auto" value={linkedFrom} onChange={e => setFilter(setLinkedFrom)(e.target.value)} title="Raised on/after" />
                <span className="text-xs text-slate-400">to</span>
                <input type="date" className="input text-sm w-auto" value={linkedTo} onChange={e => setFilter(setLinkedTo)(e.target.value)} title="Raised on/before" />
            </FilterBar>

            <DataTable
                loading={loading}
                empty={error ? error.message : 'No return/replacement requests yet.'}
                rowKey={(r) => r.ticket.id}
                rows={items}
                onRowClick={(r) => navigate(`/tickets/${r.ticket.id}`)}
                columns={[
                    { key: 'link_type', header: 'Type', render: (r) => <Badge tone={LINK_TYPE_TONE[r.link_type] || 'gray'}>{r.link_type}</Badge> },
                    { key: 'ticket_number', header: 'Ticket', render: (r) => <span className="font-mono text-xs">{r.ticket.ticket_number}</span> },
                    { key: 'title', header: 'Title', render: (r) => <span className="truncate">{r.ticket.title}</span> },
                    { key: 'ticket_status', header: 'Status', render: (r) => <Badge tone={TICKET_STATUS_TONE[r.ticket.status] || 'gray'}>{r.ticket.status?.replace('_', ' ')}</Badge> },
                    { key: 'priority', header: 'Priority', render: (r) => <span className="capitalize">{r.ticket.priority}</span> },
                    { key: 'provider', header: 'Marketplace', render: (r) => <span className="capitalize">{r.order.provider}</span> },
                    {
                        key: 'external_order_id', header: 'Order ID',
                        // Same deep-link-to-real-record pattern as
                        // MarketplaceOrdersPage — stopPropagation matters
                        // here since rows are clickable (navigate to the
                        // ticket) unlike the Orders page.
                        render: (r) => r.order.external_url ? (
                            <a
                                href={r.order.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                                {r.order.external_order_id}
                                <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                        ) : <span className="font-mono text-xs">{r.order.external_order_id}</span>,
                    },
                    { key: 'linked_at', header: 'Raised', render: (r) => formatDate(r.linked_at) },
                ]}
            />

            <Pagination
                label={`${items.length ? offset + 1 : 0}–${offset + items.length} of ${total}`}
                hasPrev={offset > 0}
                hasNext={offset + limit < total}
                onPrev={() => setOffset(o => Math.max(0, o - limit))}
                onNext={() => setOffset(o => o + limit)}
            />
        </div>
    )
}
