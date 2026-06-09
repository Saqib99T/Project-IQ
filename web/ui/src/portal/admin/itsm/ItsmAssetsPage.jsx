import { useItsmApi, useItsmResource, useTenantDirectory } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { AssetCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

export default function ItsmAssetsPage() {
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const tenantNames = useTenantDirectory(tenantId === null)

    const { data, loading, error, reload } = useItsmResource(
        () => get('/assets'),
        [get]
    )
    const assets = data?.assets || data?.items || []

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500 dark:text-slate-400">{assets.length} asset{assets.length === 1 ? '' : 's'}</p>
                <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                assets.length === 0
                    ? <EmptyState>No assets found.</EmptyState>
                    : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {assets.map(a => <AssetCard key={a.id} asset={a} tenantNames={tenantId === null ? tenantNames : null} />)}
                        </div>
                    )
            )}
        </div>
    )
}
