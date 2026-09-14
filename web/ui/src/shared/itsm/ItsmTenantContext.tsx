import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// Kept local rather than imported from useItsmApi.ts, which imports
// useItsmTenant from this module — a type-only import back would work (types
// are erased), but there's no need to introduce the circular reference at all
// for a one-line alias.
export type TenantId = string | null | undefined

export interface ItsmTenantValue {
    tenantId: TenantId
    setTenantId: (id: TenantId) => void
}

/**
 * Holds the "currently inspected tenant" for ITSM views.
 *
 * - Tenant users: tenantId stays null — itsm-service resolves their tenant
 *   from the JWT, no header needed.
 * - Platform users (super_admin): tenantId can be set via TenantSwitcher to
 *   scope requests to one tenant (X-Tenant-ID header), or left null for the
 *   cross-tenant/platform view.
 */
const ItsmTenantContext = createContext<ItsmTenantValue>({ tenantId: null, setTenantId: () => {} })

// Persists the platform user's tenant selection across page refreshes — was
// plain in-memory useState before (2026-09-14 fix), so every refresh silently
// dropped back to the "All tenants" default even right after picking one.
// Tenant-tier users never call setTenantId at all (no TenantSwitcher shown to
// them, see Layout.jsx), so this has no effect on them beyond reading an
// always-empty key. Known limitation, not fixed here: this is per-BROWSER,
// not per-user — two different platform users sharing a browser/profile
// would inherit each other's last selection. Not worth solving unless that
// turns out to be a real scenario for this org.
const STORAGE_KEY = 'itsm_tenant_id'

function readStoredTenantId(): TenantId {
    try {
        return window.localStorage.getItem(STORAGE_KEY) || null
    } catch {
        return null // localStorage unavailable (private browsing, etc.) — degrade to non-persistent
    }
}

export function ItsmTenantProvider({ children }: { children: ReactNode }) {
    const [tenantId, setTenantIdState] = useState<TenantId>(readStoredTenantId)

    const setTenantId = useCallback((id: TenantId) => {
        setTenantIdState(id)
        try {
            if (id) window.localStorage.setItem(STORAGE_KEY, id)
            else window.localStorage.removeItem(STORAGE_KEY)
        } catch {
            // ignore — selection still works for this session, just won't persist
        }
    }, [])

    const value = useMemo(() => ({ tenantId, setTenantId }), [tenantId, setTenantId])
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
export function ItsmTenantScope({ tenantId, children }: { tenantId: TenantId; children: ReactNode }) {
    const value = useMemo(
        () => ({ tenantId: tenantId ?? null, setTenantId: () => {} }),
        [tenantId],
    )
    return <ItsmTenantContext.Provider value={value}>{children}</ItsmTenantContext.Provider>
}

export function useItsmTenant(): ItsmTenantValue {
    return useContext(ItsmTenantContext)
}
