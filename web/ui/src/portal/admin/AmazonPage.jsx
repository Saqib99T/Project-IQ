import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

// Same status-pill pattern as ShopifyPage.jsx's StatusBadge.
function StatusBadge({ ok, okLabel = 'Connected', offLabel = 'Not connected' }) {
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ok
            ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'}`}>
            {ok ? okLabel : offLabel}
        </span>
    )
}

// Connect/status/disconnect for a tenant's Amazon seller account — order
// lookup only (Phase 0a/3 of docs/AMAZON_INTEGRATION_PLAN.md; refund/cancel
// blocked on Feeds API access, Phase 0b). Mirrors ShopifyPage.jsx, minus the
// shop-domain input — Amazon's consent flow needs no input from the seller
// before redirecting, just the app's own app_id.
export default function AmazonPage() {
    const { call } = useApi()
    const [connection, setConnection] = useState(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        setLoading(true)
        call('/admin/amazon/connection')
            .then(d => setConnection(d.connection))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call])

    useEffect(() => { load() }, [load])

    // Land back here after the OAuth callback redirect (routes.py sends
    // /portal/admin/amazon?connected=1) and refresh so the new connection shows up.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('connected') === '1') {
            window.history.replaceState({}, '', '/portal/admin/amazon')
            load()
        } else if (params.get('amazon_error')) {
            setError(`Connection failed: ${params.get('amazon_error')}`)
            window.history.replaceState({}, '', '/portal/admin/amazon')
        }
    }, [load])

    const connect = async () => {
        setBusy(true); setError(null)
        try {
            const { authorize_url } = await call('/admin/amazon/connect', { method: 'POST' })
            // Real top-level navigation — Amazon's seller-consent screen
            // requires this, not an XHR redirect.
            window.location.href = authorize_url
        } catch (e) {
            setError(e.message)
            setBusy(false)
        }
    }

    const disconnect = async () => {
        if (!window.confirm('Disconnect this Amazon seller account? Order lookup will stop working until reconnected.')) return
        setBusy(true)
        try { await call('/admin/amazon/connection', { method: 'DELETE' }); await load() }
        catch (e) { setError(e.message) }
        finally { setBusy(false) }
    }

    const isConnected = connection?.status === 'connected'

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Amazon</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                    Connect an Amazon seller account so the chatbot can look up order status for your customers.
                    Currently Sandbox-only — see docs/AMAZON_INTEGRATION_PLAN.md.
                </p>
            </div>

            {error && <div className="card p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

            {loading ? (
                <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>
            ) : (
                <div className="card p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <span className="text-2xl">📦</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Amazon seller account</h4>
                                <StatusBadge ok={isConnected} offLabel={connection?.status === 'disconnected' ? 'Disconnected' : 'Not connected'} />
                            </div>
                            {isConnected && (
                                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 font-mono truncate">
                                    {connection.seller_id || 'seller id pending'} · {connection.marketplace_ids}
                                </p>
                            )}
                        </div>
                    </div>

                    {!isConnected ? (
                        <button onClick={connect} disabled={busy} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
                            {busy ? 'Connecting…' : 'Connect Amazon account'}
                        </button>
                    ) : (
                        <button onClick={disconnect} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg text-red-500 hover:underline">
                            Disconnect
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
