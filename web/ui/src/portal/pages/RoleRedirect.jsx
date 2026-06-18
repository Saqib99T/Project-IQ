import { Navigate } from 'react-router-dom'
import { useIam } from '../../widget/hooks/useIam'

export default function RoleRedirect() {
    const { user } = useIam()

    if (!user) return <Navigate to="/login" replace />

    const r = user.client_roles || []
    const realm = user.realm_roles || []

    // Tenant/org admins (realm org_admin) and platform super_admins, plus the
    // project-iq 'Admin' client role, all land in the admin section.
    if (realm.includes('super_admin') || realm.includes('org_admin') || r.includes('Admin'))
        return <Navigate to="/admin" replace />
    if (r.includes('Operator'))                                  return <Navigate to="/operator" replace />
    // User and Bot roles get full chatbot access.
    if (r.includes('User') || r.includes('Bot')) return <Navigate to="/chat" replace />

    // No recognised portal role — show access denied
    return <Navigate to="/no-access" replace />
}
