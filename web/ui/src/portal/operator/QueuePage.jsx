import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'
import { productLabel } from './productLabels'

const PRIORITY_LABEL = { 1: 'Low', 5: 'Normal', 7: 'High', 9: 'Urgent' }
const TRIGGER_ICON   = { user_request: '🙋', low_confidence: '🤔', frustration: '😤' }

function timeAgo(iso) {
    const secs = Math.floor((Date.now() - new Date(iso)) / 1000)
    if (secs < 60)   return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
}

function QueueItem({ item, onClaim }) {
    return (
        <div className="card p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0">
                #{item.queue_position || '?'}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-fg truncate">{item.sender_id}</span>
                    {item.channel === 'platform' && (
                        <span className="badge bg-purple-100 text-purple-700">platform</span>
                    )}
                    {item.product_id && (
                        <span className="badge bg-bg text-fgmuted">{productLabel(item.product_id)}</span>
                    )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-fgmuted">
                    <span>{TRIGGER_ICON[item.trigger_reason] || '💬'} {item.trigger_reason?.replace(/_/g, ' ')}</span>
                    <span>·</span>
                    <span>{item.app_id}</span>
                    {item.user_org_id && <><span>·</span><span>{item.user_org_id}</span></>}
                    <span>·</span>
                    <span>{timeAgo(item.queued_at)}</span>
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <span className={`badge ${
                    item.priority >= 7 ? 'bg-red-100 text-red-700'
                    : item.priority >= 5 ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-bg text-fgmuted'
                }`}>
                    {PRIORITY_LABEL[item.priority] || `P${item.priority}`}
                </span>
                <button className="btn-primary" onClick={() => onClaim(item)}>
                    Accept
                </button>
            </div>
        </div>
    )
}

export default function QueuePage() {
    const { call } = useApi()
    const [items, setItems]     = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError]     = useState(null)
    const [claiming, setClaiming] = useState(null)

    const fetchQueue = useCallback(async () => {
        try {
            const data = await call('/portal/api/queue')
            setItems(data.queue || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call])

    useEffect(() => {
        fetchQueue()
        const iv = setInterval(fetchQueue, 10_000)
        return () => clearInterval(iv)
    }, [fetchQueue])

    const handleClaim = async (item) => {
        setClaiming(item.id)
        try {
            await call('/portal/api/queue/claim', {
                method: 'POST',
                body: JSON.stringify({ queue_id: item.id, sender_id: item.sender_id }),
            })
            await fetchQueue()
        } catch (e) {
            alert(`Could not claim: ${e.message}`)
        } finally {
            setClaiming(null)
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-fg">Handoff Queue</h2>
                    <p className="text-sm text-fgmuted">{items.length} user{items.length !== 1 ? 's' : ''} waiting</p>
                </div>
                <button onClick={fetchQueue} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="card p-4 bg-danger/10 border-danger/30 text-danger text-sm">{error}</div>
            )}

            {!loading && !error && items.length === 0 && (
                <div className="card p-12 text-center text-fgsubtle space-y-2">
                    <p className="text-3xl">✅</p>
                    <p className="font-medium">Queue is empty</p>
                    <p className="text-sm">No users waiting for support</p>
                </div>
            )}

            {items.map(item => (
                <QueueItem
                    key={item.id}
                    item={item}
                    onClaim={claiming === item.id ? () => {} : handleClaim}
                />
            ))}
        </div>
    )
}
