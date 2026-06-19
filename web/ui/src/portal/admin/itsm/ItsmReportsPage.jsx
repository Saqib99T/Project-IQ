import { useState } from 'react'
import { usePortalAuth } from '../../PortalAuth'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import {
    StatCard,
    DateRangeFilter,
    TicketSummarySection,
    SlaComplianceSection,
    VolumeTrendSection,
    AssetSummarySection,
    TeamWorkloadSection,
    KbTopArticlesSection,
    AiUsageSection,
} from '../../../shared/itsm/reportSections'

// itsm-service has no cross-tenant ticket-analytics endpoint — platform admins
// get platform-health metrics instead (tenant count, system health, AI usage).
async function loadPlatformOverview(get) {
    const [tenants, health, aiUsage] = await Promise.all([
        get('/platform/tenants', { page_size: 1 }),
        get('/platform/system-health'),
        get('/platform/ai-usage-overview'),
    ])
    return { tenants, health, aiUsage }
}

function PlatformOverviewContainer({ get }) {
    const { data, loading, error, reload } = useItsmResource(() => loadPlatformOverview(get), [get])
    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />
    if (!data) return <EmptyState>No report data available.</EmptyState>
    return <PlatformOverview data={data} reload={reload} />
}

function PlatformOverview({ data, reload }) {
    const { tenants, health, aiUsage } = data
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500 dark:text-slate-400">Platform overview ({aiUsage.month})</p>
                <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Tenants"     value={tenants.total} />
                <StatCard label="Database"    value={health.db} />
                <StatCard label="Redis"       value={health.redis} />
                <StatCard label="AI Tenants Active" value={aiUsage.top_tenants?.length ?? 0} />
            </div>
            <div className="card overflow-hidden">
                <div className="card-header">
                    <h3 className="font-medium text-gray-900 dark:text-slate-100">Top tenants by AI usage — {aiUsage.month}</h3>
                </div>
                {(!aiUsage.top_tenants || aiUsage.top_tenants.length === 0)
                    ? <p className="px-5 py-6 text-sm text-gray-500 dark:text-slate-400">No AI usage recorded this month.</p>
                    : (
                        <table className="table-base">
                            <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                                <tr><th className="px-5 py-2.5">Tenant</th><th className="px-5 py-2.5">Tokens used</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                {aiUsage.top_tenants.map(t => (
                                    <tr key={t.tenant_id}>
                                        <td className="px-5 py-2.5 font-mono text-xs text-gray-600 dark:text-slate-300">{t.tenant_id}</td>
                                        <td className="px-5 py-2.5 text-gray-800 dark:text-slate-200">{t.used_tokens.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
            </div>
        </div>
    )
}

function TenantReports({ get }) {
    const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' })
    const range = {
        ...(dateRange.startDate ? { start_date: dateRange.startDate } : {}),
        ...(dateRange.endDate ? { end_date: dateRange.endDate } : {}),
    }
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-gray-500 dark:text-slate-400">Operational metrics for the selected date range</p>
                <DateRangeFilter startDate={dateRange.startDate} endDate={dateRange.endDate} onChange={setDateRange} />
            </div>
            <TicketSummarySection get={get} range={range} />
            <SlaComplianceSection get={get} range={range} />
            <VolumeTrendSection get={get} range={range} />
            <TeamWorkloadSection get={get} range={range} />
            <AssetSummarySection get={get} />
            <KbTopArticlesSection get={get} />
            <AiUsageSection get={get} range={range} />
        </div>
    )
}

export default function ItsmReportsPage() {
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    // Backend-authoritative platform-admin flag (matches the Platform sidebar) —
    // so a platform-org admin without the super_admin realm role still gets the
    // cross-tenant overview instead of a "tenant context required" error.
    const { isPlatformAdmin } = usePortalAuth()

    // Cross-tenant overview only when a super_admin hasn't narrowed to one tenant —
    // itsm-service has no cross-tenant ticket-analytics endpoint, so platform admins
    // get platform-health metrics instead (tenant count, system health, AI usage).
    const crossTenant = isPlatformAdmin && !tenantId

    return crossTenant
        ? <PlatformOverviewContainer get={get} />
        : <TenantReports get={get} />
}
