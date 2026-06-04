import { Navigate } from 'react-router-dom'
import { useIam } from '../widget/hooks/useIam'

/**
 * Wraps routes that require authentication.
 * roles: optional array of client role names; if provided, user must have at least one.
 */
export default function AuthGuard({ children, roles = [] }) {
    const { isAuthenticated, isLoading, user } = useIam()

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-center space-y-3">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-sm text-gray-500">Loading…</p>
                </div>
            </div>
        )
    }

    if (!isAuthenticated) return <Navigate to="/login" replace />

    if (roles.length > 0 && user) {
        const clientRoles = user.client_roles || []
        const realmRoles  = user.realm_roles  || []
        const hasRole = roles.some(r => clientRoles.includes(r) || realmRoles.includes(r))
        if (!hasRole) return <Navigate to="/no-access" replace />
    }

    return children
}
