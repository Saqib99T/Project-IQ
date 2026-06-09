import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MonitorSmartphone, Plus, RefreshCw, LayoutGrid, List } from 'lucide-react'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { AssetCard, LoadingSpinner, ErrorBanner, EmptyState, TenantBadge } from '../../shared/itsm/primitives'
import { PageHeader, Button, IconButton, SearchInput, FilterBar, DataTable, Badge } from '../../shared/itsm/ui'
import NewAssetModal from '../components/NewAssetModal'

const STATUSES = ['all', 'in_stock', 'in_use', 'in_maintenance', 'retired', 'disposed', 'lost']
const CONDITIONS = ['all', 'new', 'good', 'fair', 'poor']

const ASSET_STATUS_TONE = {
    in_use: 'blue', in_stock: 'green', in_maintenance: 'amber',
    retired: 'gray', disposed: 'gray', lost: 'red',
}

export default function AssetsPage() {
    const navigate = useNavigate()
    const { get } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const tenantNames = useTenantDirectory(tenantId === null)
    const [status, setStatus] = useState('all')
    const [condition, setCondition] = useState('all')
    const [search, setSearch] = useState('')
    const [showNew, setShowNew] = useState(false)
    const [view, setView] = useState('table')

    const { data, loading, error, reload } = useItsmResource(
        () => get('/assets', {
            ...(status !== 'all' ? { status } : {}),
            ...(condition !== 'all' ? { condition } : {}),
            ...(search.trim() ? { search: search.trim() } : {}),
        }),
        [get, status, condition, search]
    )
    const assets = data?.assets || data?.items || []
    const crossTenant = tenantId === null
    const activeFilters = status !== 'all' || condition !== 'all' || search.trim()

    const columns = [
        {
            key: 'asset_tag', header: 'Tag', width: '120px',
            render: (a) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{a.asset_tag || a.id.slice(0, 8)}</span>,
        },
        {
            key: 'name', header: 'Name',
            render: (a) => (
                <div className="min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-md">{a.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-slate-400 dark:text-slate-500">{a.manufacturer || a.model_number || '—'}</span>
                        {crossTenant && <TenantBadge tenantId={a.tenant_id} tenantNames={tenantNames} />}
                    </div>
                </div>
            ),
        },
        { key: 'serial_number', header: 'Serial', width: '140px', render: (a) => <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{a.serial_number || '—'}</span> },
        { key: 'condition', header: 'Condition', width: '100px', render: (a) => <span className="capitalize text-slate-600 dark:text-slate-400">{a.condition || '—'}</span> },
        {
            key: 'status', header: 'Status', width: '130px',
            render: (a) => <Badge tone={ASSET_STATUS_TONE[a.status] || 'gray'}>{(a.status || 'unknown').replace(/_/g, ' ')}</Badge>,
        },
    ]

    return (
        <div className="space-y-5">
            <PageHeader
                title="Assets"
                subtitle="Hardware, software and infrastructure tracked in the CMDB."
                icon={MonitorSmartphone}
                actions={
                    <>
                        <IconButton icon={RefreshCw} label="Refresh" onClick={reload} />
                        <div className="flex items-center rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
                            <IconButton icon={List} label="Table view" size="sm" onClick={() => setView('table')} className={view === 'table' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : ''} />
                            <IconButton icon={LayoutGrid} label="Card view" size="sm" onClick={() => setView('cards')} className={view === 'cards' ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' : ''} />
                        </div>
                        <Button icon={Plus} onClick={() => setShowNew(true)}>New asset</Button>
                    </>
                }
            />

            <FilterBar>
                <SearchInput value={search} onChange={setSearch} placeholder="Search assets…" className="w-64" />
                <select value={status} onChange={e => setStatus(e.target.value)} className="select w-auto">
                    {STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
                </select>
                <select value={condition} onChange={e => setCondition(e.target.value)} className="select w-auto">
                    {CONDITIONS.map(c => <option key={c} value={c}>{c === 'all' ? 'All conditions' : c}</option>)}
                </select>
            </FilterBar>

            <NewAssetModal
                open={showNew}
                onClose={() => setShowNew(false)}
                onCreated={(asset) => { setShowNew(false); navigate(`/assets/${asset.id}`) }}
            />

            {error && <ErrorBanner message={error.message} />}

            {view === 'table' ? (
                <DataTable
                    columns={columns}
                    rows={assets}
                    loading={loading}
                    onRowClick={(a) => navigate(`/assets/${a.id}`)}
                    empty={`No assets found${activeFilters ? ' matching the current filters' : ''}.`}
                />
            ) : loading ? <LoadingSpinner /> : assets.length === 0 ? (
                <EmptyState>No assets found{activeFilters ? ' matching the current filters' : ''}.</EmptyState>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {assets.map(a => <AssetCard key={a.id} asset={a} onClick={() => navigate(`/assets/${a.id}`)} tenantNames={crossTenant ? tenantNames : null} />)}
                </div>
            )}
        </div>
    )
}
