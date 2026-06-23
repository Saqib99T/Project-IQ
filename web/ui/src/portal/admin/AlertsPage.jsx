import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

// Admin alert inbox — browses the notifications the platform already persists
// (system errors, handoff + ticket events) via GET /notifications. Lets an admin
// filter by type, search, and mark read. Backend already stores + lists these.

const TYPE_META = {
    system_error:    { label: 'System error', icon: '🚨', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' },
    handoff_queued:  { label: 'Handoff queued', icon: '📥', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' },
    handoff_assigned:{ label: 'Handoff assigned', icon: '🎧', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400' },
    handoff_ended:   { label: 'Handoff ended', icon: '✅', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300' },
    ticket_created:  { label: 'Ticket created', icon: '🎫', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
    ticket_update:   { label: 'Ticket update', icon: '✏️', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' },
}
const meta = (t) => TYPE_META[t] || { label: t || 'Notice', icon: '🔔', cls: 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300' }

const FILTERS = [
    { key: 'all',          label: 'All' },
    { key: 'system_error', label: '🚨 Errors' },
    { key: 'handoff',      label: 'Handoff' },
    { key: 'ticket',       label: 'Tickets' },
]

export default function AlertsPage() {
    const { call } = useApi()
    const [items, setItems]     = useState([])
    const [unread, setUnread]   = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState(null)
    const [filter, setFilter]   = useState('all')
    const [search, setSearch]   = useState('')

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const d = await call('/notifications')
            setItems(d.data || [])
            setUnread(d.unread_count || 0)
            setError(null)
        } catch (e) { setError(e.message) }
        finally { setLoading(false) }
    }, [call])

    useEffect(() => { load() }, [load])

    const markRead = async (id) => {
        try {
            await call(`/notifications/${id}/read`, { method: 'POST' })
            setItems(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
            setUnread(u => Math.max(0, u - 1))
        } catch { /* non-fatal */ }
    }
    const markAllRead = async () => {
        try {
            await call('/notifications/read-all', { method: 'POST' })
            setItems(prev => prev.map(n => ({ ...n, read: true })))
            setUnread(0)
        } catch { /* non-fatal */ }
    }

    const shown = items.filter(n => {
        const t = n.type || ''
        const passType = filter === 'all'
            || (filter === 'handoff' ? t.startsWith('handoff')
              : filter === 'ticket'  ? t.startsWith('ticket')
              : t === filter)
        const q = search.trim().toLowerCase()
        const passSearch = !q || `${n.title || ''} ${n.body || ''}`.toLowerCase().includes(q)
        return passType && passSearch
    })

    return (
        <div className="max-w-4xl space-y-4">
            <div className="flex items-center gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Alerts</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                        System errors, handoff and ticket notifications {unread > 0 && <span className="text-red-600 dark:text-red-400 font-medium">· {unread} unread</span>}
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button onClick={markAllRead} className="btn-ghost border border-gray-200 dark:border-slate-700 text-sm px-3 py-1.5">Mark all read</button>
                    <button onClick={load} className="btn-ghost border border-gray-200 dark:border-slate-700 text-sm px-3 py-1.5">↻ Refresh</button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map(f => (
                    <button key={f.key} onClick={() => setFilter(f.key)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            filter === f.key
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-300'
                        }`}>{f.label}</button>
                ))}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search alerts…"
                    className="flex-1 min-w-[160px] px-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {error && <div className="card p-3 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            <div className="card divide-y divide-gray-100 dark:divide-slate-800">
                {loading && <div className="p-8 flex justify-center"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>}
                {!loading && shown.length === 0 && <div className="p-8 text-center text-sm text-gray-400 dark:text-slate-500">No alerts.</div>}
                {!loading && shown.map(n => {
                    const m = meta(n.type)
                    return (
                        <div key={n.id} onClick={() => !n.read && markRead(n.id)}
                            className={`flex gap-3 p-3 ${!n.read ? 'bg-blue-50/40 dark:bg-blue-500/5 cursor-pointer' : ''}`}>
                            <span className="text-lg leading-none mt-0.5">{m.icon}</span>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${m.cls}`}>{m.label}</span>
                                    {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                                    <span className="ml-auto text-[11px] text-gray-400 dark:text-slate-500 shrink-0">
                                        {n.created_at ? new Date(n.created_at).toLocaleString() : ''}
                                    </span>
                                </div>
                                <p className="text-sm font-medium text-gray-800 dark:text-slate-200 mt-1">{n.title}</p>
                                {n.body && <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 break-words">{n.body}</p>}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
