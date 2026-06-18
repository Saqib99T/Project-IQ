import { Navigate } from 'react-router-dom'
import { useIam } from '../widget/hooks/useIam'
import { usePortalAuth } from './PortalAuth'

const Spinner = () => (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center space-y-3">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500">Loading…</p>
        </div>
    </div>
)

/**
 * Wraps routes that require authentication.
 * roles: optional array of role names; user must have at least one — OR be a
 * platform admin (super_admin, or org_admin of the platform org, per the backend),
 * who may access everything.
 */
export default function AuthGuard({ children, roles = [] }) {
    const { isAuthenticated, isLoading, user } = useIam()
    const { isPlatformAdmin, ready } = usePortalAuth()

    if (isLoading) return <Spinner />
    if (!isAuthenticated) return <Navigate to="/login" replace />

    if (roles.length > 0 && user) {
        const clientRoles = user.client_roles || []
        const realmRoles  = user.realm_roles  || []
        const hasRole = roles.some(r => clientRoles.includes(r) || realmRoles.includes(r))
        if (!hasRole) {
            // Platform admins (incl. org_admin of the platform org) bypass role
            // gates. Wait for the backend whoami before denying, to avoid a flash.
            if (!ready) return <Spinner />
            if (!isPlatformAdmin) return <Navigate to="/no-access" replace />
        }
    }

    return children
}
