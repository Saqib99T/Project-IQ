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
    // `token` is reactive (Keycloak state); `kc.token` is not, so depending on it
    // misses the moment the token actually arrives on a hard refresh.
    const { isAuthenticated, isLoading, token } = useIam()
    const [state, setState] = useState({ isPlatformAdmin: false, ready: false, whoami: null })

    useEffect(() => {
        // CRITICAL: while Keycloak is still initializing, stay NOT ready. This
        // provider has its OWN useIam instance, separate from AuthGuard's, and
        // they flip `isAuthenticated` on slightly different ticks. If we declared
        // ready:true during the transient `!isAuthenticated` (init) window,
        // AuthGuard — once ITS copy turns authenticated — would read our stale
        // {ready:true, isPlatformAdmin:false} and bounce a platform admin to
        // /no-access on hard refresh. Gating on isLoading closes that race.
        if (isLoading) { setState(s => (s.ready ? { ...s, ready: false } : s)); return }
        if (!isAuthenticated) { setState({ isPlatformAdmin: false, ready: true, whoami: null }); return }
        // Authenticated but the token hasn't propagated yet — stay NOT ready so
        // AuthGuard shows a spinner instead of bouncing to /no-access. When the
        // token lands, this effect re-runs (token is in deps).
        if (!token) { setState(s => (s.ready ? { ...s, ready: false } : s)); return }

        let cancelled = false
        let attempt = 0
        const load = () => {
            fetch('/portal/api/admin/whoami', { headers: { Authorization: `Bearer ${token}` } })
                .then(r => { if (!r.ok) throw new Error(`whoami ${r.status}`); return r.json() })
                .then(d => { if (!cancelled) setState({ isPlatformAdmin: !!d?.is_platform_admin, ready: true, whoami: d }) })
                .catch(() => {
                    if (cancelled) return
                    // Transient (401 before token settles / network) — retry a few
                    // times while staying not-ready, rather than wrongly denying.
                    if (attempt++ < 3) setTimeout(load, 800)
                    else setState({ isPlatformAdmin: false, ready: true, whoami: null })
                })
        }
        load()
        return () => { cancelled = true }
    }, [isAuthenticated, token])

    return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export function usePortalAuth() {
    return useContext(Ctx)
}
