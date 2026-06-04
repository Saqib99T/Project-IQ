import { useState, useEffect } from 'react'
import { useApi } from '../useApi'

const DAYS_OPTIONS = [7, 14, 30, 90]

function BarChart({ label, rows, valueKey, color = 'bg-blue-500' }) {
    if (!rows?.length) return null
    const max = Math.max(...rows.map(r => r[valueKey] || 0), 1)
    return (
        <div className="card p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700">{label}</p>
            <div className="flex items-end gap-1 h-28">
                {rows.map(r => {
                    const pct = Math.round(((r[valueKey] || 0) / max) * 100)
                    return (
                        <div key={r.day} className="flex-1 flex flex-col items-center gap-1 group">
                            <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                {r[valueKey] || 0}
                            </span>
                            <div
                                className={`w-full rounded-t ${color} transition-all`}
                                style={{ height: `${Math.max(pct, 2)}%` }}
                                title={`${r.day}: ${r[valueKey] || 0}`}
                            />
                        </div>
                    )
                })}
            </div>
            <div className="flex justify-between text-xs text-gray-400 px-0.5">
                <span>{rows[0]?.day?.slice(5)}</span>
                <span>{rows[rows.length - 1]?.day?.slice(5)}</span>
            </div>
        </div>
    )
}

function StatRow({ label, value, sub }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <span className="text-sm text-gray-600">{label}</span>
            <div className="text-right">
                <span className="text-sm font-semibold text-gray-900">{value ?? '—'}</span>
                {sub && <span className="text-xs text-gray-400 ml-1">{sub}</span>}
            </div>
        </div>
    )
}

export default function AnalyticsPage() {
    const { call }   = useApi()
    const [days, setDays] = useState(7)
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState(null)

    useEffect(() => {
        setLoading(true)
        call(`/portal/api/admin/analytics?days=${days}`)
            .then(d => { setData(d); setError(null) })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call, days])

    // Aggregate totals from handoff rows
    const totals = data?.handoffs?.reduce((acc, r) => ({
        handoffs:     (acc.handoffs     || 0) + (r.handoffs || 0),
        resolved:     (acc.resolved     || 0) + (r.resolved || 0),
        abandoned:    (acc.abandoned    || 0) + (r.abandoned || 0),
        handle_secs:  (acc.handle_secs  || 0) + (r.avg_handle_secs || 0),
        rows:         (acc.rows         || 0) + 1,
    }), {})

    const avgHandleMins = totals?.rows
        ? Math.round((totals.handle_secs / totals.rows) / 60)
        : null

    const resolutionRate = totals?.handoffs
        ? Math.round((totals.resolved / totals.handoffs) * 100)
        : null

    return (
        <div className="max-w-4xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">Analytics</h2>
                    <p className="text-sm text-gray-500 mt-0.5">Platform usage over time</p>
                </div>
                <div className="flex gap-1">
                    {DAYS_OPTIONS.map(d => (
                        <button
                            key={d}
                            onClick={() => setDays(d)}
                            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                                days === d
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {d}d
                        </button>
                    ))}
                </div>
            </div>

            {loading && (
                <div className="flex justify-center py-16">
                    <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
            )}

            {data && !loading && (
                <>
                    {/* Summary row */}
                    <div className="card p-5 space-y-1">
                        <p className="text-sm font-semibold text-gray-700 mb-3">Summary — last {days} days</p>
                        <StatRow label="Total handoffs"    value={totals?.handoffs} />
                        <StatRow label="Resolved"          value={totals?.resolved}
                                 sub={resolutionRate != null ? `(${resolutionRate}%)` : ''} />
                        <StatRow label="Abandoned"         value={totals?.abandoned} />
                        <StatRow label="Avg handle time"   value={avgHandleMins != null ? `${avgHandleMins} min` : null} />
                        <StatRow label="Total conversations" value={data.conversations?.reduce((a,r) => a + (r.conversations||0), 0)} />
                        <StatRow label="Total messages"    value={data.messages?.reduce((a,r) => a + (r.messages||0), 0)} />
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <BarChart label="Handoffs per day"      rows={data.handoffs}      valueKey="handoffs"      color="bg-blue-500" />
                        <BarChart label="Resolved per day"      rows={data.handoffs}      valueKey="resolved"      color="bg-green-500" />
                        <BarChart label="Conversations per day" rows={data.conversations} valueKey="conversations" color="bg-purple-500" />
                        <BarChart label="Messages per day"      rows={data.messages}      valueKey="messages"      color="bg-amber-500" />
                    </div>
                </>
            )}
        </div>
    )
}
