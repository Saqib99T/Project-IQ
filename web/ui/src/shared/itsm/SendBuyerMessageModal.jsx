import { useState } from 'react'
import { useItsmApi } from './useItsmApi'
import { Modal, ErrorBanner } from './primitives'
import { Button, useToast } from './ui'

// Shared by MarketplaceOrdersPage and MarketplaceReturnsPage — one modal,
// not two copies, since both pages need the exact same "send a message to
// this order's buyer" flow. Only shown for providers with SOME messaging
// path (see MESSAGING_PROVIDERS in each page) — Shopify/Etsy/Walmart have
// no buyer-messaging API at all (confirmed platform limitations, itsm-
// service's connectors/*.py), so there's no point offering a button that
// can never work there.
//
// Amazon and eBay both currently fail every real send attempt for reasons
// OUTSIDE this code (Amazon: 403, Messaging role not granted to this app in
// Seller Central; eBay: the send endpoint is documented as unsupported in
// Sandbox entirely) — see marketplace_sync.py's send_message_to_buyer()
// docstring in itsm-service. The modal still works correctly end-to-end;
// it just can't complete a live send against either connected sandbox
// account yet. The real error message from POST .../send-message surfaces
// directly in the toast so that's visible rather than hidden.
export default function SendBuyerMessageModal({ open, onClose, orderId }) {
    const { post } = useItsmApi()
    const { toast } = useToast()
    const [message, setMessage] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const close = () => { setMessage(''); setError(null); onClose() }

    const send = async () => {
        setBusy(true); setError(null)
        try {
            const result = await post(`/marketplaces/orders/${orderId}/send-message`, { message })
            if (result.error) throw new Error(result.error)
            toast('Message sent to buyer', 'success')
            close()
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
                    <Button variant="secondary" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                    <Button size="sm" onClick={send} disabled={busy || !message.trim()}>
                        {busy ? 'Sending…' : 'Send'}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}
