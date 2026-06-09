import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

const STATUS_OPTS = ['', 'resolved', 'abandoned', 'assigned', 'waiting', 'bot']
const STATUS_STYLE = {
    resolved:  'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400',
    abandoned: 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400',
    assigned:  'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    waiting:   'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bot:       'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400',
}

function fmtDuration(secs) {
    if (!secs) return '—'
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Transcript modal ──────────────────────────────────────────────────────────
function TranscriptModal({ convId, onClose }) {
    const { call } = useApi()
    const [msgs, setMsgs]   = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        call(`/admin/sessions/history/${encodeURIComponent(convId)}/messages`)
            .then(d => setMsgs(d?.messages || d || []))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call, convId])

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700 shrink-0">
                    <div>
                        <h3 className="font-semibold text-gray-900 dark:text-slate-100">Transcript</h3>
                        <p className="text-xs text-gray-400 dark:text-slate-500 font-mono mt-0.5 truncate">{convId}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 hover:dark:text-slate-400 text-2xl leading-none">×</button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    {loading && (
                        <div className="flex justify-center py-8">
                            <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                    {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                    {!loading && msgs.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-4">No messages found</p>}
                    {msgs.map((m, i) => {
                        const isBot = m.sender !== 'user' && !m.is_user
                        return (
                            <div key={i} className={`flex ${isBot ? 'justify-start' : 'justify-end'}`}>
                                <div className={`max-w-xs rounded-xl px-3 py-2 text-sm ${
                                    isBot ? 'bg-gray-100 dark:bg-slate-800 text-gray-900 dark:text-slate-100' : 'bg-blue-600 text-white'
                                }`}>
                                    <p>{m.text || m.data?.text || JSON.stringify(m.data || {})}</p>
                                    {m.intent && (
                                        <p className={`text-xs mt-1 ${isBot ? 'text-gray-400 dark:text-slate-500' : 'text-blue-200'}`}>
                                            intent: {m.intent}
                                        </p>
                                    )}
                                    {m.timestamp && (
                                        <p className={`text-xs mt-0.5 ${isBot ? 'text-gray-400 dark:text-slate-500' : 'text-blue-200'}`}>
                                            {new Date(m.timestamp * 1000).toLocaleTimeString()}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function HistoryPage() {
    const { call } = useApi()
    const [items, setItems]     = useState([])
    const [total, setTotal]     = useState(0)
    const [pages, setPages]     = useState(1)
    const [page, setPage]       = useState(1)
    const [operators, setOperators] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState(null)
    const [transcript, setTranscript] = useState(null)

    // Filters
    const [q, setQ]             = useState('')
    const [search, setSearch]   = useState('')
    const [status, setStatus]   = useState('')
    const [operator, setOperator] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo]   = useState('')

    useEffect(() => {
        call('/portal/api/admin/operators')
            .then(d => setOperators(d?.operators || []))
            .catch(() => {})
    }, [call])

    const fetchHistory = useCallback(async (pg = 1) => {
        setLoading(true)
        setError(null)
        try {
            // Try the richer /admin/sessions/history endpoint first (has all filters)
            const qs = new URLSearchParams({ page: pg, limit: 20 })
            if (search)   qs.set('q', search)
            if (status)   qs.set('status', status)
            if (operator) qs.set('operator', operator)
            if (dateFrom) qs.set('from', dateFrom)
            if (dateTo)   qs.set('to', dateTo)

            let data
            try {
                data = await call(`/admin/sessions/history?${qs}`)
                // normalise: may return { sessions, total, pages } or { items, total, pages }
                data = {
                    items: data.sessions || data.items || data || [],
                    total: data.total || 0,
                    pages: data.pages || 1,
                }
            } catch {
                // fallback to portal API
                data = await call(`/portal/api/admin/history?${qs}`)
            }

            setItems(data.items || [])
            setTotal(data.total || 0)
            setPages(data.pages || 1)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, search, status, operator, dateFrom, dateTo])

    useEffect(() => { fetchHistory(page) }, [fetchHistory])

    const applyFilters = (e) => {
        e?.preventDefault()
        setSearch(q.trim())
        setPage(1)
    }

    const clearFilters = () => {
        setQ(''); setSearch(''); setStatus(''); setOperator(''); setDateFrom(''); setDateTo('')
        setPage(1)
    }

    const goPage = (p) => { setPage(p); fetchHistory(p) }

    const handleExport = () => {
        const qs = new URLSearchParams()
        if (search)   qs.set('q', search)
        if (status)   qs.set('status', status)
        if (operator) qs.set('operator', operator)
        if (dateFrom) qs.set('from', dateFrom)
        if (dateTo)   qs.set('to', dateTo)
        window.open(`/admin/sessions/history/export?${qs}`, '_blank')
    }

    const hasFilters = search || status || operator || dateFrom || dateTo

    return (
        <div className="max-w-5xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">History</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">{total} completed sessions</p>
                </div>
                <button onClick={handleExport} className="btn-ghost border border-gray-200 dark:border-slate-700 text-xs">
                    ↓ Export CSV
                </button>
            </div>

            {/* Filters */}
            <form onSubmit={applyFilters} className="card p-4 space-y-3">
                <div className="flex flex-wrap gap-3">
                    <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Search sender, org…"
                        className="flex-1 min-w-[160px] rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                    />
                    <select value={status} onChange={e => setStatus(e.target.value)}
                        className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 bg-white dark:bg-slate-900">
                        <option value="">All statuses</option>
                        {STATUS_OPTS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={operator} onChange={e => setOperator(e.target.value)}
                        className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 bg-white dark:bg-slate-900">
                        <option value="">All operators</option>
                        {operators.map(op => (
                            <option key={op.id} value={op.id}>{op.display_name}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-wrap gap-3 items-center">
                    <label className="text-xs text-gray-500 dark:text-slate-400">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    <label className="text-xs text-gray-500 dark:text-slate-400">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    <button type="submit" className="btn-primary text-xs px-4">Apply</button>
                    {hasFilters && (
                        <button type="button" onClick={clearFilters} className="btn-ghost text-xs">Clear</button>
                    )}
                </div>
            </form>

            {error && <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {/* Table */}
            <div className="card overflow-hidden overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-gray-50 dark:bg-slate-800/60 text-gray-500 dark:text-slate-400 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-4 py-3 text-left">User</th>
                            <th className="px-4 py-3 text-left">App</th>
                            <th className="px-4 py-3 text-left">Status</th>
                            <th className="px-4 py-3 text-left">Operator</th>
                            <th className="px-4 py-3 text-right">Msgs</th>
                            <th className="px-4 py-3 text-right">Duration</th>
                            <th className="px-4 py-3 text-left">Started</th>
                            <th className="px-4 py-3 text-center">View</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                        {loading && (
                            <tr><td colSpan={8} className="px-4 py-10 text-center">
                                <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                            </td></tr>
                        )}
                        {!loading && items.map((item, i) => (
                            <tr key={item.queue_id || item.conversation_id || i} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900 dark:text-slate-100 truncate max-w-[140px]">
                                        {item.sender_id || item.user_name || '—'}
                                    </div>
                                    {item.user_org_id && (
                                        <div className="text-xs text-gray-400 dark:text-slate-500 truncate">{item.user_org_id}</div>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    {item.app_id
                                        ? <span className="badge bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400">{item.app_id}</span>
                                        : <span className="text-gray-400 dark:text-slate-500">—</span>}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`badge ${STATUS_STYLE[item.status] || 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400'}`}>
                                        {item.status || '—'}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{item.operator_name || '—'}</td>
                                <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-400">{item.message_count ?? '—'}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">{fmtDuration(item.handle_time_secs)}</td>
                                <td className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500">{fmtDate(item.started_at || item.created_at)}</td>
                                <td className="px-4 py-3 text-center">
                                    <button
                                        onClick={() => setTranscript(item.queue_id || item.conversation_id || item.sender_id)}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:dark:text-blue-400 hover:underline"
                                    >
                                        View
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!loading && items.length === 0 && (
                            <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-slate-500">
                                No history found{hasFilters ? ' — try adjusting filters' : ''}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <button disabled={page <= 1} onClick={() => goPage(page - 1)}
                        className="btn-ghost text-xs disabled:opacity-40">← Prev</button>
                    <span className="text-sm text-gray-500 dark:text-slate-400">Page {page} of {pages}</span>
                    <button disabled={page >= pages} onClick={() => goPage(page + 1)}
                        className="btn-ghost text-xs disabled:opacity-40">Next →</button>
                </div>
            )}

            {/* Transcript modal */}
            {transcript && (
                <TranscriptModal convId={transcript} onClose={() => setTranscript(null)} />
            )}
        </div>
    )
}
