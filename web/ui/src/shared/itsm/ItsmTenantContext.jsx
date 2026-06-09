import { createContext, useContext, useMemo, useState } from 'react'

/**
 * Holds the "currently inspected tenant" for ITSM views.
 *
 * - Tenant users: tenantId stays null — itsm-service resolves their tenant
 *   from the JWT, no header needed.
 * - Platform users (super_admin): tenantId can be set via TenantSwitcher to
 *   scope requests to one tenant (X-Tenant-ID header), or left null for the
 *   cross-tenant/platform view.
 */
const ItsmTenantContext = createContext({ tenantId: null, setTenantId: () => {} })

export function ItsmTenantProvider({ children }) {
    const [tenantId, setTenantId] = useState(null)
    const value = useMemo(() => ({ tenantId, setTenantId }), [tenantId])
    return <ItsmTenantContext.Provider value={value}>{children}</ItsmTenantContext.Provider>
}

/**
 * Pins the tenant context for a subtree to a specific tenant id — used on
 * entity detail pages (ticket/asset/…) so a platform "All tenants" user's
 * sub-resource calls (comments, attachments, history, …) carry the entity's
 * own X-Tenant-ID instead of inheriting the null cross-tenant context, which
 * otherwise fails those per-tenant endpoints with "Tenant context required".
 *
 * tenantId null/undefined → no override (behaves like the cross-tenant view).
 */
export function ItsmTenantScope({ tenantId, children }) {
    const value = useMemo(
        () => ({ tenantId: tenantId ?? null, setTenantId: () => {} }),
        [tenantId],
    )
    return <ItsmTenantContext.Provider value={value}>{children}</ItsmTenantContext.Provider>
}

export function useItsmTenant() {
    return useContext(ItsmTenantContext)
}
