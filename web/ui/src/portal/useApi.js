import { useCallback } from 'react'
import { useIam } from '../widget/hooks/useIam'
import { useAdminOrgScope } from './AdminOrgScope'

/**
 * Returns a `call(path, options)` function that attaches the IAM Bearer token
 * to every request and throws on non-2xx responses.
 *
 * For super admins, the selected tenant (AdminOrgScope) is forwarded as the
 * `X-Org-Id` header so admin data is scoped to one tenant. The backend ignores
 * this header for tenant admins (they're always pinned to their own org).
 */
export function useApi() {
    const { kc } = useIam()
    const { orgId } = useAdminOrgScope()

    const call = useCallback(async (path, options = {}) => {
        // Read token from the KC singleton at call time to avoid the stale-state
        // race where React state hasn't propagated yet on first mount.
        const token = kc?.token
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(orgId ? { 'X-Org-Id': orgId } : {}),
            ...(options.headers || {}),
        }
        const resp = await fetch(path, { ...options, headers })
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ error: resp.statusText }))
            const err = new Error(body.error || `HTTP ${resp.status}`)
            err.status = resp.status
            throw err
        }
        return resp.json()
    }, [kc, orgId])

    return { call }
}
