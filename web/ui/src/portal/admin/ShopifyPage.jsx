import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../useApi'

// Same status-pill pattern as IntegrationPage.jsx's StatusBadge.
function StatusBadge({ ok, okLabel = 'Connected', offLabel = 'Not connected' }) {
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ok
            ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'}`}>
            {ok ? okLabel : offLabel}
        </span>
    )
}

// Connect/status/disconnect for a tenant's Shopify store — order lookup only
// (Phase 1 of docs/SHOPIFY_INTEGRATION_PLAN.md). useApi() already attaches the
// caller's IAM token + X-Org-Id (for the platform tenant-switcher) to every
// call, matching bp_shopify.py's use of caller_org_scope().
export default function ShopifyPage() {
    const { call } = useApi()
    const [connection, setConnection] = useState(null)
    const [loading, setLoading] = useState(true)
    const [shopDomain, setShopDomain] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        setLoading(true)
        call('/admin/shopify/connection')
            .then(d => setConnection(d.connection))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [call])

    useEffect(() => { load() }, [load])

    // Land back here after the OAuth callback redirect (bp_shopify.py sends
    // /portal/admin/shopify?connected=1) and refresh so the new connection shows up.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('connected') === '1') {
            window.history.replaceState({}, '', '/portal/admin/shopify')
            load()
        }
    }, [load])

    const connect = async () => {
        if (!shopDomain.trim()) { setError('Enter your shop domain first'); return }
        setBusy(true); setError(null)
        try {
            const { authorize_url } = await call('/admin/shopify/connect', {
                method: 'POST',
                body: JSON.stringify({ shop_domain: shopDomain.trim() }),
            })
            // Real top-level navigation — Shopify's OAuth consent screen
            // requires this, not an XHR redirect.
            window.location.href = authorize_url
        } catch (e) {
            setError(e.message)
            setBusy(false)
        }
    }

    const disconnect = async () => {
        if (!window.confirm('Disconnect this Shopify store? Order lookup will stop working until reconnected.')) return
        setBusy(true)
        try { await call('/admin/shopify/connection', { method: 'DELETE' }); await load() }
        catch (e) { setError(e.message) }
        finally { setBusy(false) }
    }

    const isConnected = connection?.status === 'connected'

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Shopify</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                    Connect a Shopify store so the chatbot can look up order status for your customers.
                </p>
            </div>

            {error && <div className="card p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{error}</div>}

            {loading ? (
                <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>
            ) : (
                <div className="card p-5 space-y-4">
                    <div className="flex items-start gap-3">
                        <span className="text-2xl">🛍️</span>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Shopify store</h4>
                                <StatusBadge ok={isConnected} offLabel={connection?.status === 'disconnected' ? 'Disconnected' : 'Not connected'} />
                            </div>
                            {isConnected && (
                                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 font-mono truncate">{connection.shop_domain}</p>
                            )}
                        </div>
                    </div>

                    {!isConnected ? (
                        <div className="flex gap-2">
                            <input
                                value={shopDomain}
                                onChange={e => setShopDomain(e.target.value)}
                                placeholder="your-store.myshopify.com"
                                className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono"
                            />
                            <button onClick={connect} disabled={busy} className="btn-primary text-sm px-4 py-2 disabled:opacity-50">
                                {busy ? 'Connecting…' : 'Connect'}
                            </button>
                        </div>
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
