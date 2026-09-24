import { useState } from 'react'
import { MessageCircle, ExternalLink, Reply } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { PageHeader, FilterBar, DataTable, Pagination, Badge } from '../../shared/itsm/ui'
import SendBuyerMessageModal from '../../shared/itsm/SendBuyerMessageModal'

// See MarketplaceOrdersPage.jsx's own copy of PROVIDERS for why this is
// duplicated rather than fetched from a "known providers" endpoint (no such
// endpoint exists — fixed set, not dynamic data).
// Scoped to exactly 7 marketplaces (2026-09-18) — see
// MarketplacesSection.jsx's PROVIDERS comment for why the rest are hidden,
// not removed.
const PROVIDERS = ['shopify', 'amazon', 'walmart', 'ebay', 'bestbuy', 'temu', 'tiktokshop']
const DIRECTIONS = ['outbound', 'inbound']
const DIRECTION_TONE = { outbound: 'blue', inbound: 'green' }

function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : '—'
}

// Dedicated cross-order messaging history — every send from the "Message
// buyer" action on the Orders/Returns pages lands here too (itsm-service's
// marketplace_messages table, independent of whether the order has a
// linked return/replacement ticket — see that migration's docstring for
// why a message on a plain order needed its own record at all). This page
// is read history + reply-in-place; starting a BRAND NEW conversation for
// an order that has no messages yet still happens from the Orders/Returns
// pages' own "Message buyer" icon, not from here — no order-picker was
// built for this page, kept in scope as a history+reply view rather than a
// full compose-from-scratch inbox.
export default function MarketplaceMessagesPage() {
    const { get } = useItsmApi()
    const [provider, setProvider] = useState('')
    const [direction, setDirection] = useState('')
    const [sentFrom, setSentFrom] = useState('')
    const [sentTo, setSentTo] = useState('')
    const [offset, setOffset] = useState(0)
    const [replyOrderId, setReplyOrderId] = useState(null)
    const limit = 50

    const { data, loading, error, reload } = useItsmResource(
        () => get('/marketplaces/messages', {
            provider: provider || undefined,
            direction: direction || undefined,
            sent_from: sentFrom ? new Date(sentFrom).toISOString() : undefined,
            sent_to: sentTo ? new Date(sentTo).toISOString() : undefined,
            limit,
            offset,
        }),
        [get, provider, direction, sentFrom, sentTo, offset],
    )
    const items = data?.items || []
    const total = data?.total ?? 0

    const setFilter = (setter) => (value) => { setter(value); setOffset(0) }

    return (
        <div className="space-y-4">
            <PageHeader
                title="Messaging"
                subtitle="Buyer communication across every connected marketplace — outbound sends and, once built, inbound replies."
                icon={MessageCircle}
            />

            <FilterBar>
                <select className="input text-sm w-auto" value={provider} onChange={e => setFilter(setProvider)(e.target.value)}>
                    <option value="">All marketplaces</option>
                    {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="input text-sm w-auto" value={direction} onChange={e => setFilter(setDirection)(e.target.value)}>
                    <option value="">Outbound + inbound</option>
                    {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <input type="date" className="input text-sm w-auto" value={sentFrom} onChange={e => setFilter(setSentFrom)(e.target.value)} title="Sent on/after" />
                <span className="text-xs text-slate-400">to</span>
                <input type="date" className="input text-sm w-auto" value={sentTo} onChange={e => setFilter(setSentTo)(e.target.value)} title="Sent on/before" />
            </FilterBar>

            <DataTable
                loading={loading}
                empty={error ? error.message : 'No messages yet — use "Message buyer" from the Orders or Returns page to send the first one.'}
                rowKey="id"
                rows={items}
                columns={[
                    { key: 'direction', header: '', render: (m) => <Badge tone={DIRECTION_TONE[m.direction] || 'gray'}>{m.direction}</Badge> },
                    { key: 'provider', header: 'Marketplace', render: (m) => <span className="capitalize">{m.order.provider}</span> },
                    {
                        key: 'order', header: 'Order',
                        render: (m) => m.order.external_url ? (
                            <a
                                href={m.order.external_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1"
                            >
                                {m.order.external_order_id}
                                <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                        ) : <span className="font-mono text-xs">{m.order.external_order_id}</span>,
                    },
                    { key: 'buyer', header: 'Buyer', render: (m) => m.order.buyer_name || m.order.buyer_email || '—' },
                    { key: 'body', header: 'Message', render: (m) => <span className="truncate max-w-md block">{m.body}</span> },
                    { key: 'sent_at', header: 'Sent', render: (m) => formatDate(m.sent_at) },
                    {
                        key: 'reply', header: '',
                        render: (m) => (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setReplyOrderId(m.order.id) }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-surface2"
                                title="Reply"
                            >
                                <Reply className="w-4 h-4" />
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
                open={replyOrderId != null}
                orderId={replyOrderId}
                onClose={() => { setReplyOrderId(null); reload() }}
            />
        </div>
    )
}
