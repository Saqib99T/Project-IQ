import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

const DAYS_OPTIONS = [7, 14, 30, 90]

// ── Mini bar chart (CSS-only, no library) ─────────────────────────────────────
function BarChart({ label, rows, valueKey, color = 'bg-blue-500' }) {
    if (!rows?.length) return null
    const max = Math.max(...rows.map(r => r[valueKey] || 0), 1)
    return (
        <div className="card p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">{label}</p>
            <div className="flex items-end gap-1 h-28">
                {rows.map(r => {
                    const pct = Math.round(((r[valueKey] || 0) / max) * 100)
                    return (
                        <div key={r.day} className="flex-1 flex flex-col items-center gap-1 group">
                            <span className="text-xs text-gray-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
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
            <div className="flex justify-between text-xs text-gray-400 dark:text-slate-500 px-0.5">
                <span>{rows[0]?.day?.slice(5)}</span>
                <span>{rows[rows.length - 1]?.day?.slice(5)}</span>
            </div>
        </div>
    )
}

// ── Horizontal bar chart for intents ─────────────────────────────────────────
function IntentsChart({ intents }) {
    if (!intents?.length) return <p className="text-sm text-gray-400 dark:text-slate-500 py-4 text-center">No intent data</p>
    const max = Math.max(...intents.map(i => i[1] || i.count || 0), 1)
    return (
        <div className="space-y-2">
            {intents.slice(0, 8).map((item, idx) => {
                const name  = item[0] ?? item.intent ?? item.name ?? `intent_${idx}`
                const count = item[1] ?? item.count ?? 0
                const pct   = Math.round((count / max) * 100)
                return (
                    <div key={name} className="flex items-center gap-3">
                        <span className="text-xs text-gray-600 dark:text-slate-400 w-40 truncate text-right shrink-0" title={name}>{name}</span>
                        <div className="flex-1 bg-gray-100 dark:bg-slate-800 rounded-full h-5 overflow-hidden">
                            <div
                                className="h-5 rounded-full bg-indigo-500 flex items-center justify-end pr-1.5 transition-all"
                                style={{ width: `${Math.max(pct, 4)}%` }}
                            >
                                <span className="text-xs text-white font-medium">{count}</span>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ── Feedback donut (CSS-only) ─────────────────────────────────────────────────
function FeedbackDonut({ positive = 0, negative = 0 }) {
    const total = positive + negative
    if (total === 0) return <p className="text-sm text-gray-400 dark:text-slate-500 py-4 text-center">No feedback data</p>
    const posPct = Math.round((positive / total) * 100)
    const negPct = 100 - posPct
    // SVG circle trick
    const r = 40, cx = 50, cy = 50
    const circ = 2 * Math.PI * r
    const posArc = (posPct / 100) * circ
    return (
        <div className="flex items-center gap-6">
            <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0 -rotate-90">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#fee2e2" strokeWidth="14" />
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#10b981" strokeWidth="14"
                    strokeDasharray={`${posArc} ${circ - posArc}`}
                    strokeLinecap="round" />
            </svg>
            <div className="space-y-2">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-slate-300">Positive</span>
                    <span className="font-semibold text-gray-900 dark:text-slate-100 ml-auto pl-4">{positive} ({posPct}%)</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-300 shrink-0" />
                    <span className="text-sm text-gray-700 dark:text-slate-300">Negative</span>
                    <span className="font-semibold text-gray-900 dark:text-slate-100 ml-auto pl-4">{negative} ({negPct}%)</span>
                </div>
                <p className="text-xs text-gray-400 dark:text-slate-500 pt-1">Total: {total} ratings</p>
            </div>
        </div>
    )
}

function StatRow({ label, value, sub }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-800 last:border-0">
            <span className="text-sm text-gray-600 dark:text-slate-400">{label}</span>
            <div className="text-right">
                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{value ?? '—'}</span>
                {sub && <span className="text-xs text-gray-400 dark:text-slate-500 ml-1">{sub}</span>}
            </div>
        </div>
    )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
    const { call } = useApi()

    // Filters
    const [days, setDays]     = useState(7)
    const [appId, setAppId]   = useState('all')
    const [apps, setApps]     = useState([])

    // Data
    const [trend, setTrend]         = useState(null)   // /portal/api/admin/analytics (per-day)
    const [summary, setSummary]     = useState(null)   // /admin/analytics/summary
    const [intents, setIntents]     = useState(null)   // /admin/analytics/intents
    const [feedback, setFeedback]   = useState(null)   // /admin/analytics/feedback
    const [convos, setConvos]       = useState([])     // /admin/analytics/conversations

    const [loading, setLoading]   = useState(true)
    const [error, setError]       = useState(null)

    // Load app list once
    useEffect(() => {
        call('/admin/analytics/apps')
            .then(d => setApps(d?.apps || []))
            .catch(() => {})
    }, [call])

    const appParam = appId && appId !== 'all' ? `?app_id=${appId}` : ''

    const loadAll = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const [trendData, summaryData, intentsData, feedbackData, convosData] = await Promise.allSettled([
                call(`/portal/api/admin/analytics?days=${days}`),
                call(`/admin/analytics/summary${appParam}`),
                call(`/admin/analytics/intents${appParam}`),
                call(`/admin/analytics/feedback${appParam}`),
                call(`/admin/analytics/conversations${appParam}`),
            ])
            if (trendData.status   === 'fulfilled') setTrend(trendData.value)
            if (summaryData.status === 'fulfilled') setSummary(summaryData.value?.data ?? summaryData.value)
            if (intentsData.status === 'fulfilled') setIntents(intentsData.value?.data ?? intentsData.value)
            if (feedbackData.status === 'fulfilled') setFeedback(feedbackData.value?.data ?? feedbackData.value)
            if (convosData.status  === 'fulfilled') setConvos((convosData.value?.data ?? convosData.value) || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, days, appParam])

    useEffect(() => { loadAll() }, [loadAll])

    // Aggregate trend totals
    const totals = trend?.handoffs?.reduce((acc, r) => ({
        handoffs:    (acc.handoffs    || 0) + (r.handoffs    || 0),
        resolved:    (acc.resolved    || 0) + (r.resolved    || 0),
        abandoned:   (acc.abandoned   || 0) + (r.abandoned   || 0),
        handle_secs: (acc.handle_secs || 0) + (r.avg_handle_secs || 0),
        rows:        (acc.rows        || 0) + 1,
    }), {})
    const avgHandleMins   = totals?.rows ? Math.round((totals.handle_secs / totals.rows) / 60) : null
    const resolutionRate  = totals?.handoffs ? Math.round((totals.resolved / totals.handoffs) * 100) : null

    return (
        <div className="max-w-5xl space-y-6">

            {/* ── Header + filters ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Analytics</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Platform usage over time</p>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                    {/* App filter */}
                    <select
                        value={appId}
                        onChange={e => setAppId(e.target.value)}
                        className="border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs text-gray-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 bg-white dark:bg-slate-900"
                    >
                        <option value="all">All Apps</option>
                        {apps.map(a => {
                            const id   = a.app_id || a
                            const name = a.name   || a
                            return <option key={id} value={id}>{name}</option>
                        })}
                        {apps.length === 0 && (
                            <>
                                <option value="IT">IT Support</option>
                                <option value="Accounting">Accounting</option>
                                <option value="HR">Human Resources</option>
                                <option value="General">General</option>
                            </>
                        )}
                    </select>

                    {/* Day range — only affects trend charts */}
                    {DAYS_OPTIONS.map(d => (
                        <button
                            key={d}
                            onClick={() => setDays(d)}
                            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                                days === d
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 hover:dark:bg-slate-800/60'
                            }`}
                        >
                            {d}d
                        </button>
                    ))}

                    <button onClick={loadAll} className="btn-ghost border border-gray-200 dark:border-slate-700 text-xs">↻</button>
                </div>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {loading && (
                <div className="flex justify-center py-16">
                    <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {!loading && (
                <>
                    {/* ── Summary stats (from /analytics/summary) ── */}
                    {summary && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            {[
                                { label: 'Conversations', value: summary.total_conversations, color: 'blue' },
                                { label: 'Messages',      value: summary.total_messages,      color: 'blue' },
                                { label: '👍 Positive',   value: summary.feedback_positive,   color: 'green' },
                                { label: 'Resolution rate', value: summary.resolution_rate != null ? `${summary.resolution_rate}%` : null, color: 'amber' },
                            ].map(({ label, value, color }) => {
                                const colors = {
                                    blue:  'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
                                    green: 'bg-green-50 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400 border-green-200 dark:border-emerald-500/20',
                                    amber: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
                                }
                                return (
                                    <div key={label} className={`card p-5 border ${colors[color]}`}>
                                        <p className="text-sm font-medium opacity-75">{label}</p>
                                        <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* ── Handoff trend summary (from /portal/api/admin/analytics) ── */}
                    {trend && (
                        <div className="card p-5 space-y-1">
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">Handoff summary — last {days} days</p>
                            <StatRow label="Total handoffs"      value={totals?.handoffs} />
                            <StatRow label="Resolved"            value={totals?.resolved}
                                     sub={resolutionRate != null ? `(${resolutionRate}%)` : ''} />
                            <StatRow label="Abandoned"           value={totals?.abandoned} />
                            <StatRow label="Avg handle time"     value={avgHandleMins != null ? `${avgHandleMins} min` : null} />
                            <StatRow label="Total conversations" value={trend.conversations?.reduce((a, r) => a + (r.conversations || 0), 0)} />
                            <StatRow label="Total messages"      value={trend.messages?.reduce((a, r) => a + (r.messages || 0), 0)} />
                        </div>
                    )}

                    {/* ── Intents + Feedback side by side ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="card p-5">
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Top intents</p>
                            <IntentsChart intents={intents?.top_intents || intents} />
                        </div>
                        <div className="card p-5">
                            <p className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">User feedback</p>
                            <FeedbackDonut
                                positive={feedback?.positive ?? 0}
                                negative={feedback?.negative ?? 0}
                            />
                        </div>
                    </div>

                    {/* ── Per-day trend charts ── */}
                    {trend && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <BarChart label="Handoffs per day"      rows={trend.handoffs}      valueKey="handoffs"      color="bg-blue-500" />
                            <BarChart label="Resolved per day"      rows={trend.handoffs}      valueKey="resolved"      color="bg-green-500" />
                            <BarChart label="Conversations per day" rows={trend.conversations} valueKey="conversations" color="bg-purple-500" />
                            <BarChart label="Messages per day"      rows={trend.messages}      valueKey="messages"      color="bg-amber-500" />
                        </div>
                    )}

                    {/* ── Recent conversations table ── */}
                    {convos.length > 0 && (
                        <div className="card overflow-hidden">
                            <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                                <h3 className="font-semibold text-gray-800 dark:text-slate-200">Recent conversations</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                                        <tr>
                                            <th className="px-5 py-3 text-left">User</th>
                                            <th className="px-5 py-3 text-left">App</th>
                                            <th className="px-5 py-3 text-right">Messages</th>
                                            <th className="px-5 py-3 text-left">Intents</th>
                                            <th className="px-5 py-3 text-center">Feedback</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                        {convos.slice(0, 10).map((c, i) => (
                                            <tr key={i} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                                <td className="px-5 py-3 font-mono text-xs text-gray-700 dark:text-slate-300 max-w-xs truncate">
                                                    {c.sender_id || 'Unknown'}
                                                </td>
                                                <td className="px-5 py-3">
                                                    <span className="badge bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">{c.app_id || 'General'}</span>
                                                </td>
                                                <td className="px-5 py-3 text-right text-gray-700 dark:text-slate-300">{c.message_count || 0}</td>
                                                <td className="px-5 py-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {(c.intents || []).slice(0, 2).map(intent => (
                                                            <span key={intent} className="badge bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 text-xs">{intent}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3 text-center text-base">
                                                    {c.feedback === 'positive' ? '👍' : c.feedback === 'negative' ? '👎' : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
