import { useState, type ReactNode } from 'react'
import { useItsmResource, type ItsmApi } from './useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from './primitives'

/**
 * Shared report visualizations + per-endpoint sections, used by both the
 * standalone ITSM app's ReportsPage and the embedded admin ItsmReportsPage —
 * keeps the two surfaces showing the same metrics for a tenant.
 *
 * No charting library is available in this project, so everything here is
 * plain HTML/CSS (stat cards, proportional bar lists, simple tables).
 */

// itsm-service report endpoints each return a differently-shaped payload and
// this layer only ever reads/displays them (no writes) — a loose record
// rather than one interface per endpoint. Real request/response typing lives
// in useItsmApi.ts, where round-trip correctness actually matters.
type ReportData = Record<string, any>
export interface DateRange { startDate: string; endDate: string; [key: string]: string }
export interface ReportSectionProps { get: ItsmApi['get']; range: DateRange }
export interface SimpleReportSectionProps { get: ItsmApi['get'] }

export function StatCard({ label, value }: { label: ReactNode; value?: ReactNode }) {
    return (
        <div className="card p-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{value ?? '—'}</p>
        </div>
    )
}

export function Section({ title, children }: { title: ReactNode; children?: ReactNode }) {
    return (
        <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
            {children}
        </div>
    )
}

/** Horizontal bar breakdown of a {label: count} map, e.g. tickets by status. */
export function BreakdownBars({ data, total }: { data?: Record<string, number>; total?: number }) {
    const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1])
    if (!entries.length) return <p className="text-sm text-slate-400 dark:text-slate-500">No data.</p>
    const max = Math.max(...entries.map(([, v]) => v), 1)
    return (
        <div className="space-y-1.5">
            {entries.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-xs text-slate-600 dark:text-slate-400 capitalize truncate">{key.replace(/_/g, ' ')}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-blue-500 dark:bg-blue-500/70 rounded-full" style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                    <span className="w-16 shrink-0 text-xs text-right text-slate-700 dark:text-slate-300 font-medium">
                        {value}{total ? ` (${Math.round((value / total) * 100)}%)` : ''}
                    </span>
                </div>
            ))}
        </div>
    )
}

export function RcaComplianceSection({ get }: SimpleReportSectionProps) {
    const { data: summary, loading, error } = useItsmResource<ReportData>(() => get('/dashboards/rca/summary'), [get])
    const { data: pipeline } = useItsmResource<ReportData>(() => get('/dashboards/rca/pipeline'), [get])
    const { data: recordings } = useItsmResource<ReportData>(() => get('/dashboards/recordings/summary'), [get])
    if (loading) return <Section title="RCA & Recording Compliance (last 30 days)"><LoadingSpinner /></Section>
    if (error) return <Section title="RCA & Recording Compliance (last 30 days)"><ErrorBanner message={error.message} /></Section>
    if (!summary) return null
    return (
        <Section title="RCA & Recording Compliance (last 30 days)">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="RCAs required" value={summary.required_count} />
                <StatCard label="Compliance" value={summary.compliance_pct != null ? `${summary.compliance_pct}%` : '—'} />
                <StatCard label="Overdue" value={summary.overdue_count} />
                <StatCard label="Action items overdue" value={summary.action_items_overdue_count} />
            </div>
            {pipeline?.pipeline && Object.keys(pipeline.pipeline).length > 0 && (
                <div className="pt-2">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">RCA pipeline by status</p>
                    <BreakdownBars data={pipeline.pipeline} />
                </div>
            )}
            {recordings && (
                <div className="grid grid-cols-2 gap-3 pt-2">
                    <StatCard label="Recordings linked" value={recordings.recordings} />
                    <StatCard label="Linked as RCA evidence" value={recordings.linked_to_rca} />
                </div>
            )}
        </Section>
    )
}

export function DateRangeFilter({ startDate, endDate, onChange }: DateRange & { onChange: (range: DateRange) => void }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                From
                <input type="date" value={startDate} onChange={e => onChange({ startDate: e.target.value, endDate })} className="input text-sm py-1.5 w-auto" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                To
                <input type="date" value={endDate} onChange={e => onChange({ startDate, endDate: e.target.value })} className="input text-sm py-1.5 w-auto" />
            </label>
            {(startDate || endDate) && (
                <button onClick={() => onChange({ startDate: '', endDate: '' })} className="btn-ghost text-xs">✕ Clear</button>
            )}
        </div>
    )
}

export function TicketSummarySection({ get, range }: ReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(
        () => get('/reports/tickets/summary', range),
        [get, range.startDate, range.endDate]
    )
    if (loading) return <Section title="Ticket Summary"><LoadingSpinner /></Section>
    if (error) return <Section title="Ticket Summary"><ErrorBanner message={error.message} /></Section>
    if (!data) return null
    return (
        <Section title="Ticket Summary">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total" value={data.total} />
                <StatCard label="Open" value={data.by_status?.open} />
                <StatCard label="In Progress" value={data.by_status?.in_progress} />
                <StatCard label="Resolved" value={data.by_status?.resolved} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-2">
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">By status</p>
                    <BreakdownBars data={data.by_status} total={data.total} />
                </div>
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">By priority</p>
                    <BreakdownBars data={data.by_priority} total={data.total} />
                </div>
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">By type</p>
                    <BreakdownBars data={data.by_type} total={data.total} />
                </div>
            </div>
        </Section>
    )
}

export function SlaComplianceSection({ get, range }: ReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(
        () => get('/reports/tickets/sla-compliance', range),
        [get, range.startDate, range.endDate]
    )
    if (loading) return <Section title="SLA Compliance"><LoadingSpinner /></Section>
    if (error) return <Section title="SLA Compliance"><ErrorBanner message={error.message} /></Section>
    if (!data) return null
    return (
        <Section title="SLA Compliance">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Compliance" value={`${data.compliance_pct?.toFixed?.(1) ?? data.compliance_pct}%`} />
                <StatCard label="Within SLA" value={data.within_sla} />
                <StatCard label="Breached" value={data.breached} />
                <StatCard label="Avg resolution (h)" value={data.avg_resolution_hours?.toFixed?.(1) ?? data.avg_resolution_hours} />
            </div>
            {Object.keys(data.by_priority || {}).length > 0 && (
                <div className="pt-2">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Breached by priority</p>
                    <BreakdownBars
                        data={Object.fromEntries(Object.entries(data.by_priority as ReportData).map(([k, v]) => [k, v.breached]))}
                        total={data.total_tickets}
                    />
                </div>
            )}
        </Section>
    )
}

export function VolumeTrendSection({ get, range }: ReportSectionProps) {
    const [granularity, setGranularity] = useState('day')
    const { data, loading, error } = useItsmResource<ReportData>(
        () => get('/reports/tickets/volume-trend', { ...range, granularity }),
        [get, range.startDate, range.endDate, granularity]
    )
    const points: ReportData[] = data?.points || []
    const max = Math.max(...points.map(p => p.count), 1)
    return (
        <Section title="Ticket Volume Trend">
            <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Granularity</span>
                <select value={granularity} onChange={e => setGranularity(e.target.value)} className="input text-sm py-1 w-auto">
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                </select>
            </div>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && (
                points.length === 0
                    ? <EmptyState>No ticket activity in this window.</EmptyState>
                    : (
                        <div className="flex items-end gap-1 h-32 pt-2 overflow-x-auto">
                            {points.map(p => (
                                <div key={p.date} className="flex flex-col items-center gap-1 shrink-0" title={`${p.date}: ${p.count}`}>
                                    <div className="w-5 bg-blue-500 dark:bg-blue-500/70 rounded-t" style={{ height: `${(p.count / max) * 96 + 2}px` }} />
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 [writing-mode:vertical-rl] rotate-180 h-12">{p.date?.slice(5)}</span>
                                </div>
                            ))}
                        </div>
                    )
            )}
        </Section>
    )
}

export function AssetSummarySection({ get }: SimpleReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(() => get('/reports/assets/summary'), [get])
    if (loading) return <Section title="Asset Summary"><LoadingSpinner /></Section>
    if (error) return <Section title="Asset Summary"><ErrorBanner message={error.message} /></Section>
    if (!data) return null
    return (
        <Section title="Asset Summary">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total" value={data.total} />
                <StatCard label="In Use" value={data.by_status?.in_use} />
                <StatCard label="In Stock" value={data.by_status?.in_stock} />
                <StatCard label="In Maintenance" value={data.by_status?.in_maintenance} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2">
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">By status</p>
                    <BreakdownBars data={data.by_status} total={data.total} />
                </div>
                <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">By type</p>
                    <BreakdownBars data={data.by_type} total={data.total} />
                </div>
            </div>
        </Section>
    )
}

export function TeamWorkloadSection({ get, range }: ReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(
        () => get('/reports/teams/workload', range),
        [get, range.startDate, range.endDate]
    )
    const teams: ReportData[] = data?.teams || []
    return (
        <Section title="Team Workload">
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && (
                teams.length === 0
                    ? <EmptyState>No team workload data for this window.</EmptyState>
                    : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide border-b border-slate-100 dark:border-slate-800">
                                    <th className="py-1.5 font-medium">Team</th>
                                    <th className="py-1.5 font-medium text-right">Open tickets</th>
                                    <th className="py-1.5 font-medium text-right">Avg age (h)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {teams.map(t => (
                                    <tr key={t.team_id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                                        <td className="py-1.5 text-slate-800 dark:text-slate-200">{t.team_name}</td>
                                        <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{t.open_tickets}</td>
                                        <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{t.avg_age_hours?.toFixed?.(1) ?? t.avg_age_hours}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
            )}
        </Section>
    )
}

export function KbTopArticlesSection({ get }: SimpleReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(() => get('/reports/kb/top-articles', { limit: 10 }), [get])
    const articles: ReportData[] = data?.articles || []
    return (
        <Section title="Top Knowledge Base Articles">
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && (
                articles.length === 0
                    ? <EmptyState>No article view data yet.</EmptyState>
                    : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide border-b border-slate-100 dark:border-slate-800">
                                    <th className="py-1.5 font-medium">Article</th>
                                    <th className="py-1.5 font-medium text-right">Views</th>
                                    <th className="py-1.5 font-medium text-right">Helpful %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {articles.map(a => (
                                    <tr key={a.id} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                                        <td className="py-1.5 text-slate-800 dark:text-slate-200 truncate max-w-xs">{a.title}</td>
                                        <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{a.view_count}</td>
                                        <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{a.helpful_pct?.toFixed?.(0) ?? a.helpful_pct}%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
            )}
        </Section>
    )
}

export function AiUsageSection({ get, range }: ReportSectionProps) {
    const { data, loading, error } = useItsmResource<ReportData>(
        () => get('/reports/ai/usage', range),
        [get, range.startDate, range.endDate]
    )
    if (loading) return <Section title="AI Usage"><LoadingSpinner /></Section>
    if (error) return <Section title="AI Usage"><ErrorBanner message={error.message} /></Section>
    if (!data) return null
    const features = Object.entries((data.by_feature || {}) as ReportData)
    return (
        <Section title="AI Usage">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Total tokens" value={data.total_tokens?.toLocaleString?.() ?? data.total_tokens} />
                <StatCard label="Total calls" value={data.total_calls} />
            </div>
            {features.length > 0 && (
                <table className="w-full text-sm pt-2">
                    <thead>
                        <tr className="text-left text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide border-b border-slate-100 dark:border-slate-800">
                            <th className="py-1.5 font-medium">Feature</th>
                            <th className="py-1.5 font-medium text-right">Calls</th>
                            <th className="py-1.5 font-medium text-right">Input tokens</th>
                            <th className="py-1.5 font-medium text-right">Output tokens</th>
                        </tr>
                    </thead>
                    <tbody>
                        {features.map(([feature, f]) => (
                            <tr key={feature} className="border-b border-slate-50 dark:border-slate-800/50 last:border-0">
                                <td className="py-1.5 text-slate-800 dark:text-slate-200 capitalize">{feature.replace(/_/g, ' ')}</td>
                                <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{f.total_calls}</td>
                                <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{f.total_input_tokens?.toLocaleString?.() ?? f.total_input_tokens}</td>
                                <td className="py-1.5 text-right text-slate-700 dark:text-slate-300">{f.total_output_tokens?.toLocaleString?.() ?? f.total_output_tokens}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </Section>
    )
}
