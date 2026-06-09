import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi } from '../useApi'

const REFRESH_MS = 15_000

const STATUS_DOT = {
    online:  'bg-green-500',
    busy:    'bg-amber-500',
    offline: 'bg-gray-400 dark:bg-slate-500',
}

function KpiCard({ label, value, sub, color = 'blue' }) {
    const colors = {
        blue:   'text-blue-600 dark:text-blue-400',
        green:  'text-green-600 dark:text-emerald-400',
        amber:  'text-amber-600 dark:text-amber-400',
        purple: 'text-purple-600 dark:text-purple-400',
    }
    return (
        <div className="card p-4">
            <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">{label}</p>
            <p className={`text-3xl font-bold mt-1 ${colors[color]}`}>{value ?? '—'}</p>
            {sub && <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">{sub}</p>}
        </div>
    )
}

function ForceHandoffModal({ session, onDone, onClose }) {
    const { call } = useApi()
    const [note, setNote] = useState('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const handleForce = async () => {
        setSaving(true)
        setError(null)
        try {
            await call('/admin/handoff/force', {
                method: 'POST',
                body: JSON.stringify({
                    conversation_id: session.conversation_id || session.sender_id,
                    note: note.trim() || undefined,
                }),
            })
            onDone()
        } catch (e) {
            setError(e.message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
                    <h3 className="font-semibold text-gray-900 dark:text-slate-100">Force handoff to operator</h3>
                    <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 hover:dark:text-slate-400 text-2xl leading-none">×</button>
                </div>
                <div className="p-5 space-y-3">
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                        This will immediately escalate <strong className="font-mono">{session.sender_id}</strong> to the operator queue.
                    </p>
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                    <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Optional note for the operator…"
                        rows={3}
                        className="form-input w-full resize-none"
                    />
                </div>
                <div className="flex justify-end gap-3 px-5 py-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 rounded-b-2xl">
                    <button onClick={onClose} className="btn-ghost">Cancel</button>
                    <button onClick={handleForce} disabled={saving} className="btn-primary bg-amber-600 hover:bg-amber-700">
                        {saving ? 'Escalating…' : 'Force handoff'}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default function LiveMonitorPage() {
    const { call } = useApi()
    const [data, setData]     = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError]   = useState(null)
    const [forceModal, setForceModal] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const timerRef = useRef(null)

    const fetchQueue = useCallback(async () => {
        try {
            const d = await call('/admin/monitor/queue')
            setData(d)
            setLastUpdated(new Date())
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call])

    useEffect(() => {
        fetchQueue()
        timerRef.current = setInterval(fetchQueue, REFRESH_MS)
        return () => clearInterval(timerRef.current)
    }, [fetchQueue])

    const handleForceDone = () => { setForceModal(null); fetchQueue() }

    const waiting   = data?.waiting_queue   || []
    const active    = data?.active_sessions  || []
    const operators = data?.operators        || []
    const kpis      = data?.kpis             || {}

    return (
        <div className="max-w-5xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Live Monitor</h2>
                    {lastUpdated && (
                        <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">Last updated {lastUpdated.toLocaleTimeString()} · auto-refreshes every 15 s</p>
                    )}
                </div>
                <button onClick={fetchQueue} disabled={loading}
                    className="btn-ghost border border-gray-200 dark:border-slate-700 text-xs disabled:opacity-50">
                    {loading ? '↻ Refreshing…' : '↻ Refresh now'}
                </button>
            </div>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <KpiCard label="Waiting"         value={kpis.waiting_count   ?? waiting.length}  color="amber"  />
                <KpiCard label="Active chats"    value={kpis.active_count    ?? active.length}   color="blue"   />
                <KpiCard label="Avg wait"        value={kpis.avg_wait_min != null ? `${kpis.avg_wait_min}m` : '—'} color="purple" sub="minutes" />
                <KpiCard label="Operators online" value={kpis.operators_online ?? operators.filter(o => o.status === 'online').length} color="green" />
            </div>

            {/* Waiting queue */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Waiting queue ({waiting.length})</h3>
                <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                            <tr>
                                <th className="px-4 py-3 text-left">User</th>
                                <th className="px-4 py-3 text-left">App</th>
                                <th className="px-4 py-3 text-left">Queue</th>
                                <th className="px-4 py-3 text-right">Waiting</th>
                                <th className="px-4 py-3 text-right">Priority</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {loading && !data && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center">
                                    <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                                </td></tr>
                            )}
                            {waiting.map((s, i) => (
                                <tr key={s.queue_id || i} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                    <td className="px-4 py-3 font-medium truncate max-w-[140px]">{s.sender_id || '—'}</td>
                                    <td className="px-4 py-3">
                                        {s.app_id
                                            ? <span className="badge bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">{s.app_id}</span>
                                            : <span className="text-gray-400 dark:text-slate-500">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{s.queue_name || '—'}</td>
                                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400 font-medium">
                                        {s.wait_minutes != null ? `${s.wait_minutes}m` : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        {s.priority > 0
                                            ? <span className="badge bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">+{s.priority}</span>
                                            : <span className="text-gray-400 dark:text-slate-500">0</span>}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => setForceModal(s)}
                                            className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 hover:dark:text-amber-400 hover:underline">
                                            Force assign
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {!loading && waiting.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No sessions waiting</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Active conversations */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Active conversations ({active.length})</h3>
                <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                            <tr>
                                <th className="px-4 py-3 text-left">User</th>
                                <th className="px-4 py-3 text-left">App</th>
                                <th className="px-4 py-3 text-left">Operator</th>
                                <th className="px-4 py-3 text-right">Duration</th>
                                <th className="px-4 py-3 text-right">Msgs</th>
                                <th className="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                            {active.map((s, i) => (
                                <tr key={s.conversation_id || i} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                    <td className="px-4 py-3 font-medium truncate max-w-[140px]">{s.sender_id || '—'}</td>
                                    <td className="px-4 py-3">
                                        {s.app_id
                                            ? <span className="badge bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">{s.app_id}</span>
                                            : <span className="text-gray-400 dark:text-slate-500">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{s.operator_name || '—'}</td>
                                    <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">
                                        {s.duration_minutes != null ? `${s.duration_minutes}m` : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-400">{s.message_count ?? '—'}</td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => setForceModal(s)}
                                            className="text-xs text-red-500 hover:text-red-700 hover:dark:text-red-400 hover:underline">
                                            Reassign
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {!loading && active.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">No active operator conversations</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Operator grid */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Operator status ({operators.length})</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {operators.map((op, i) => (
                        <div key={op.id || i} className="card p-3 flex items-center gap-3">
                            <div className="relative shrink-0">
                                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold">
                                    {(op.display_name || op.name || '?').charAt(0).toUpperCase()}
                                </div>
                                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-white ${STATUS_DOT[op.status] || STATUS_DOT.offline}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{op.display_name || op.name}</p>
                                <p className="text-xs text-gray-400 dark:text-slate-500 capitalize">{op.status || 'offline'}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{op.active_count ?? 0}</p>
                                <p className="text-xs text-gray-400 dark:text-slate-500">active</p>
                            </div>
                        </div>
                    ))}
                    {operators.length === 0 && (
                        <div className="card p-6 col-span-3 text-center text-gray-400 dark:text-slate-500 text-sm">No operator data</div>
                    )}
                </div>
            </div>

            {forceModal && (
                <ForceHandoffModal
                    session={forceModal}
                    onDone={handleForceDone}
                    onClose={() => setForceModal(null)}
                />
            )}
        </div>
    )
}
