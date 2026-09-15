import { useState } from 'react'
import { useItsmApi, useItsmResource } from './useItsmApi'
import { Modal, ErrorBanner, LoadingSpinner } from './primitives'
import { Button, Badge, useToast } from './ui'

const DIRECTION_TONE = { outbound: 'blue', inbound: 'green' }

function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : '—'
}

// Shared by MarketplaceOrdersPage, MarketplaceReturnsPage, and
// MarketplaceMessagesPage — one modal, not three copies. Originally just a
// blind "send a message" compose box; now also shows this order's full
// thread (GET /marketplaces/messages?order_id=...) above it, so opening it
// from an Order or a Return/Replacement row actually answers "what's been
// said about this order" in context, not just "fire a message and hope" —
// no new backend endpoint needed, GET /marketplaces/messages already
// supported order_id filtering from when the standalone Messaging page was
// built (2026-09-14).
//
// Shown for every provider now (2026-09-14) — the backend's
// send_message_to_buyer() tries the native marketplace API first where one
// exists, and falls back to a plain email to the order's captured
// buyer_email when the native path is unavailable/blocked. Real and
// working TODAY for Shopify/Etsy/Walmart (all three capture a genuine
// buyer email — no marketplace messaging API needed at all). Amazon/eBay
// still try their native send first (403 / sandbox-unsupported right now,
// see marketplace_sync.py's docstring in itsm-service) and fall back to
// email too whenever buyer_email happens to be populated for that specific
// order. Either way, the real error/success reason comes back from the
// backend and surfaces here — nothing pre-filtered on the frontend by
// provider identity anymore.
// The modal still works correctly end-to-end; it just can't complete a live
// send against either connected sandbox account yet, and there's no real
// inbound data anywhere to show. The real error message from
// POST .../send-message surfaces directly in the toast rather than being
// hidden.
export default function SendBuyerMessageModal({ open, onClose, orderId }) {
    const { get, post } = useItsmApi()
    const { toast } = useToast()
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const { data, loading: threadLoading, reload: reloadThread } = useItsmResource(
        () => (open && orderId) ? get('/marketplaces/messages', { order_id: orderId, limit: 100 }) : Promise.resolve({ items: [] }),
        [open, orderId, get],
    )
    // Oldest first for a natural top-to-bottom conversation read order —
    // the backend returns newest-first (matches the Messaging page's list).
    const thread = [...(data?.items || [])].reverse()

    const close = () => { setMessage(''); setError(null); onClose() }

    const send = async () => {
        setBusy(true); setError(null)
        try {
            const result = await post(`/marketplaces/orders/${orderId}/send-message`, { message })
            if (result.error) throw new Error(result.error)
            // channel is the provider name (native marketplace API) or
            // 'email' (fallback to the buyer's captured order email, when
            // the native path is unavailable/blocked — see
            // send_message_to_buyer()'s docstring in itsm-service).
            toast(result.channel === 'email' ? 'Message emailed to buyer' : 'Message sent to buyer', 'success')
            setMessage('')
            reloadThread()
        } catch (err) {
            setError(err)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal open={open} onClose={close} title="Message buyer">
            <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sends through the marketplace's own messaging channel — the buyer sees this as coming
                    from the seller, not from ITSM. Also recorded as a comment on the linked ticket, if one exists.
                </p>

                <div className="max-h-64 overflow-y-auto space-y-2 border border-bordc rounded-lg p-2">
                    {threadLoading ? (
                        <LoadingSpinner />
                    ) : thread.length === 0 ? (
                        <p className="text-xs text-slate-400 text-center py-3">No messages yet for this order.</p>
                    ) : (
                        thread.map(m => (
                            <div key={m.id} className="text-sm p-2 rounded-lg bg-surface2">
                                <div className="flex items-center gap-2 mb-1">
                                    <Badge tone={DIRECTION_TONE[m.direction] || 'gray'}>{m.direction}</Badge>
                                    <span className="text-xs text-slate-400">{formatDate(m.sent_at)}</span>
                                </div>
                                <p className="whitespace-pre-wrap">{m.body}</p>
                            </div>
                        ))
                    )}
                </div>

                {error && <ErrorBanner message={error.message} />}
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Message
                    <textarea
                        className="input text-sm mt-1 min-h-[6rem]"
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        placeholder="Type your message to the buyer..."
                    />
                </label>
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={close} disabled={busy}>Close</Button>
                    <Button size="sm" onClick={send} disabled={busy || !message.trim()}>
                        {busy ? 'Sending…' : 'Send'}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}
