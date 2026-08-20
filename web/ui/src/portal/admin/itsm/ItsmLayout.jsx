import { NavLink, Outlet } from 'react-router-dom'
import { useIam } from '../../../widget/hooks/useIam'
import { usePortalAuth } from '../../PortalAuth'
import { useDerivedItsmTenantId } from '../../useDerivedItsmTenantId'
import { ItsmTenantScope, useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'

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
    const { tenantId } = useItsmTenant()
    // Use the backend's authoritative platform-admin flag (covers org_admin of the
    // platform org, e.g. projectiq-admin@…) — not just the super_admin realm role,
    // which a platform-org admin doesn't carry.
    const { isPlatformAdmin } = usePortalAuth()

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">ITSM</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                    {isPlatformAdmin
                        ? (tenantId ? 'Viewing a single tenant' : 'Cross-tenant platform view')
                        : `${user?.organization_alias || 'Your organization'}'s tickets, assets and knowledge base`}
                </p>
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
    const tenantId = useDerivedItsmTenantId()
    return (
        <ItsmTenantScope tenantId={tenantId}>
            <div className="max-w-5xl space-y-6">
                <ItsmHeader />
                <Outlet />
            </div>
        </ItsmTenantScope>
    )
}
