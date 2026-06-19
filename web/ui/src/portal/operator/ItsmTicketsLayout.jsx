import { Outlet } from 'react-router-dom'
import { ItsmTenantProvider } from '../../shared/itsm/ItsmTenantContext'

/**
 * Wraps the operator ticket routes in the ITSM tenant context so useItsmApi
 * sends X-Tenant-ID where needed. Operators are tenant-scoped (itsm-service
 * resolves their tenant from the JWT) — no TenantSwitcher, unlike the admin
 * ItsmLayout used by platform/super admins.
 */
export default function ItsmTicketsLayout() {
    return (
        <ItsmTenantProvider>
            <div className="max-w-5xl space-y-6">
                <Outlet />
            </div>
        </ItsmTenantProvider>
    )
}
