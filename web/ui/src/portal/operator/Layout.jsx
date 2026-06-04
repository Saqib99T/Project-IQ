import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'

function SidebarLink({ to, icon, label }) {
    return (
        <NavLink
            to={to}
            end={to === '/operator'}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
            <span className="text-lg">{icon}</span>
            {label}
        </NavLink>
    )
}

export default function OperatorLayout() {
    const { user, logout } = useIam()
    const navigate = useNavigate()

    return (
        <div className="flex h-screen overflow-hidden bg-gray-100">
            {/* Sidebar */}
            <aside className="w-60 bg-gray-900 flex flex-col shrink-0">
                {/* Brand */}
                <div className="h-16 flex items-center px-5 border-b border-gray-700">
                    <span className="text-white font-semibold text-sm tracking-wide">Project IQ</span>
                    <span className="ml-2 badge bg-blue-500/20 text-blue-300">Operator</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    <SidebarLink to="/operator/queue" icon="📋" label="Queue" />
                    <SidebarLink to="/operator/sessions" icon="💬" label="My Sessions" />
                </nav>

                {/* User footer */}
                <div className="p-3 border-t border-gray-700">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(user?.name || 'O').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-white font-medium truncate">{user?.name || user?.username}</p>
                            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
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
                <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 shrink-0">
                    <h1 className="text-lg font-semibold text-gray-800">Operator Console</h1>
                    <div className="ml-auto flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-sm text-gray-500">Online</span>
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
