import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { StatusBadge, PriorityBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'

export default function AssetLinkedTicketsSection({ assetId }) {
    const { get, post, remove } = useItsmApi()
    const [showPicker, setShowPicker] = useState(false)
    const [search, setSearch] = useState('')
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data: linked, loading, reload } = useItsmResource(() => get(`/assets/${assetId}/tickets`), [get, assetId])
    const linkedTickets = linked || []
    const linkedIds = useMemo(() => new Set(linkedTickets.map(t => t.id)), [linkedTickets])

    const { data: allTickets, loading: loadingAll } = useItsmResource(
        () => (showPicker ? get('/tickets', { limit: 50 }) : Promise.resolve(null)),
        [get, showPicker]
    )
    const candidates = (allTickets?.items || allTickets?.tickets || []).filter(t =>
        !linkedIds.has(t.id) && (
            search.trim() === '' ||
            t.title?.toLowerCase().includes(search.toLowerCase()) ||
            t.ticket_number?.toLowerCase().includes(search.toLowerCase())
        )
    )

    const link = async (ticket) => {
        setBusyId(ticket.id); setError(null)
        try { await post(`/assets/${assetId}/tickets`, { ticket_id: ticket.id }); setSearch(''); reload() }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }
    const unlink = async (ticket) => {
        setBusyId(ticket.id); setError(null)
        try { await remove(`/assets/${assetId}/tickets/${ticket.id}`); reload() }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Linked tickets</h3>
                <button onClick={() => setShowPicker(s => !s)} className="btn-ghost text-xs py-1.5">
                    {showPicker ? 'Close' : '+ Link ticket'}
                </button>
            </div>

            {error && <ErrorBanner message={error.message} />}

            {showPicker && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <input className="input text-sm" placeholder="Search tickets by title or number…" value={search} onChange={e => setSearch(e.target.value)} />
                    {loadingAll && <LoadingSpinner />}
                    {!loadingAll && candidates.length === 0 && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">No matching unlinked tickets.</p>
                    )}
                    <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {candidates.map(ticket => (
                            <li key={ticket.id} className="flex items-center justify-between py-1.5 text-sm">
                                <div className="min-w-0">
                                    <p className="text-slate-800 dark:text-slate-200 truncate">{ticket.title}</p>
                                    <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{ticket.ticket_number}</p>
                                </div>
                                <button onClick={() => link(ticket)} disabled={busyId === ticket.id} className="btn-ghost text-xs py-1 shrink-0">
                                    {busyId === ticket.id ? '…' : 'Link'}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {loading && <LoadingSpinner />}
            {!loading && linkedTickets.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No tickets linked to this asset.</p>
            )}
            {linkedTickets.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {linkedTickets.map(ticket => (
                        <li key={ticket.id} className="flex items-center justify-between py-2 text-sm">
                            <Link to={`/tickets/${ticket.id}`} className="min-w-0 group">
                                <p className="text-slate-800 dark:text-slate-200 group-hover:underline truncate">{ticket.title}</p>
                                <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{ticket.ticket_number}</p>
                            </Link>
                            <div className="flex items-center gap-2 shrink-0">
                                <StatusBadge status={ticket.status} />
                                <PriorityBadge priority={ticket.priority} />
                                <button onClick={() => unlink(ticket)} disabled={busyId === ticket.id} className="btn-ghost text-xs py-1 text-red-600 dark:text-red-400">
                                    {busyId === ticket.id ? '…' : 'Unlink'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
