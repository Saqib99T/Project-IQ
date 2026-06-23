import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Moon, Sun, Check, Palette } from 'lucide-react'
import { useIam } from '../../widget/hooks/useIam'
import { useTheme, BRAND_META } from '../useTheme'
import { AdminOrgScopeProvider, useAdminOrgScope } from '../AdminOrgScope'
import { usePortalAuth } from '../PortalAuth'
import { useApi } from '../useApi'

/**
 * Super-admin tenant switcher — scopes all admin data to one tenant (or all).
 * Hidden for tenant admins (backend pins them to their own org regardless).
 */
function TenantSwitcher({ isPlatformAdmin }) {
    const { call } = useApi()
    const { orgId, setOrgId } = useAdminOrgScope()
    const [orgs, setOrgs] = useState([])

    useEffect(() => {
        if (!isPlatformAdmin) return
        let cancelled = false
        call('/portal/api/admin/iam-orgs')
            .then(d => { if (!cancelled) setOrgs(d?.orgs || []) })
            .catch(() => { if (!cancelled) setOrgs([]) })
        return () => { cancelled = true }
    }, [call, isPlatformAdmin])

    if (!isPlatformAdmin) return null
    return (
        <select
            value={orgId}
            onChange={e => setOrgId(e.target.value)}
            title="Filter data by tenant"
            className="border border-bordc rounded-lg px-3 py-1.5 text-sm bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
            <option value="">All tenants</option>
            {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
        </select>
    )
}

const NAV_GROUP_STORAGE_KEY = 'admin-nav-collapsed-groups'

function getInitialCollapsed() {
    try {
        const stored = JSON.parse(localStorage.getItem(NAV_GROUP_STORAGE_KEY) || '{}')
        return typeof stored === 'object' && stored ? stored : {}
    } catch {
        return {}
    }
}

// Collapsible sidebar section header — click to expand/collapse a nav group.
// State persists per-browser so a super_admin's preference sticks across visits.
function SidebarGroup({ id, label, defaultCollapsed = false, children }) {
    const [collapsedMap, setCollapsedMap] = useState(getInitialCollapsed)
    const collapsed = collapsedMap[id] ?? defaultCollapsed

    const toggle = () => {
        setCollapsedMap(prev => {
            const next = { ...prev, [id]: !collapsed }
            localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(next))
            return next
        })
    }

    return (
        <div>
            <button
                onClick={toggle}
                className="w-full flex items-center justify-between px-3.5 pt-4 pb-1.5 text-[11px] font-semibold text-sidebarfg/40 uppercase tracking-wider hover:text-sidebarfg/70 transition-colors"
            >
                <span>{label}</span>
                <span className={`text-[10px] transition-transform duration-150 ${collapsed ? '-rotate-90' : ''}`}>▾</span>
            </button>
            {!collapsed && <div className="space-y-1">{children}</div>}
        </div>
    )
}

function SidebarLink({ to, icon, label, end }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
            <span className="text-base leading-none">{icon}</span>
            {label}
        </NavLink>
    )
}

// Combined appearance menu: brand (Project IQ / 99 Technologies) + dark mode,
// in a single dropdown anchored top-right.
function AppearanceMenu() {
    const { brand, setBrand, theme, toggleTheme } = useTheme()
    const dark = theme === 'dark'
    const [open, setOpen] = useState(false)
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', onDoc)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
    }, [open])

    const activeSwatch = BRAND_META[brand]?.swatch

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-label="Appearance settings"
                aria-haspopup="menu"
                aria-expanded={open}
                className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-bordc bg-surface
                           text-fgmuted hover:text-fg hover:bg-surface2 transition-colors"
            >
                <Palette className="w-4 h-4" />
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeSwatch }} />
                {dark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 mt-2 w-60 rounded-2xl border border-bordc bg-surface shadow-xl
                               p-2 z-50 origin-top-right"
                >
                    <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fgsubtle">Theme</p>
                    {Object.entries(BRAND_META).map(([key, meta]) => (
                        <button
                            key={key}
                            role="menuitemradio"
                            aria-checked={brand === key}
                            onClick={() => { setBrand(key); setOpen(false) }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm transition-colors ${
                                brand === key ? 'bg-primary/10 text-primary font-medium' : 'text-fg hover:bg-surface2'
                            }`}
                        >
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: meta.swatch }} />
                            <span className="flex-1 text-left">{meta.label}</span>
                            {brand === key && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                    ))}

                    <div className="my-1.5 border-t border-bordc" />

                    <button
                        role="menuitemcheckbox"
                        aria-checked={dark}
                        onClick={toggleTheme}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-sm text-fg hover:bg-surface2 transition-colors"
                    >
                        {dark ? <Moon className="w-4 h-4 shrink-0 text-primary" /> : <Sun className="w-4 h-4 shrink-0 text-amber-500" />}
                        <span className="flex-1 text-left">Dark mode</span>
                        <span className={`relative inline-flex items-center w-9 h-5 rounded-full transition-colors ${dark ? 'bg-primary' : 'bg-bordstrong'}`}>
                            <span className={`absolute w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-200 ${dark ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                        </span>
                    </button>
                </div>
            )}
        </div>
    )
}

export default function AdminLayout() {
    const { user, logout } = useIam()
    // Platform status comes from the backend (super_admin OR org_admin of the
    // platform org) — the realm role alone misses platform-org org_admins.
    const { isPlatformAdmin } = usePortalAuth()

    return (
      <AdminOrgScopeProvider>
        <div className="flex h-screen overflow-hidden bg-bg transition-colors">
            {/* Sidebar */}
            <aside className="w-64 bg-sidebar border-r border-bordc flex flex-col shrink-0 transition-colors">
                <div className="h-16 flex items-center px-5 border-b border-sidebarfg/10">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accentfrom to-accentto flex items-center justify-center text-white text-sm font-bold shadow-lg">
                        IQ
                    </div>
                    <span className="ml-2.5 text-sidebarfg font-semibold text-sm tracking-wide">Project IQ</span>
                    <span className="ml-2 badge bg-primary/10 text-primary">Admin</span>
                </div>

                <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
                    {/* Organization section — all admins */}
                    <div className="px-3.5 pt-1 pb-1.5 text-[11px] font-semibold text-sidebarfg/40 uppercase tracking-wider">
                        Organization
                    </div>
                    <SidebarLink to="/admin"               icon="📊" label="Overview"      end />
                    <SidebarLink to="/admin/analytics"     icon="📈" label="Analytics"     />
                    <SidebarLink to="/admin/history"       icon="🕓" label="History"        />
                    <SidebarLink to="/admin/monitor"       icon="📡" label="Live Monitor"   />
                    <SidebarLink to="/admin/alerts"        icon="🔔" label="Alerts"          />
                    <SidebarLink to="/admin/users"         icon="👥" label="Users"           />

                    {/* ITSM section — tenant-scoped for org admins, all-tenant for super_admin */}
                    <div className="px-3.5 pt-4 pb-1.5 text-[11px] font-semibold text-sidebarfg/40 uppercase tracking-wider">
                        ITSM
                    </div>
                    <SidebarLink to="/admin/itsm"            icon="🎫" label="Tickets"        end />
                    <SidebarLink to="/admin/itsm/assets"     icon="🖥️" label="Assets"         />
                    <SidebarLink to="/admin/itsm/kb"         icon="📖" label="Knowledge Base" />
                    <SidebarLink to="/admin/itsm/reports"    icon="📑" label="Reports"        />

                    {/* Platform section — 99Tech super_admin only; collapsed by default
                        since it's ~10 links most tenant admins never see/need */}
                    {isPlatformAdmin && (
                        <SidebarGroup id="platform" label="Platform" defaultCollapsed>
                            <SidebarLink to="/admin/orgs"          icon="🏢" label="Organizations"  />
                            <SidebarLink to="/admin/config"        icon="⚙️" label="Configuration"  />
                            <SidebarLink to="/admin/kb"            icon="📚" label="Knowledge Base" />
                            <SidebarLink to="/admin/studio"        icon="🧠" label="Bot Studio"     />
                            <SidebarLink to="/admin/themes"        icon="🎨" label="Themes"         />
                            <SidebarLink to="/admin/integration"   icon="🔗" label="Integration"    />
                            <SidebarLink to="/admin/firecrawl"     icon="🕷️" label="Firecrawl"      />
                            <SidebarLink to="/admin/observability" icon="🔭" label="Observability"  />
                            <SidebarLink to="/admin/diagnostics"   icon="🩺" label="Diagnostics"    />
                            <SidebarLink to="/admin/inspector"     icon="🔍" label="Inspector"      />
                            <SidebarLink to="/admin/routing"       icon="🔀" label="Routing Rules"  />
                        </SidebarGroup>
                    )}
                </nav>

                <div className="p-3 border-t border-sidebarfg/10">
                    <div className="flex items-center gap-3 px-2 py-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accentfrom to-accentto flex items-center justify-center text-white text-xs font-bold shrink-0 shadow">
                            {(user?.name || 'A').charAt(0).toUpperCase()}
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
                <header className="h-16 bg-surface border-b border-bordc flex items-center px-6 shrink-0 transition-colors">
                    <h1 className="text-lg font-semibold text-fg">Admin Dashboard</h1>
                    {user?.organization_alias && (
                        <span className="ml-3 badge bg-surface2 text-fgmuted">{user.organization_alias}</span>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                        <TenantSwitcher isPlatformAdmin={isPlatformAdmin} />
                        <AppearanceMenu />
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto p-6">
                    <Outlet />
                </main>
            </div>
        </div>
      </AdminOrgScopeProvider>
    )
}
