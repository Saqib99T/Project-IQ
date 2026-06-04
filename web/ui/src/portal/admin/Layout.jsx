import { NavLink, Outlet } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'

function SidebarLink({ to, icon, label, end }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
            <span className="text-lg">{icon}</span>
            {label}
        </NavLink>
    )
}

export default function AdminLayout() {
    const { user, logout } = useIam()

    const isPlatformAdmin = user?.realm_roles?.includes('super_admin')

    return (
        <div className="flex h-screen overflow-hidden bg-gray-100">
            {/* Sidebar */}
            <aside className="w-60 bg-gray-900 flex flex-col shrink-0">
                <div className="h-16 flex items-center px-5 border-b border-gray-700">
                    <span className="text-white font-semibold text-sm tracking-wide">Project IQ</span>
                    <span className="ml-2 badge bg-amber-500/20 text-amber-300">Admin</span>
                </div>

                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    {/* Organization section — all admins */}
                    <div className="px-4 pt-1 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Organization
                    </div>
                    <SidebarLink to="/admin"               icon="📊" label="Overview"      end />
                    <SidebarLink to="/admin/analytics"     icon="📈" label="Analytics"     />
                    <SidebarLink to="/admin/history"       icon="🕓" label="History"        />
                    <SidebarLink to="/operator/queue"      icon="📋" label="Queue"          />
                    <SidebarLink to="/admin/operators"     icon="👤" label="Operators"      />
                    <SidebarLink to="/admin/users"         icon="👥" label="Users"           />

                    {/* Platform section — 99Tech super_admin only */}
                    {isPlatformAdmin && (
                        <>
                            <div className="px-4 pt-4 pb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                Platform
                            </div>
                            <SidebarLink to="/admin/orgs" icon="🏢" label="Organizations" />
                        </>
                    )}
                </nav>

                <div className="p-3 border-t border-gray-700">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(user?.name || 'A').charAt(0).toUpperCase()}
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
                <header className="h-16 bg-white border-b border-gray-200 flex items-center px-6 shrink-0">
                    <h1 className="text-lg font-semibold text-gray-800">Admin Dashboard</h1>
                    {user?.organization_alias && (
                        <span className="ml-3 badge bg-gray-100 text-gray-600">{user.organization_alias}</span>
                    )}
                </header>
                <main className="flex-1 overflow-y-auto p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    )
}
