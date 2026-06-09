import { NavLink, Outlet } from 'react-router-dom'
import { useIam } from '../../../widget/hooks/useIam'
import { ItsmTenantProvider, useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { TenantSwitcher } from '../../../shared/itsm/TenantSwitcher'

function ItsmTab({ to, label, end }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
                }`
            }
        >
            {label}
        </NavLink>
    )
}

function ItsmHeader() {
    const { user } = useIam()
    const { tenantId, setTenantId } = useItsmTenant()
    const isPlatformAdmin = user?.realm_roles?.includes('super_admin')

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">ITSM</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                        {isPlatformAdmin
                            ? (tenantId ? 'Viewing a single tenant' : 'Cross-tenant platform view')
                            : `${user?.organization_alias || 'Your organization'}'s tickets, assets and knowledge base`}
                    </p>
                </div>
                {isPlatformAdmin && <TenantSwitcher value={tenantId} onChange={setTenantId} />}
            </div>
            <nav className="flex items-center gap-1.5">
                <ItsmTab to="/admin/itsm"         label="Tickets"        end />
                <ItsmTab to="/admin/itsm/assets"  label="Assets" />
                <ItsmTab to="/admin/itsm/kb"      label="Knowledge Base" />
                <ItsmTab to="/admin/itsm/reports" label="Reports" />
            </nav>
        </div>
    )
}

export default function ItsmLayout() {
    return (
        <ItsmTenantProvider>
            <div className="max-w-5xl space-y-6">
                <ItsmHeader />
                <Outlet />
            </div>
        </ItsmTenantProvider>
    )
}
