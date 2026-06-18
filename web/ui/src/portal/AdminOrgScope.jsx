import { createContext, useContext, useState, useMemo, useCallback } from 'react'

/**
 * Holds the super-admin "viewing tenant" for the portal admin pages.
 *
 * - Tenant admins: never used (backend forces their own org regardless).
 * - Super/platform admins: selecting a tenant scopes all admin data calls to it
 *   via the `X-Org-Id` header (see portal/useApi.js). Empty = all tenants.
 *
 * Persisted per-browser so the selection sticks across navigation.
 */
const KEY = 'piq_admin_org_scope'
const AdminOrgScopeContext = createContext({ orgId: '', setOrgId: () => {} })

export function AdminOrgScopeProvider({ children }) {
    const [orgId, _setOrgId] = useState(() => {
        try { return localStorage.getItem(KEY) || '' } catch { return '' }
    })
    const setOrgId = useCallback((v) => {
        _setOrgId(v || '')
        try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY) } catch { /* ignore */ }
    }, [])
    const value = useMemo(() => ({ orgId, setOrgId }), [orgId, setOrgId])
    return <AdminOrgScopeContext.Provider value={value}>{children}</AdminOrgScopeContext.Provider>
}

export function useAdminOrgScope() {
    return useContext(AdminOrgScopeContext)
}
