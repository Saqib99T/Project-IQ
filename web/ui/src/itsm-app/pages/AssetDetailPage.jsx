import { useState } from 'react'
import { useNavigate, useParams, useOutletContext } from 'react-router-dom'
import {
    Trash2, RefreshCw, Wrench, Network, Activity, Ticket, Paperclip, History,
} from 'lucide-react'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { TenantBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import { Button, IconButton, Badge, Breadcrumb, Tabs, useConfirm } from '../../shared/itsm/ui'
import AssetEditPanel from '../components/AssetEditPanel'
import AssignAssetControl from '../components/AssignAssetControl'
import MaintenanceSection from '../components/MaintenanceSection'
import AssetRelationshipsSection from '../components/AssetRelationshipsSection'
import AssetLinkedTicketsSection from '../components/AssetLinkedTicketsSection'
import AssetAttachmentsSection from '../components/AssetAttachmentsSection'
import AssetImpactAnalysisSection from '../components/AssetImpactAnalysisSection'
import AssetHistorySection from '../components/AssetHistorySection'
import AiMaintenancePredictionSection from '../components/AiMaintenancePredictionSection'

function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString()
}

const ASSET_STATUS_TONE = {
    in_use: 'blue', in_stock: 'green', in_maintenance: 'amber',
    retired: 'gray', disposed: 'gray', lost: 'red',
}

function MetaRow({ label, children }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
            <span className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide shrink-0">{label}</span>
            <span className="text-sm text-slate-700 dark:text-slate-300 text-right min-w-0 truncate">{children}</span>
        </div>
    )
}

export default function AssetDetailPage() {
    const { assetId } = useParams()
    const navigate = useNavigate()
    const { get, remove } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const { isPlatformOrg } = useOutletContext() || {}
    const confirm = useConfirm()
    const tenantNames = useTenantDirectory(isPlatformOrg && tenantId === null)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState(null)
    const [tab, setTab] = useState('maintenance')

    const { data: asset, loading, error, reload } = useItsmResource(
        () => get(`/assets/${assetId}`),
        [get, assetId]
    )

    const deleteAsset = async () => {
        const ok = await confirm({ title: 'Delete asset?', message: `"${asset.name}" will be permanently deleted.`, danger: true, confirmLabel: 'Delete' })
        if (!ok) return
        setDeleting(true); setDeleteError(null)
        try {
            await remove(`/assets/${assetId}`)
            navigate('/assets')
        } catch (err) { setDeleteError(err); setDeleting(false) }
    }

    const TABS = [
        { id: 'maintenance', label: 'Maintenance', icon: Wrench },
        { id: 'relationships', label: 'Relationships', icon: Network },
        { id: 'impact', label: 'Impact', icon: Activity },
        { id: 'tickets', label: 'Linked Tickets', icon: Ticket },
        { id: 'attachments', label: 'Attachments', icon: Paperclip },
        { id: 'history', label: 'History', icon: History },
    ]

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Breadcrumb items={[{ label: 'Assets', onClick: () => navigate('/assets') }, { label: asset?.asset_tag || 'Asset' }]} />
                {asset && (
                    <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={deleteAsset} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
                )}
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {deleteError && <ErrorBanner message={deleteError.message} />}

            {!loading && !error && asset && (
                <div className="flex gap-4 items-start flex-col lg:flex-row">
                    {/* Main column */}
                    <div className="flex-1 min-w-0 space-y-4 w-full">
                        <div className="card p-6 space-y-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{asset.asset_tag || asset.id}</span>
                                <Badge tone={ASSET_STATUS_TONE[asset.status] || 'gray'}>{(asset.status || 'unknown').replace(/_/g, ' ')}</Badge>
                                {isPlatformOrg && tenantId === null && <TenantBadge tenantId={asset.tenant_id} tenantNames={tenantNames} />}
                            </div>
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{asset.name}</h2>
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{asset.description || 'No description provided.'}</p>
                        </div>

                        <AiMaintenancePredictionSection assetId={asset.id} />

                        <div className="card p-6 space-y-4">
                            <Tabs tabs={TABS} value={tab} onChange={setTab} />
                            <div className="pt-1">
                                {tab === 'maintenance' && <MaintenanceSection assetId={asset.id} />}
                                {tab === 'relationships' && <AssetRelationshipsSection assetId={asset.id} />}
                                {tab === 'impact' && <AssetImpactAnalysisSection assetId={asset.id} />}
                                {tab === 'tickets' && <AssetLinkedTicketsSection assetId={asset.id} />}
                                {tab === 'attachments' && <AssetAttachmentsSection assetId={asset.id} />}
                                {tab === 'history' && <AssetHistorySection assetId={asset.id} />}
                            </div>
                        </div>
                    </div>

                    {/* Sticky summary rail */}
                    <aside className="w-full lg:w-80 shrink-0 space-y-4 lg:sticky lg:top-0">
                        <div className="card p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Details</h3>
                                <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={reload} />
                            </div>
                            <div>
                                <MetaRow label="Serial">{asset.serial_number || '—'}</MetaRow>
                                <MetaRow label="Model">{asset.model_number || '—'}</MetaRow>
                                <MetaRow label="Manufacturer">{asset.manufacturer || '—'}</MetaRow>
                                <MetaRow label="Condition"><span className="capitalize">{asset.condition || '—'}</span></MetaRow>
                                <MetaRow label="Purchased">{formatDate(asset.purchase_date)}</MetaRow>
                                <MetaRow label="Cost">{asset.purchase_cost != null ? asset.purchase_cost : '—'}</MetaRow>
                                <MetaRow label="Warranty">{formatDate(asset.warranty_expiry_date)}</MetaRow>
                            </div>
                        </div>

                        <div className="card p-5">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Assignment</h3>
                            <AssignAssetControl asset={asset} onUpdated={reload} />
                        </div>

                        <div className="card p-5">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Manage</h3>
                            <AssetEditPanel asset={asset} onUpdated={reload} />
                        </div>
                    </aside>
                </div>
            )}
        </div>
    )
}
