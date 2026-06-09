import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { StatusBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'

export default function LinkedAssetsSection({ ticketId }) {
    const { get, post, remove } = useItsmApi()
    const [showPicker, setShowPicker] = useState(false)
    const [search, setSearch] = useState('')
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data: linked, loading, reload } = useItsmResource(() => get(`/tickets/${ticketId}/assets`), [get, ticketId])
    const linkedAssets = linked || []
    const linkedIds = useMemo(() => new Set(linkedAssets.map(a => a.id)), [linkedAssets])

    const { data: allAssets, loading: loadingAll } = useItsmResource(
        () => (showPicker ? get('/assets') : Promise.resolve(null)),
        [get, showPicker]
    )
    const candidates = (allAssets?.assets || allAssets?.items || []).filter(a =>
        !linkedIds.has(a.id) && (
            search.trim() === '' ||
            a.name?.toLowerCase().includes(search.toLowerCase()) ||
            a.asset_tag?.toLowerCase().includes(search.toLowerCase())
        )
    )

    const link = async (asset) => {
        setBusyId(asset.id); setError(null)
        try {
            await post(`/tickets/${ticketId}/assets`, { asset_id: asset.id })
            setSearch('')
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }
    const unlink = async (asset) => {
        setBusyId(asset.id); setError(null)
        try {
            await remove(`/tickets/${ticketId}/assets/${asset.id}`)
            reload()
        } catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Linked assets</h3>
                <button onClick={() => setShowPicker(s => !s)} className="btn-ghost text-xs py-1.5">
                    {showPicker ? 'Close' : '+ Link asset'}
                </button>
            </div>

            {error && <ErrorBanner message={error.message} />}

            {showPicker && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
                    <input
                        className="input text-sm" placeholder="Search assets by name or tag…"
                        value={search} onChange={e => setSearch(e.target.value)}
                    />
                    {loadingAll && <LoadingSpinner />}
                    {!loadingAll && candidates.length === 0 && (
                        <p className="text-xs text-slate-400 dark:text-slate-500">No matching unlinked assets.</p>
                    )}
                    <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {candidates.map(asset => (
                            <li key={asset.id} className="flex items-center justify-between py-1.5 text-sm">
                                <div className="min-w-0">
                                    <p className="text-slate-800 dark:text-slate-200 truncate">{asset.name}</p>
                                    <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{asset.asset_tag}</p>
                                </div>
                                <button onClick={() => link(asset)} disabled={busyId === asset.id} className="btn-ghost text-xs py-1 shrink-0">
                                    {busyId === asset.id ? '…' : 'Link'}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {loading && <LoadingSpinner />}
            {!loading && linkedAssets.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No assets linked to this ticket.</p>
            )}
            {linkedAssets.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {linkedAssets.map(asset => (
                        <li key={asset.id} className="flex items-center justify-between py-2 text-sm">
                            <Link to={`/assets/${asset.id}`} className="min-w-0 group">
                                <p className="text-slate-800 dark:text-slate-200 group-hover:underline truncate">{asset.name}</p>
                                <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{asset.asset_tag}</p>
                            </Link>
                            <div className="flex items-center gap-2 shrink-0">
                                <StatusBadge status={asset.status} />
                                <button onClick={() => unlink(asset)} disabled={busyId === asset.id} className="btn-ghost text-xs py-1 text-red-600 dark:text-red-400">
                                    {busyId === asset.id ? '…' : 'Unlink'}
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
