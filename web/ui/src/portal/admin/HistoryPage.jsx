import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

const STATUS_STYLE = {
    resolved:  'bg-green-100 text-green-700',
    abandoned: 'bg-gray-100 text-gray-500',
}

function fmtDuration(secs) {
    if (!secs) return '—'
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function fmtDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString([], {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    })
}

export default function HistoryPage() {
    const { call }  = useApi()
    const [items, setItems]   = useState([])
    const [total, setTotal]   = useState(0)
    const [pages, setPages]   = useState(1)
    const [page, setPage]     = useState(1)
    const [q, setQ]           = useState('')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError]   = useState(null)

    const fetchHistory = useCallback(async (pg = page, sq = search) => {
        setLoading(true)
        try {
            const qs = new URLSearchParams({ page: pg, limit: 20, ...(sq ? { q: sq } : {}) })
            const data = await call(`/portal/api/admin/history?${qs}`)
            setItems(data.items || [])
            setTotal(data.total || 0)
            setPages(data.pages || 1)
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, page, search])

    useEffect(() => { fetchHistory() }, [fetchHistory])

    const handleSearch = (e) => {
        e.preventDefault()
        const trimmed = q.trim()
        setSearch(trimmed)
        setPage(1)
        fetchHistory(1, trimmed)
    }

    const goPage = (p) => {
        setPage(p)
        fetchHistory(p, search)
    }

    return (
        <div className="max-w-5xl space-y-5">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900">History</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{total} completed sessions</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        placeholder="Search sender or org…"
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
                    />
                    <button type="submit" className="btn-primary text-xs px-4">Search</button>
                    {search && (
                        <button type="button" className="btn-ghost text-xs" onClick={() => {
                            setQ(''); setSearch(''); setPage(1); fetchHistory(1, '')
                        }}>Clear</button>
                    )}
                </form>
            </div>

            {error && (
                <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
            )}

            <div className="card overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                        <tr>
                            <th className="px-4 py-3 text-left">Session</th>
                            <th className="px-4 py-3 text-left">Status</th>
                            <th className="px-4 py-3 text-left">Operator</th>
                            <th className="px-4 py-3 text-right">Handle time</th>
                            <th className="px-4 py-3 text-left">Closed</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading && (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center">
                                    <div className="w-5 h-5 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                                </td>
                            </tr>
                        )}
                        {!loading && items.map(item => (
                            <tr key={item.queue_id} className="hover:bg-gray-50">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900 truncate max-w-[160px]">{item.sender_id}</div>
                                    <div className="text-xs text-gray-400 flex gap-1 flex-wrap mt-0.5">
                                        {item.app_id && <span>{item.app_id}</span>}
                                        {item.user_org_id && <><span>·</span><span>{item.user_org_id}</span></>}
                                        {item.channel === 'platform' && (
                                            <span className="badge bg-purple-100 text-purple-600 text-xs">platform</span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`badge ${STATUS_STYLE[item.status] || 'bg-gray-100 text-gray-500'}`}>
                                        {item.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-gray-600">{item.operator_name || '—'}</td>
                                <td className="px-4 py-3 text-right text-gray-500">
                                    {fmtDuration(item.handle_time_secs)}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-400">
                                    {fmtDate(item.resolved_at)}
                                </td>
                            </tr>
                        ))}
                        {!loading && items.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                                    No history found{search ? ` for "${search}"` : ''}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <button
                        disabled={page <= 1}
                        onClick={() => goPage(page - 1)}
                        className="btn-ghost text-xs disabled:opacity-40"
                    >
                        ← Prev
                    </button>
                    <span className="text-sm text-gray-500">Page {page} of {pages}</span>
                    <button
                        disabled={page >= pages}
                        onClick={() => goPage(page + 1)}
                        className="btn-ghost text-xs disabled:opacity-40"
                    >
                        Next →
                    </button>
                </div>
            )}
        </div>
    )
}
