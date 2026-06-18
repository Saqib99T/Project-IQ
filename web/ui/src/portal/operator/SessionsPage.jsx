import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { usePortalSocket } from './usePortalSocket'
import { productLabel } from './productLabels'

function timeAgo(iso) {
    if (!iso) return '—'
    // Treat naive timestamps (no tz suffix) as UTC — backend stores UTC.
    let s = String(iso)
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(' ', 'T') + 'Z'
    const secs = Math.max(0, Math.floor((Date.now() - new Date(s)) / 1000))
    if (secs < 60)   return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
    return `${Math.floor(secs / 86400)}d ago`
}

function shortUser(senderId) {
    if (!senderId) return 'User'
    const m = String(senderId).replace(/^(iam-|id-)/, '')
    return m.length > 12 ? `User ${m.slice(0, 8)}` : m
}

function SessionCard({ session, onClick }) {
    return (
        <div
            className="card p-4 flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onClick(session)}
        >
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold shrink-0">
                💬
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-fg truncate">
                        {session.user_name || shortUser(session.sender_id)}
                    </span>
                    {session.channel === 'platform' && (
                        <span className="badge bg-purple-100 text-purple-700">platform</span>
                    )}
                    {session.product_id && (
                        <span className="badge bg-bg text-fgmuted">{productLabel(session.product_id)}</span>
                    )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-fgmuted">
                    <span>Claimed {timeAgo(session.assigned_at)}</span>
                </div>
            </div>
            <div className="shrink-0 text-xs text-primary font-medium">Open →</div>
        </div>
    )
}

export default function SessionsPage() {
    const { call } = useApi()
    const navigate = useNavigate()
    const [sessions, setSessions] = useState([])
    const [loading, setLoading]   = useState(true)
    const [error, setError]       = useState(null)

    const fetchSessions = useCallback(async () => {
        try {
            const data = await call('/portal/api/sessions')
            setSessions(data.sessions || [])
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call])

    useEffect(() => {
        fetchSessions()
    }, [fetchSessions])

    // Re-fetch when queue events arrive
    usePortalSocket({
        onEvent: (evt) => {
            if (['queue_item_updated', 'handoff_resolved'].includes(evt)) {
                fetchSessions()
            }
        },
    })

    return (
        <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-fg">My Sessions</h2>
                    <p className="text-sm text-fgmuted">
                        {sessions.length} active conversation{sessions.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <button onClick={fetchSessions} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading && (
                <div className="flex justify-center py-12">
                    <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
            )}

            {error && (
                <div className="card p-4 bg-danger/10 border-danger/30 text-danger text-sm">{error}</div>
            )}

            {!loading && !error && sessions.length === 0 && (
                <div className="card p-12 text-center text-fgsubtle space-y-2">
                    <p className="text-3xl">📭</p>
                    <p className="font-medium">No active sessions</p>
                    <p className="text-sm">Accept a session from the Queue to start chatting</p>
                </div>
            )}

            {sessions.map(s => (
                <SessionCard
                    key={s.conversation_id}
                    session={s}
                    onClick={sess => navigate(`/operator/sessions/${sess.conversation_id}`)}
                />
            ))}
        </div>
    )
}
