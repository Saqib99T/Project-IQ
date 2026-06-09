import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name ? `${name} (${u.email})` : u.email
}

export default function WatchersSection({ ticketId }) {
    const { get, post, remove } = useItsmApi()
    const [selected, setSelected] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const { data: watchers, loading, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}/watchers`),
        [get, ticketId]
    )
    const { data: users } = useItsmResource(() => get('/tenant/users', { limit: 100 }), [get])

    const watcherList = watchers || []
    const userList = users?.items || []
    const watcherIds = new Set(watcherList.map(w => w.user_id))
    const candidates = userList.filter(u => !watcherIds.has(u.id))
    const userMap = Object.fromEntries(userList.map(u => [u.id, u]))

    const add = async () => {
        if (!selected) return
        setBusy(true); setError(null)
        try {
            await post(`/tickets/${ticketId}/watchers`, { user_id: selected })
            setSelected('')
            reload()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    const removeWatcher = async (userId) => {
        setBusy(true); setError(null)
        try {
            await remove(`/tickets/${ticketId}/watchers/${userId}`)
            reload()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Watchers</h3>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {watcherList.length > 0 && (
                <ul className="space-y-1.5">
                    {watcherList.map(w => (
                        <li key={w.user_id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700 dark:text-slate-300">{userMap[w.user_id] ? userLabel(userMap[w.user_id]) : w.user_id}</span>
                            <button onClick={() => removeWatcher(w.user_id)} disabled={busy} className="text-xs text-red-600 dark:text-red-400 hover:underline">Remove</button>
                        </li>
                    ))}
                </ul>
            )}

            <div className="flex items-center gap-2">
                <select className="select text-sm flex-1" value={selected} onChange={e => setSelected(e.target.value)}>
                    <option value="">Add a watcher…</option>
                    {candidates.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                </select>
                <button onClick={add} disabled={!selected || busy} className="btn-ghost text-xs py-1.5">Add</button>
            </div>
        </div>
    )
}
