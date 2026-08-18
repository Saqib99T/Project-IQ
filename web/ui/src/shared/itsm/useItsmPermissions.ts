import { useMemo } from 'react'
import { useIam } from '../../widget/hooks/useIam'

/**
 * Single source of truth for ITSM capability checks in the UI.
 *
 * The app authenticates via IAM, whose token carries *realm/client roles* with
 * names like `Admin` / `org_admin` / `super_admin` — NOT the lowercase itsm
 * role names (`agent` / `team_lead` / `manager` / `admin`) the backend assigns.
 * Components used to check `realm_roles.includes('manager')` directly, which
 * silently failed for IAM/platform admins (they have `Admin`/`org_admin`),
 * hiding features like commenting and AI assist from the very users who should
 * see them. This hook normalises BOTH vocabularies into capability booleans.
 *
 * The backend remains the real authority — these booleans only drive UX
 * (showing/enabling controls); every action is still authorised server-side.
 */

// IAM realm/client roles that map to full tenant (or platform) administration.
const IAM_ADMIN_ROLES = ['Admin', 'org_admin', 'super_admin']
// itsm-service role vocabulary.
const ITSM_AGENT_ROLES = ['agent', 'team_lead', 'manager', 'admin']
const ITSM_TEAMLEAD_ROLES = ['team_lead', 'manager', 'admin']
const ITSM_MANAGER_ROLES = ['manager', 'admin']
const ITSM_ADMIN_ROLES = ['admin']

interface IamUser {
    realm_roles?: string[]
    client_roles?: string[]
    is_admin?: boolean
}

export interface ItsmPermissions {
    isAdmin: boolean
    isManager: boolean
    isTeamLead: boolean
    isAgent: boolean
    isPlatform: boolean
    roles: string[]
}

export function useItsmPermissions(): ItsmPermissions {
    const { user }: { user?: IamUser } = useIam()

    return useMemo(() => {
        const all = [...(user?.realm_roles || []), ...(user?.client_roles || [])]
        const has = (set: string[]) => all.some(r => set.includes(r))
        // IAM admin/org_admin (tenant admins AND 99T platform users) get full
        // capability — they are the highest-privilege actors in this app.
        const iamAdmin = has(IAM_ADMIN_ROLES) || !!user?.is_admin

        const isAdmin = iamAdmin || has(ITSM_ADMIN_ROLES)
        const isManager = isAdmin || has(ITSM_MANAGER_ROLES)
        const isTeamLead = isManager || has(ITSM_TEAMLEAD_ROLES)
        // IAM `Operator` (chat-handoff agents) maps to ITSM `agent` server-side,
        // so they get agent-tier UX (view/edit tickets, comment) — but NOT
        // manager/admin capabilities. The backend remains the real authority.
        const iamAgent = all.includes('Operator')
        const isAgent = isTeamLead || iamAgent || has(ITSM_AGENT_ROLES)
        // Platform (99T) staff — the only actors allowed to author cross-tenant
        // (global / product) KB content. Mirrors the backend tier=="platform"
        // gate; the backend remains the real authority.
        const isPlatform = all.includes('super_admin')
        return { isAdmin, isManager, isTeamLead, isAgent, isPlatform, roles: all }
    }, [user])
}
