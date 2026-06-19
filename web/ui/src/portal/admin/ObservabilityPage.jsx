import { useState, useEffect, useRef } from 'react'
import { useApi } from '../useApi'

const SERVICES = [
    { key: 'rasa',     label: 'Project IQ Core', icon: '🤖' },
    { key: 'actions',  label: 'Action Server',   icon: '⚙️' },
    { key: 'database', label: 'Database',        icon: '🗄️' },
]

const GB = 1024 ** 3
const fmtGB = (bytes) => (bytes != null ? (bytes / GB).toFixed(1) : '—')

function ServiceCard({ label, icon, healthy, proc }) {
    return (
        <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
                    <p className={`text-lg font-semibold mt-0.5 ${healthy === true ? 'text-green-600 dark:text-emerald-400' : healthy === false ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-slate-500'}`}>
                        {healthy === true ? 'Online' : healthy === false ? 'Offline' : 'Checking…'}
                    </p>
                </div>
                <div className={`w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0 ${healthy === true ? 'bg-green-50 dark:bg-emerald-500/10' : healthy === false ? 'bg-red-50 dark:bg-red-500/10' : 'bg-gray-100 dark:bg-slate-800'}`}>
                    {icon}
                </div>
            </div>
            {proc && (
                <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">CPU</span><span className="font-medium text-gray-700 dark:text-slate-300">{proc.cpu != null ? `${proc.cpu}%` : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">Memory</span><span className="font-medium text-gray-700 dark:text-slate-300">{proc.memory != null ? `${proc.memory}%` : '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500 dark:text-slate-400">PID</span><span className="font-medium text-gray-700 dark:text-slate-300">{proc.pid ?? '—'}</span></div>
                </div>
            )}
        </div>
    )
}

function GaugeCard({ label, icon, value, sub, gradient }) {
    const pct = value != null ? Math.min(100, Math.max(0, value)) : 0
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500 dark:text-slate-400">{label}</h3>
                <span className="text-xl">{icon}</span>
            </div>
            <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-gray-800 dark:text-slate-200">{value ?? '—'}</span>
                <span className="text-gray-500 dark:text-slate-400 mb-1">%</span>
            </div>
            <div className="mt-3 h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            {sub && <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">{sub}</p>}
        </div>
    )
}

function StatCard({ label, value, unit, icon, gradient, barPct }) {
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-500 dark:text-slate-400">{label}</h3>
                {icon && <span className="text-xl">{icon}</span>}
            </div>
            <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-gray-800 dark:text-slate-200">{value ?? '—'}</span>
                {unit && <span className="text-gray-500 dark:text-slate-400 mb-1">{unit}</span>}
            </div>
            {barPct != null && (
                <div className="mt-3 h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all`} style={{ width: `${Math.min(100, barPct)}%` }} />
                </div>
            )}
        </div>
    )
}

export default function ObservabilityPage() {
    const { call } = useApi()
    const [health, setHealth]     = useState({})
    const [metrics, setMetrics]   = useState(null)
    const [dbStats, setDbStats]   = useState(null)
    const [loading, setLoading]   = useState(true)
    const [error, setError]       = useState(null)
    const [updatedAt, setUpdatedAt] = useState(null)
    const pollRef = useRef(null)

    const refresh = async () => {
        try {
            const [metricsRes, dbRes, ...healthRes] = await Promise.allSettled([
                call('/admin/observability/metrics'),
                call('/admin/observability/database/stats'),
                ...SERVICES.map(s => call(`/admin/health/${s.key}`)),
            ])
            if (metricsRes.status === 'fulfilled') setMetrics(metricsRes.value?.data || null)
            if (dbRes.status === 'fulfilled') setDbStats(dbRes.value?.data || null)
            const hMap = {}
            SERVICES.forEach((s, i) => {
                const r = healthRes[i]
                hMap[s.key] = r?.status === 'fulfilled' ? r.value : { healthy: false, status: 'error' }
            })
            setHealth(hMap)
            setUpdatedAt(new Date())
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        refresh()
        pollRef.current = setInterval(refresh, 10000)
        return () => clearInterval(pollRef.current)
    }, [call])

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    const services = metrics?.services || {}

    return (
        <div className="max-w-6xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Observability</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Service health and system metrics</p>
                </div>
                <div className="flex items-center gap-3">
                    {updatedAt && <span className="text-xs text-gray-400 dark:text-slate-500">Updated {updatedAt.toLocaleTimeString()}</span>}
                    <button onClick={refresh} className="btn-ghost border border-gray-200 dark:border-slate-700 text-sm">↻ Refresh</button>
                </div>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {/* Service health */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {SERVICES.map(s => (
                    <ServiceCard key={s.key} label={s.label} icon={s.icon}
                        healthy={health[s.key]?.healthy}
                        proc={services[s.key]} />
                ))}
            </div>

            {/* System gauges */}
            {metrics && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <GaugeCard label="CPU usage"    icon="💻" value={metrics.cpu_percent}
                        sub={`${metrics.cpu_count ?? '—'} cores`}
                        gradient="from-cyan-500 to-blue-500" />
                    <GaugeCard label="Memory usage" icon="🧠" value={metrics.memory_percent}
                        sub={`${fmtGB(metrics.memory_used)} / ${fmtGB(metrics.memory_total)} GB`}
                        gradient="from-purple-500 to-pink-500" />
                    <GaugeCard label="Disk usage"   icon="💾" value={metrics.disk_percent}
                        sub={`${fmtGB(metrics.disk_used)} / ${fmtGB(metrics.disk_total)} GB`}
                        gradient="from-amber-500 to-orange-500" />
                </div>
            )}

            {/* Performance stats */}
            {metrics && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard label="Response time" icon="⚡" value={metrics.avg_response_time} unit="ms avg"
                        gradient="from-green-500 to-emerald-500" barPct={metrics.avg_response_time != null ? Math.min(100, metrics.avg_response_time / 20) : null} />
                    <StatCard label="Throughput" icon="📈" value={metrics.throughput} unit="msg/min"
                        gradient="from-blue-500 to-indigo-500" barPct={metrics.throughput != null ? Math.min(100, metrics.throughput * 10) : null} />
                    <StatCard label="Error rate" icon="⚠️" value={metrics.error_rate} unit="%"
                        gradient="from-red-500 to-orange-500" barPct={metrics.error_rate} />
                </div>
            )}

            {/* DB stats & activity */}
            {dbStats && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="card p-5">
                        <h3 className="font-semibold text-gray-800 dark:text-slate-200 mb-4 flex items-center gap-2"><span>📊</span> Database statistics</h3>
                        <div className="space-y-2">
                            {Object.entries(dbStats.tables || {}).map(([k, v]) => (
                                <div key={k} className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-slate-800 last:border-0">
                                    <span className="text-sm text-gray-600 dark:text-slate-400 capitalize">{k.replace(/_/g, ' ')}</span>
                                    <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{v.toLocaleString?.() ?? v}</span>
                                </div>
                            ))}
                            {dbStats.performance?.avg_response_ms != null && (
                                <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-slate-800 last:border-0">
                                    <span className="text-sm text-gray-600 dark:text-slate-400">Avg response (24h)</span>
                                    <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{dbStats.performance.avg_response_ms} ms</span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="card p-5">
                        <h3 className="font-semibold text-gray-800 dark:text-slate-200 mb-4 flex items-center gap-2"><span>📈</span> Recent activity</h3>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-slate-800">
                                <span className="text-sm text-gray-600 dark:text-slate-400">Messages (last hour)</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{dbStats.activity?.messages_last_hour ?? '—'}</span>
                            </div>
                            <div className="flex justify-between items-center py-2">
                                <span className="text-sm text-gray-600 dark:text-slate-400">Conversations today</span>
                                <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{dbStats.activity?.conversations_today ?? '—'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
