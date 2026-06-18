import { useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Ticket, Plus, RefreshCw, LayoutGrid, List, AlertCircle } from 'lucide-react'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import {
    TicketCard, LoadingSpinner, ErrorBanner, EmptyState, StatusBadge, PriorityBadge, TenantBadge,
} from '../../shared/itsm/primitives'
import { PageHeader, Button, IconButton, SearchInput, FilterBar, DataTable, Badge } from '../../shared/itsm/ui'
import NewTicketModal from '../components/NewTicketModal'

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'pending', 'resolved', 'closed']
const PRIORITIES = ['all', 'critical', 'high', 'medium', 'low']
const TYPES = ['all', 'incident', 'service_request', 'problem', 'change']

function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TicketsPage() {
    const navigate = useNavigate()
    const { get } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const { isPlatformOrg } = useOutletContext() || {}
    const tenantNames = useTenantDirectory(isPlatformOrg && tenantId === null)
    const [status, setStatus] = useState('all')
    const [priority, setPriority] = useState('all')
    const [type, setType] = useState('all')
    const [search, setSearch] = useState('')
    const [showNew, setShowNew] = useState(false)
    const [view, setView] = useState('table')

    const { data, loading, error, reload } = useItsmResource(
        () => get('/tickets', {
            ...(status !== 'all' ? { status } : {}),
            ...(priority !== 'all' ? { priority } : {}),
            ...(type !== 'all' ? { type } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
        }),
        [get, status, priority, type, search]
    )
    const tickets = data?.tickets || data?.items || []

    // Best-effort category directory (agents/end-users may lack access — degrade gracefully)
    const { data: catData } = useItsmResource(() => get('/tenant/ticket-categories').catch(() => []), [get])
    const catName = useMemo(() => Object.fromEntries((catData || []).map(c => [c.id, c.name])), [catData])

    const crossTenant = isPlatformOrg && tenantId === null

    const columns = [
        {
            key: 'ticket_number', header: 'Ticket', width: '120px',
            render: (t) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.ticket_number || t.id.slice(0, 8)}</span>,
        },
        {
            key: 'title', header: 'Title',
            render: (t) => (
                <div className="min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-md">{t.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        {t.category_id && catName[t.category_id] && <Badge tone="gray">{catName[t.category_id]}</Badge>}
                        {crossTenant && <TenantBadge tenantId={t.tenant_id} tenantNames={tenantNames} />}
                    </div>
                </div>
            ),
        },
        { key: 'product', header: 'Product', width: '130px', render: (t) => t.product_name ? <Badge tone="purple">{t.product_name}</Badge> : <span className="text-slate-400 dark:text-slate-600">—</span> },
        { key: 'type', header: 'Type', width: '120px', render: (t) => <span className="capitalize text-slate-600 dark:text-slate-400">{(t.type || '—').replace(/_/g, ' ')}</span> },
        { key: 'status', header: 'Status', width: '120px', render: (t) => <StatusBadge status={t.status} /> },
        { key: 'priority', header: 'Priority', width: '100px', render: (t) => <PriorityBadge priority={t.priority} /> },
        {
            key: 'sla', header: 'SLA', width: '90px',
            render: (t) => t.sla_breached
                ? <Badge tone="red" icon={AlertCircle}>Breached</Badge>
                : <span className="text-xs text-slate-400 dark:text-slate-500">OK</span>,
        },
        { key: 'created_at', header: 'Created', width: '120px', render: (t) => <span className="text-xs text-slate-500 dark:text-slate-400">{fmtDate(t.created_at)}</span> },
    ]

    const activeFilters = status !== 'all' || priority !== 'all' || type !== 'all' || search.trim()

    return (
        <div className="space-y-5">
            <PageHeader
                title="Tickets"
                subtitle="Incidents, service requests, problems and changes."
                icon={Ticket}
                actions={
                    <>
                        <IconButton icon={RefreshCw} label="Refresh" onClick={reload} />
                        <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                            <IconButton icon={List} label="Table view" size="sm" onClick={() => setView('table')} className={view === 'table' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : ''} />
                            <IconButton icon={LayoutGrid} label="Card view" size="sm" onClick={() => setView('cards')} className={view === 'cards' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : ''} />
                        </div>
                        <Button icon={Plus} onClick={() => setShowNew(true)}>New ticket</Button>
                    </>
                }
            />

            <div className="flex items-center gap-1.5 flex-wrap">
                {STATUS_FILTERS.map(s => (
                    <button
                        key={s}
                        onClick={() => setStatus(s)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                            status === s
                                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                        }`}
                    >
                        {s.replace(/_/g, ' ')}
                    </button>
                ))}
            </div>

            <FilterBar>
                <SearchInput value={search} onChange={setSearch} placeholder="Search tickets…" className="w-64" />
                <select value={priority} onChange={e => setPriority(e.target.value)} className="select w-auto">
                    {PRIORITIES.map(p => <option key={p} value={p}>{p === 'all' ? 'All priorities' : p}</option>)}
                </select>
                <select value={type} onChange={e => setType(e.target.value)} className="select w-auto">
                    {TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t.replace(/_/g, ' ')}</option>)}
                </select>
            </FilterBar>

            <NewTicketModal
                open={showNew}
                onClose={() => setShowNew(false)}
                onCreated={(ticket) => { setShowNew(false); navigate(`/tickets/${ticket.id}`) }}
            />

            {error && <ErrorBanner message={error.message} />}

            {view === 'table' ? (
                <DataTable
                    columns={columns}
                    rows={tickets}
                    loading={loading}
                    onRowClick={(t) => navigate(`/tickets/${t.id}`)}
                    empty={`No tickets found${activeFilters ? ' matching the current filters' : ''}.`}
                />
            ) : loading ? <LoadingSpinner /> : tickets.length === 0 ? (
                <EmptyState>No tickets found{activeFilters ? ' matching the current filters' : ''}.</EmptyState>
            ) : (
                <div className="grid sm:grid-cols-2 gap-2.5">
                    {tickets.map(t => (
                        <TicketCard key={t.id} ticket={t} onClick={() => navigate(`/tickets/${t.id}`)} tenantNames={crossTenant ? tenantNames : null} />
                    ))}
                </div>
            )}
        </div>
    )
}
