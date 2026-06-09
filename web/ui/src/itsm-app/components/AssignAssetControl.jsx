import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { ErrorBanner } from '../../shared/itsm/primitives'

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name ? `${name} (${u.email})` : u.email
}

export default function AssignAssetControl({ asset, onUpdated }) {
    const { get, post, remove } = useItsmApi()
    const [selected, setSelected] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const { data: users } = useItsmResource(() => get('/tenant/users', { limit: 100 }), [get])
    const userList = users?.items || []
    const userMap = Object.fromEntries(userList.map(u => [u.id, u]))
    const assignee = asset.assigned_to ? userMap[asset.assigned_to] : null

    const assign = async () => {
        if (!selected) return
        setBusy(true); setError(null)
        try {
            const updated = await post(`/assets/${asset.id}/assign`, { user_id: selected })
            setSelected('')
            onUpdated(updated)
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    const unassign = async () => {
        setBusy(true); setError(null)
        try {
            const updated = await remove(`/assets/${asset.id}/assign`)
            onUpdated(updated)
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Assignment</h3>
            {error && <ErrorBanner message={error.message} />}
            {asset.assigned_to ? (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">
                        Assigned to {assignee ? userLabel(assignee) : asset.assigned_to}
                    </span>
                    <button onClick={unassign} disabled={busy} className="text-xs text-red-600 dark:text-red-400 hover:underline">Unassign</button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <select className="select text-sm flex-1" value={selected} onChange={e => setSelected(e.target.value)}>
                        <option value="">Assign to…</option>
                        {userList.map(u => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
                    </select>
                    <button onClick={assign} disabled={!selected || busy} className="btn-ghost text-xs py-1.5">Assign</button>
                </div>
            )}
        </div>
    )
}
