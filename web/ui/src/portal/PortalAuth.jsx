import { createContext, useContext, useEffect, useState } from 'react'
import { useIam } from '../widget/hooks/useIam'

/**
 * Exposes the BACKEND's authoritative platform/role flags to the portal.
 *
 * The browser can't compute `is_platform_admin` (it doesn't know the platform
 * org id), so we ask /admin/whoami. This is how an `org_admin` of the PLATFORM
 * org (e.g. projectiq-admin@99technologies.com) gets the super-admin UI even
 * though they don't carry the `super_admin` realm role.
 */
const Ctx = createContext({ isPlatformAdmin: false, ready: false, whoami: null })

export function PortalAuthProvider({ children }) {
    const { isAuthenticated, kc } = useIam()
    const [state, setState] = useState({ isPlatformAdmin: false, ready: false, whoami: null })

    useEffect(() => {
        if (!isAuthenticated) { setState({ isPlatformAdmin: false, ready: true, whoami: null }); return }
        let cancelled = false
        fetch('/portal/api/admin/whoami', {
            headers: { Authorization: `Bearer ${kc?.token}` },
        })
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (!cancelled) setState({ isPlatformAdmin: !!d?.is_platform_admin, ready: true, whoami: d }) })
            .catch(() => { if (!cancelled) setState({ isPlatformAdmin: false, ready: true, whoami: null }) })
        return () => { cancelled = true }
    }, [isAuthenticated, kc])

    return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function usePortalAuth() {
    return useContext(Ctx)
}
