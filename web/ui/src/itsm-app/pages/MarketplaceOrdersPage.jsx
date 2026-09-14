import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { PageHeader, FilterBar, DataTable, Pagination, Badge } from '../../shared/itsm/ui'

// Matches the registry in itsm-service's app/services/marketplaces/registry.py
// — no backend endpoint to list "known providers" exists (they're a fixed set,
// not dynamic data), so this is duplicated here rather than fetched.
const PROVIDERS = ['shopify', 'amazon', 'walmart', 'ebay', 'etsy']
const ORDER_STATUSES = ['new', 'acknowledged', 'shipped', 'delivered', 'cancelled']

const STATUS_TONE = {
    new: 'blue', acknowledged: 'indigo', shipped: 'amber', delivered: 'green', cancelled: 'red',
}

function formatMoney(amount, currency) {
    if (amount == null) return '—'
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount) }
    catch { return `${amount} ${currency || ''}`.trim() }
}

function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : '—'
}

export default function MarketplaceOrdersPage() {
    const { get } = useItsmApi()
    const [provider, setProvider] = useState('')
    const [status, setStatus] = useState('')
    const [placedFrom, setPlacedFrom] = useState('')
    const [placedTo, setPlacedTo] = useState('')
    const [offset, setOffset] = useState(0)
    const limit = 50

    const { data, loading, error } = useItsmResource(
        () => get('/marketplaces/orders', {
            provider: provider || undefined,
            status: status || undefined,
            placed_from: placedFrom ? new Date(placedFrom).toISOString() : undefined,
            placed_to: placedTo ? new Date(placedTo).toISOString() : undefined,
            limit,
            offset,
        }),
        [get, provider, status, placedFrom, placedTo, offset],
    )
    const items = data?.items || []
    const total = data?.total ?? 0

    // Any filter change resets to page 1 — a stale offset combined with a
    // narrower filter can otherwise land on an empty page that looks like
    // "no orders" when there actually are some, just on page 1.
    const setFilter = (setter) => (value) => { setter(value); setOffset(0) }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Marketplace Orders"
                subtitle="Orders synced from every connected marketplace, native connectors (V3-Marketplaces)."
                icon={ShoppingCart}
            />

            <FilterBar>
                <select className="input text-sm w-auto" value={provider} onChange={e => setFilter(setProvider)(e.target.value)}>
                    <option value="">All marketplaces</option>
                    {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="input text-sm w-auto" value={status} onChange={e => setFilter(setStatus)(e.target.value)}>
                    <option value="">All statuses</option>
                    {ORDER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="date" className="input text-sm w-auto" value={placedFrom} onChange={e => setFilter(setPlacedFrom)(e.target.value)} title="Placed on/after" />
                <span className="text-xs text-slate-400">to</span>
                <input type="date" className="input text-sm w-auto" value={placedTo} onChange={e => setFilter(setPlacedTo)(e.target.value)} title="Placed on/before" />
            </FilterBar>

            <DataTable
                loading={loading}
                empty={error ? error.message : 'No orders synced yet — connect a marketplace and run a sync from Administration → Marketplaces.'}
                rowKey="id"
                rows={items}
                columns={[
                    { key: 'provider', header: 'Marketplace', render: (o) => <span className="capitalize">{o.provider}</span> },
                    { key: 'external_order_id', header: 'Order ID', render: (o) => <span className="font-mono text-xs">{o.external_order_id}</span> },
                    { key: 'status', header: 'Status', render: (o) => <Badge tone={STATUS_TONE[o.status] || 'gray'}>{o.status}</Badge> },
                    { key: 'total_amount', header: 'Total', render: (o) => formatMoney(o.total_amount, o.currency) },
                    { key: 'buyer_email', header: 'Buyer', render: (o) => o.buyer_email || '—' },
                    { key: 'placed_at', header: 'Placed', render: (o) => formatDate(o.placed_at) },
                ]}
            />

            <Pagination
                label={`${items.length ? offset + 1 : 0}–${offset + items.length} of ${total}`}
                hasPrev={offset > 0}
                hasNext={offset + limit < total}
                onPrev={() => setOffset(o => Math.max(0, o - limit))}
                onNext={() => setOffset(o => o + limit)}
            />
        </div>
    )
}
