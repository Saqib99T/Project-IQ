import { useState, useEffect, useCallback, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'
import { useApi } from '../useApi'
import { usePortalSocket } from './usePortalSocket'
import AppearanceMenu from '../AppearanceMenu'

// Friendly short label for a sender (chat ids look like "iam-<uuid>").
function shortLabel(item) {
    const name = item.user_name || item.display_name
    if (name) return name
    const sid = item.sender_id || ''
    return sid.length > 16 ? `${sid.slice(0, 14)}…` : (sid || 'User')
}

function GroupHeader({ to, icon, label, count }) {
    return (
        <NavLink
            to={to}
            end
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
            <span className="text-lg">{icon}</span>
            <span className="flex-1">{label}</span>
            {count > 0 && <span className="badge bg-primary/15 text-primary text-[10px]">{count}</span>}
        </NavLink>
    )
}

const STATUS_META = {
    available: { dot: 'bg-green-500', label: 'Available' },
    away:      { dot: 'bg-amber-500', label: 'Away' },
    busy:      { dot: 'bg-red-500',   label: 'Busy' },
    offline:   { dot: 'bg-gray-400',  label: 'Offline' },
}

function StatusControl({ status, onSet }) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useEffect(() => {
        const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('click', h)
        return () => document.removeEventListener('click', h)
    }, [])
    const meta = STATUS_META[status] || STATUS_META.offline
    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border border-bordc bg-surface text-fgmuted hover:bg-bg transition-colors"
            >
                <span className={`w-2 h-2 rounded-full ${meta.dot}`}></span>
                {meta.label}
                <span className="text-xs">▾</span>
            </button>
            {open && (
                <div className="absolute right-0 mt-1 w-36 bg-surface border border-bordc rounded-lg shadow-lg z-30 py-1">
                    {['available', 'away'].map(s => (
                        <button
                            key={s}
                            onClick={() => { setOpen(false); onSet(s) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-bg flex items-center gap-2 text-fg"
                        >
                            <span className={`w-2 h-2 rounded-full ${STATUS_META[s].dot}`}></span>
                            {STATUS_META[s].label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function OperatorLayout() {
    const { user, logout } = useIam()
    const navigate = useNavigate()
    const location = useLocation()
    const { call }   = useApi()

    const [queue, setQueue]       = useState([])
    const [sessions, setSessions] = useState([])
    const [status, setStatus]     = useState('available')
    const [unread, setUnread]     = useState({})   // conversation_id → count

    // Conversation id currently open (route /operator/sessions/:id)
    const activeMatch = location.pathname.match(/\/operator\/sessions\/(\d+)/)
    const activeConvId = activeMatch ? activeMatch[1] : null

    const refresh = useCallback(async () => {
        try {
            const [q, s] = await Promise.all([
                call('/portal/api/queue').catch(() => ({ queue: [] })),
                call('/portal/api/sessions').catch(() => ({ sessions: [] })),
            ])
            setQueue(q.queue || [])
            setSessions(s.sessions || [])
        } catch { /* keep last good */ }
    }, [call])

    useEffect(() => {
        refresh()
        const iv = setInterval(refresh, 10_000)
        return () => clearInterval(iv)
    }, [refresh])

    // Presence heartbeat — keeps last_seen fresh (routable) and syncs status.
    useEffect(() => {
        const beat = () => call('/portal/api/heartbeat', { method: 'POST' })
            .then(d => { if (d?.status) setStatus(d.status) })
            .catch(() => {})
        beat()
        const iv = setInterval(beat, 30_000)
        return () => clearInterval(iv)
    }, [call])

    const setOperatorStatus = useCallback(async (s) => {
        setStatus(s)  // optimistic
        try {
            const d = await call('/portal/api/status', { method: 'POST', body: JSON.stringify({ status: s }) })
            if (d?.status) setStatus(d.status)
        } catch { /* heartbeat will reconcile */ }
    }, [call])

    // Clear unread for the session currently being viewed.
    useEffect(() => {
        if (!activeConvId) return
        setUnread(prev => (prev[activeConvId] ? { ...prev, [activeConvId]: 0 } : prev))
    }, [activeConvId])

    // Live refresh + unread tracking on socket events.
    usePortalSocket({
        onEvent: (evt, data) => {
            if (['queue_item_updated', 'queue_item_removed', 'handoff_resolved'].includes(evt)) refresh()
            if (evt === 'user_message' && data?.conversation_id != null) {
                const cid = String(data.conversation_id)
                if (cid !== String(activeConvId)) {
                    setUnread(prev => ({ ...prev, [cid]: (prev[cid] || 0) + 1 }))
                }
            }
        },
    })

    const subItem = 'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-sidebarfg/70 hover:bg-sidebarfg/10 hover:text-sidebarfg transition-colors truncate text-left'

    return (
        <div className="flex h-screen overflow-hidden bg-bg transition-colors">
            {/* Sidebar */}
            <aside className="w-60 bg-sidebar border-r border-bordc flex flex-col shrink-0 transition-colors">
                {/* Brand */}
                <div className="h-16 flex items-center px-5 border-b border-sidebarfg/10">
                    <span className="text-sidebarfg font-semibold text-sm tracking-wide">Project IQ</span>
                    <span className="ml-2 badge bg-primary/10 text-primary">Operator</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
                    {/* Queue + waiting entries */}
                    <div className="space-y-1">
                        <GroupHeader to="/operator/queue" icon="📋" label="Queue" count={queue.length} />
                        <div className="pl-2 space-y-0.5">
                            {queue.length === 0
                                ? <p className="px-2.5 py-1 text-[11px] text-sidebarfg/40">No one waiting</p>
                                : queue.map(q => (
                                    <button key={q.id} onClick={() => navigate('/operator/queue')} className={subItem} title={q.sender_id}>
                                        <span className="badge bg-sidebarfg/10 text-sidebarfg/70 text-[10px] px-1.5">#{q.queue_position || '?'}</span>
                                        <span className="truncate">{shortLabel(q)}</span>
                                    </button>
                                ))}
                        </div>
                    </div>

                    {/* My Sessions + active conversations */}
                    <div className="space-y-1">
                        <GroupHeader to="/operator/sessions" icon="💬" label="My Sessions" count={sessions.length} />
                        <div className="pl-2 space-y-0.5">
                            {sessions.length === 0
                                ? <p className="px-2.5 py-1 text-[11px] text-sidebarfg/40">No active sessions</p>
                                : sessions.map(s => {
                                    const u = unread[String(s.conversation_id)] || 0
                                    return (
                                        <NavLink
                                            key={s.conversation_id}
                                            to={`/operator/sessions/${s.conversation_id}`}
                                            title={s.sender_id}
                                            className={({ isActive }) => `${subItem} ${isActive ? 'bg-primary/10 text-primary' : ''}`}
                                        >
                                            <span>💬</span>
                                            <span className="truncate flex-1">{shortLabel(s)}</span>
                                            {u > 0 && (
                                                <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                                                    {u > 9 ? '9+' : u}
                                                </span>
                                            )}
                                        </NavLink>
                                    )
                                })}
                        </div>
                    </div>
                </nav>

                {/* User footer */}
                <div className="p-3 border-t border-sidebarfg/10">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accentfrom to-accentto flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(user?.name || 'O').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-sidebarfg font-medium truncate">{user?.name || user?.username}</p>
                            <p className="text-xs text-sidebarfg/50 truncate">{user?.email}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => logout({ redirectUri: window.location.origin + '/portal/login' })}
                        className="mt-1 w-full sidebar-link text-left"
                    >
                        <span>🚪</span> Sign out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Top bar */}
                <header className="h-16 bg-surface border-b border-bordc flex items-center px-6 shrink-0 transition-colors">
                    <h1 className="text-lg font-semibold text-fg">Operator Console</h1>
                    <div className="ml-auto flex items-center gap-3">
                        <StatusControl status={status} onSet={setOperatorStatus} />
                        <AppearanceMenu />
                    </div>
                </header>

                {/* Page content */}
                <main className="flex-1 overflow-y-auto p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
