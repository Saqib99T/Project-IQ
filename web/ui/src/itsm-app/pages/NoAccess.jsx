import { useIam } from '../../widget/hooks/useIam'

export default function NoAccess() {
    const { user, logout } = useIam()

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 space-y-5 text-center">
                <div className="w-12 h-12 bg-red-100 rounded-xl mx-auto flex items-center justify-center">
                    <span className="text-2xl">🚫</span>
                </div>
                <div>
                    <h1 className="text-xl font-bold text-slate-900">Access Denied</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Your account <strong>{user?.email}</strong> does not have an ITSM role assigned.
                    </p>
                    <p className="text-xs text-slate-400 mt-2">
                        Contact your administrator to be assigned an Admin, Org Admin, or Super Admin
                        role on the <code className="bg-slate-100 px-1 rounded">project-iq</code> client in Keycloak.
                    </p>
                </div>
                <button
                    onClick={() => logout({ redirectUri: window.location.origin + '/itsm/login' })}
                    className="w-full btn-primary py-2.5"
                >
                    Sign out
                </button>
            </div>
        </div>
    )
}
