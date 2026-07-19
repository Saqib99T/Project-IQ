import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { EmptyState } from '../../shared/itsm/primitives'
import {
    DateRangeFilter,
    TicketSummarySection,
    SlaComplianceSection,
    VolumeTrendSection,
    AssetSummarySection,
    TeamWorkloadSection,
    KbTopArticlesSection,
    AiUsageSection,
    RcaComplianceSection,
} from '../../shared/itsm/reportSections'

export default function ReportsPage() {
    const { get } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const { isPlatformOrg } = useOutletContext() || {}
    const [dateRange, setDateRange] = useState({ startDate: '', endDate: '' })
    const range = {
        ...(dateRange.startDate ? { start_date: dateRange.startDate } : {}),
        ...(dateRange.endDate ? { end_date: dateRange.endDate } : {}),
    }

    // Reports aggregate strictly per-tenant. A tenant user's tenant comes from
    // their JWT (tenantId null) — only a PLATFORM-org user must pick one first.
    if (isPlatformOrg && tenantId === null) {
        return (
            <div className="max-w-5xl">
                <EmptyState>Select a tenant from the switcher above to view its reports.</EmptyState>
            </div>
        )
    }

    return (
        <div className="max-w-5xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">Operational metrics for the selected date range</p>
                <DateRangeFilter startDate={dateRange.startDate} endDate={dateRange.endDate} onChange={setDateRange} />
            </div>

            <TicketSummarySection get={get} range={range} />
            <SlaComplianceSection get={get} range={range} />
            <VolumeTrendSection get={get} range={range} />
            <TeamWorkloadSection get={get} range={range} />
            <AssetSummarySection get={get} />
            <KbTopArticlesSection get={get} />
            <AiUsageSection get={get} range={range} />
            <RcaComplianceSection get={get} />
        </div>
    )
}
