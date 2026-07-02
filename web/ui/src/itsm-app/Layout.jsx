import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
    Ticket, MonitorSmartphone, BookOpen, BarChart3, Bot, Bell, Settings,
    LogOut, Moon, Sun, Check, Palette, Siren,
} from 'lucide-react'
import { useIam } from '../widget/hooks/useIam'
import { useTheme, BRAND_META } from '../portal/useTheme'
import { ItsmTenantProvider, useItsmTenant } from '../shared/itsm/ItsmTenantContext'
import { TenantSwitcher } from '../shared/itsm/TenantSwitcher'
import { LoadingSpinner } from '../shared/itsm/primitives'
import { ToastProvider, ConfirmProvider } from '../shared/itsm/ui'
import GlobalSearch from '../shared/itsm/GlobalSearch'

function SidebarLink({ to, icon: Icon, label, end }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
        >
            {Icon && <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={2} />}
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

export default function ItsmAppLayout({ isPlatformOrg }) {
    return (
        <ItsmTenantProvider>
            <ToastProvider>
                <ConfirmProvider>
                    <ItsmAppLayoutInner isPlatformOrg={isPlatformOrg} />
                </ConfirmProvider>
            </ToastProvider>
        </ItsmTenantProvider>
    )
}

function ItsmAppLayoutInner({ isPlatformOrg }) {
    const { user, logout } = useIam()
    const { tenantId, setTenantId } = useItsmTenant()
    const roles = user?.realm_roles || []
    // Platform-org users (e.g. 99T staff) administer any tenant; tenant users
    // need an itsm manager/admin role. realm_roles carry IAM names (Admin,
    // org_admin) — not the lowercase itsm role names — so accept both vocabularies.
    const canAdminister = isPlatformOrg || roles.some(r => ['manager', 'admin', 'Admin', 'org_admin', 'super_admin'].includes(r))

    return (
        <div className="flex h-screen overflow-hidden bg-bg transition-colors">
            <aside className="w-64 bg-sidebar border-r border-bordc flex flex-col shrink-0 transition-colors">
                <div className="h-16 flex items-center px-5 border-b border-sidebarfg/10">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accentfrom to-accentto flex items-center justify-center text-white shadow-lg">
                        <Ticket className="w-4 h-4" strokeWidth={2.5} />
                    </div>
                    <span className="ml-2.5 text-sidebarfg font-semibold text-sm tracking-wide">ITSM</span>
                    <span className="ml-2 badge bg-primary/10 text-primary">Project IQ</span>
                </div>

                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                    <SidebarLink to="/"          icon={Ticket}            label="Tickets"        end />
                    <SidebarLink to="/assets"    icon={MonitorSmartphone} label="Assets" />
                    <SidebarLink to="/kb"        icon={BookOpen}          label="Knowledge Base" />
                    <SidebarLink to="/reports"   icon={BarChart3}         label="Reports" />
                    <SidebarLink to="/incidents" icon={Siren}             label="Incidents" />
                    {/* Virtual Agent temporarily disabled (re-enable once the AI provider key is restored) */}
                    <SidebarLink to="/notifications" icon={Bell}          label="Notifications" />
                    {canAdminister && <SidebarLink to="/admin" icon={Settings} label="Administration" />}
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
                        onClick={() => logout({ redirectUri: window.location.origin + '/itsm/login' })}
                        className="mt-1 w-full sidebar-link text-left"
                    >
                        <LogOut className="w-[18px] h-[18px] shrink-0" strokeWidth={2} /> Sign out
                    </button>
                </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="h-16 bg-surface border-b border-bordc flex items-center px-6 shrink-0 transition-colors gap-3">
                    <h1 className="text-lg font-semibold text-fg">ITSM</h1>
                    {isPlatformOrg ? (
                        <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            {tenantId ? 'Viewing one tenant' : 'All tenants (cross-tenant view)'}
                        </span>
                    ) : user?.organization_alias && (
                        <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{user.organization_alias}</span>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                        <GlobalSearch />
                        {isPlatformOrg && <TenantSwitcher value={tenantId} onChange={setTenantId} />}
                        <AppearanceMenu />
                    </div>
                </header>
                <main className="flex-1 overflow-y-auto p-6">
                    <Suspense fallback={<LoadingSpinner />}>
                        <Outlet context={{ isPlatformOrg }} />
                    </Suspense>
                </main>
            </div>
        </div>
    )
}
