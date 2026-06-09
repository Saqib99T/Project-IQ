import { useIam } from '../../widget/hooks/useIam'

export default function NoAccess() {
    const { user, logout } = useIam()

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 space-y-5 text-center">
                <div className="w-12 h-12 bg-red-100 rounded-xl mx-auto flex items-center justify-center">
                    <span className="text-2xl">🚫</span>
                </div>
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Access Denied</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Your account <strong>{user?.email}</strong> does not have a portal role assigned.
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                        Contact your administrator to be assigned a User, Bot, Member, Operator, or Admin
                        role on the <code className="bg-gray-100 px-1 rounded">project-iq</code> client in Keycloak.
                    </p>
                </div>
                <button
                    onClick={() => logout({ redirectUri: window.location.origin + '/portal/login' })}
                    className="w-full btn-primary py-2.5"
                >
                    Sign out
                </button>
            </div>
        </div>
    )
}
