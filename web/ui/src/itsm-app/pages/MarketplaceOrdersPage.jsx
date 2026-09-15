import { useState } from 'react'
import { ShoppingCart, RefreshCw, ExternalLink, MessageSquare } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { PageHeader, FilterBar, DataTable, Pagination, Badge, Button, useToast } from '../../shared/itsm/ui'
import SendBuyerMessageModal from '../../shared/itsm/SendBuyerMessageModal'

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
    const { get, post } = useItsmApi()
    const { toast } = useToast()
    const [provider, setProvider] = useState('')
    const [status, setStatus] = useState('')
    const [placedFrom, setPlacedFrom] = useState('')
    const [placedTo, setPlacedTo] = useState('')
    const [offset, setOffset] = useState(0)
    const [syncing, setSyncing] = useState(false)
    const [messagingOrderId, setMessagingOrderId] = useState(null)
    const limit = 50

    const { data, loading, error, reload } = useItsmResource(
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

    // Hits /marketplaces/sync (all connected providers at once), distinct
    // from the admin Marketplaces section's per-provider "Sync orders"
    // button (POST /marketplaces/{provider}/sync). Same underlying
    // ingestion.map_order() either way — it upserts by (tenant, provider,
    // external_order_id), so this also picks up status/total/line-item
    // changes on orders already synced, not just brand-new ones.
    const syncAll = async () => {
        setSyncing(true)
        try {
            const result = await post('/marketplaces/sync?kind=orders', {})
            if (result.error) throw new Error(result.error)
            const failed = (result.results || []).filter(r => r.error)
            const totalSynced = (result.results || []).reduce((sum, r) => sum + (r.synced || 0), 0)
            if (failed.length) {
                toast(`Synced ${totalSynced} orders, ${failed.length} marketplace(s) failed`, 'error')
            } else if (!result.results?.length) {
                toast('No connected marketplaces to sync', 'info')
            } else {
                toast(`Synced ${totalSynced} orders across ${result.results.length} marketplace(s)`, 'success')
            }
            reload()
        } catch (err) {
            toast(err.message, 'error')
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Marketplace Orders"
                subtitle="Orders synced from every connected marketplace, native connectors (V3-Marketplaces)."
                icon={ShoppingCart}
                actions={
                    <Button variant="secondary" size="sm" disabled={syncing} onClick={syncAll}>
                        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                        {syncing ? 'Syncing…' : 'Sync now'}
                    </Button>
                }
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
                    {
                        key: 'external_order_id', header: 'Order ID',
                        // Links out to the real record in the marketplace's
                        // own seller UI (Shopify Admin, Amazon Seller
                        // Central, ...) when the backend could build one —
                        // see connectors/*.order_url() in itsm-service for
                        // per-marketplace confidence notes (Shopify/Amazon
                        // are well-established; eBay/Walmart are best-effort
                        // guesses, not confirmed). Plain text, no link, when
                        // external_url is null (e.g. no connection on record).
                        render: (o) => o.external_url ? (
                            <a
                                href={o.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                                {o.external_order_id}
                                <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                        ) : <span className="font-mono text-xs">{o.external_order_id}</span>,
                    },
                    { key: 'status', header: 'Status', render: (o) => <Badge tone={STATUS_TONE[o.status] || 'gray'}>{o.status}</Badge> },
                    { key: 'total_amount', header: 'Total', render: (o) => formatMoney(o.total_amount, o.currency) },
                    {
                        key: 'buyer', header: 'Buyer',
                        // Prefer the display name (buyer_name) — email is
                        // frequently unavailable per-marketplace (Amazon
                        // needs separate PII access, eBay doesn't expose it
                        // at all) while a name is usually there. Falls back
                        // to email only when no name was captured, then '—'.
                        render: (o) => o.buyer_name || o.buyer_email || '—',
                    },
                    { key: 'placed_at', header: 'Placed', render: (o) => formatDate(o.placed_at) },
                    {
                        // Shown for every provider — the backend tries the
                        // native marketplace API where one exists and falls
                        // back to emailing the order's captured buyer_email
                        // otherwise (see SendBuyerMessageModal's header
                        // comment). No point pre-filtering by provider on
                        // the frontend when capability now depends on
                        // per-order data (buyer_email), not just provider identity.
                        key: 'message', header: '',
                        render: (o) => (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setMessagingOrderId(o.id) }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-surface2"
                                title="Message buyer"
                            >
                                <MessageSquare className="w-4 h-4" />
                            </button>
                        ),
                    },
                ]}
            />

            <Pagination
                label={`${items.length ? offset + 1 : 0}–${offset + items.length} of ${total}`}
                hasPrev={offset > 0}
                hasNext={offset + limit < total}
                onPrev={() => setOffset(o => Math.max(0, o - limit))}
                onNext={() => setOffset(o => o + limit)}
            />

            <SendBuyerMessageModal
                open={messagingOrderId != null}
                orderId={messagingOrderId}
                onClose={() => setMessagingOrderId(null)}
            />
        </div>
    )
}
