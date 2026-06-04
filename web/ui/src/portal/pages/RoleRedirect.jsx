import { Navigate } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'

export default function RoleRedirect() {
    const { user } = useIam()

    if (!user) return <Navigate to="/login" replace />

    const r = user.client_roles || []
    const realm = user.realm_roles || []

    if (realm.includes('super_admin') || r.includes('Admin')) return <Navigate to="/admin" replace />
    if (r.includes('Operator'))                                  return <Navigate to="/operator" replace />
    if (r.includes('Member'))                                    return <Navigate to="/chat" replace />

    // No recognised portal role — show access denied
    return <Navigate to="/no-access" replace />
}
