// Mirrors web/ui/src/shared/itsm/useItsmPermissions.js's manager-capability
// check — the IAM token carries realm/client roles (`Admin`/`org_admin`/
// `super_admin`), not the lowercase itsm-service role names, so a plain
// `realm_roles.includes('manager')` check silently fails for IAM admins.
// The backend remains the real authority; this only drives which buttons
// the mobile RCA modal shows.
const IAM_ADMIN_ROLES = ['Admin', 'org_admin', 'super_admin'];
const ITSM_MANAGER_ROLES = ['manager', 'admin'];

export function isManagerUser(user) {
    if (!user) return false;
    const all = [...(user.realm_roles || []), ...(user.client_roles || [])];
    return !!user.is_admin || all.some(r => IAM_ADMIN_ROLES.includes(r) || ITSM_MANAGER_ROLES.includes(r));
}
