import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
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

export default function OperatorLayout() {
    const { user, logout } = useIam()
    const navigate = useNavigate()
    const { call } = useApi()

    const [queue, setQueue]       = useState([])
    const [sessions, setSessions] = useState([])

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

    // Presence heartbeat — keeps this operator's last_seen fresh so the bot
    // routes new "talk to a human" requests to them (else "no agents available").
    useEffect(() => {
        const beat = () => call('/portal/api/heartbeat', { method: 'POST' }).catch(() => {})
        beat()
        const iv = setInterval(beat, 30_000)
        return () => clearInterval(iv)
    }, [call])

    // Live refresh on queue/session socket events.
    usePortalSocket({
        onEvent: (evt) => {
            if (['queue_item_updated', 'queue_item_removed', 'handoff_resolved'].includes(evt)) refresh()
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
                                : sessions.map(s => (
                                    <NavLink
                                        key={s.conversation_id}
                                        to={`/operator/sessions/${s.conversation_id}`}
                                        title={s.sender_id}
                                        className={({ isActive }) => `${subItem} ${isActive ? 'bg-primary/10 text-primary' : ''}`}
                                    >
                                        <span>💬</span>
                                        <span className="truncate">{shortLabel(s)}</span>
                                    </NavLink>
                                ))}
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
                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500"></span><span className="text-sm text-fgmuted">Online</span></span>
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
