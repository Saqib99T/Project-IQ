import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

function userLabel(u) {
    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim()
    return name || u.email
}

// Read-only view of each user's IAM roles. Roles are the source of truth in IAM
// (Keycloak/AccessWise); itsm-service captures them from the token and stores
// them on the user row on every login (IAM → ITSM sync). To change a user's
// roles, edit them in IAM — they refresh here on the user's next login.
export default function UserRolesSection() {
    const { get } = useItsmApi()
    const { data, loading, error, reload } = useItsmResource(() => get('/tenant/users', { limit: 100 }), [get])
    const users = data?.items || []

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">User (from IAM)</h3>
                <button onClick={reload} className="btn-ghost text-xs py-1.5">↻ Refresh</button>
            </div>
            <p className="text-xs text-fgsubtle">
                Synced from IAM on each login. Roles are managed in IAM (AccessWise) and update here when the user next signs in.
            </p>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && users.length === 0 && <EmptyState>No users found.</EmptyState>}
            {users.length > 0 && (
                <ul className="divide-y divide-bordc">
                    {users.map(u => (
                        <li key={u.id} className="py-2.5 text-sm flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-fg truncate">{userLabel(u)}</p>
                                <p className="text-xs text-fgsubtle truncate">{u.email}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                {(u.iam_roles || []).length === 0
                                    ? <span className="text-xs text-fgsubtle italic">no roles synced yet</span>
                                    : u.iam_roles.map(r => <span key={r} className="badge bg-primary/10 text-primary">{r}</span>)}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
