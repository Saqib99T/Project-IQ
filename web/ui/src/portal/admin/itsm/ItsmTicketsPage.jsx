import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { TicketCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'pending', 'resolved', 'closed']

export default function ItsmTicketsPage() {
    const navigate = useNavigate()
    const location = useLocation()
    // Route-aware: list renders under /admin/itsm and /operator/tickets.
    const detailBase = location.pathname.startsWith('/operator') ? '/operator/tickets' : '/admin/itsm/tickets'
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const tenantNames = useTenantDirectory(tenantId === null)
    const [status, setStatus] = useState('all')
    const [productId, setProductId] = useState('all')

    // Tenant's products (slug-keyed projection of IAM subscriptions) for the filter.
    const [products, setProducts] = useState([])
    useEffect(() => {
        let cancelled = false
        get('/tenant/products')
            .then(rows => { if (!cancelled) setProducts(Array.isArray(rows) ? rows : []) })
            .catch(() => { if (!cancelled) setProducts([]) })
        return () => { cancelled = true }
    }, [get])

    const { data, loading, error, reload } = useItsmResource(
        () => get('/tickets', {
            ...(status === 'all' ? {} : { status }),
            ...(productId === 'all' ? {} : { product_id: productId }),
        }),
        [get, status, productId]
    )
    const tickets = data?.tickets || data?.items || []

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                    {STATUS_FILTERS.map(s => (
                        <button
                            key={s}
                            onClick={() => setStatus(s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                                status === s
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            {s.replace(/_/g, ' ')}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    {products.length > 0 && (
                        <select
                            value={productId}
                            onChange={e => setProductId(e.target.value)}
                            className="form-input text-xs py-1.5 rounded-lg"
                            title="Filter by product"
                        >
                            <option value="all">All Products</option>
                            {products.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    )}
                    <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
                </div>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                tickets.length === 0
                    ? <EmptyState>No tickets found{status !== 'all' ? ` with status "${status.replace(/_/g, ' ')}"` : ''}.</EmptyState>
                    : (
                        <div className="space-y-2.5">
                            {tickets.map(t => (
                                <TicketCard key={t.id} ticket={t} onClick={() => navigate(`${detailBase}/${t.id}`)} tenantNames={tenantId === null ? tenantNames : null} />
                            ))}
                        </div>
                    )
            )}
        </div>
    )
}
