import { useEffect, useState } from 'react'
import { useItsmApi, type TenantEntry, type TenantListResponse } from './useItsmApi'

export interface TenantSwitcherProps {
    value: string | null | undefined
    onChange: (tenantId: string | null) => void
}

/**
 * Lets a platform (super_admin) user pick which tenant's ITSM data to view.
 * Selecting a tenant feeds its id back via onChange — callers then pass that
 * id as `tenantId` to useItsmApi() so requests carry X-Tenant-ID.
 *
 * Calls /platform/tenants — itsm-service only allows this for platform_admin/support.
 */
export function TenantSwitcher({ value, onChange }: TenantSwitcherProps) {
    const { get } = useItsmApi()
    const [tenants, setTenants] = useState<TenantEntry[]>([])
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        get<TenantListResponse>('/platform/tenants')
            .then(data => { if (!cancelled) setTenants(data.tenants || data.items || []) })
            .catch((e: Error) => { if (!cancelled) setError(e.message) })
        return () => { cancelled = true }
    }, [get])

    if (error) {
        return <p className="text-xs text-red-600 dark:text-red-400">Failed to load tenants: {error}</p>
    }

    return (
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value || null)}
            className="input text-sm py-1.5 max-w-[16rem]"
        >
            <option value="">All tenants (cross-tenant view)</option>
            {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name || t.alias || t.id}</option>
            ))}
        </select>
    )
}
