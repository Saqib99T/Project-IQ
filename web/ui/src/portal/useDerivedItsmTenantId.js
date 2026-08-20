import { useEffect, useState } from 'react'
import { useAdminOrgScope } from './AdminOrgScope'
import { usePortalAuth } from './PortalAuth'
import { useItsmApi } from '../shared/itsm/useItsmApi'

/**
 * Derives the itsm-service tenant id from the top-level org selector (Admin
 * Dashboard header's own dropdown, `useAdminOrgScope()`) instead of any page
 * maintaining its own separate tenant switcher/state for itsm-service calls.
 *
 * The two are different id spaces — `orgId` is IAM's org id, itsm-service's
 * own `Tenant.id` is a separate internally-generated UUID — so picking one
 * up top used to have no effect on itsm-scoped requests (see ItsmLayout.jsx
 * and IntegrationPage.jsx, which both hit this before this hook existed:
 * ItsmLayout had its own unsynced second dropdown, IntegrationPage passed
 * the raw IAM org_id straight through as X-Tenant-ID and 404'd with
 * `tenant '<iam org id>' not found` since itsm resolves that header against
 * its own Tenant.id, not iam_org_id).
 *
 * itsm's `GET /platform/tenants` already returns each tenant's `iam_org_id`
 * alongside its own `id`, so the org's IAM id is looked up against that list.
 */
export function useDerivedItsmTenantId() {
    const { orgId } = useAdminOrgScope()
    const { isPlatformAdmin } = usePortalAuth()
    const { get } = useItsmApi(null)
    const [tenants, setTenants] = useState([])

    useEffect(() => {
        if (!isPlatformAdmin) return
        let cancelled = false
        get('/platform/tenants')
            .then(data => { if (!cancelled) setTenants(data.tenants || data.items || []) })
            .catch(() => { if (!cancelled) setTenants([]) })
        return () => { cancelled = true }
    }, [get, isPlatformAdmin])

    if (!orgId) return null
    return tenants.find(t => t.iam_org_id === orgId)?.id ?? null
}
