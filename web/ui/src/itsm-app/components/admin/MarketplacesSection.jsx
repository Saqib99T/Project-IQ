import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, Modal } from '../../../shared/itsm/primitives'
import { Badge, Button, useToast } from '../../../shared/itsm/ui'

// Matches app/services/marketplaces/registry.py in itsm-service. No backend
// endpoint lists "known providers" (fixed set, not dynamic data) — same
// duplication as the Orders/Returns pages' filter dropdowns.
const PROVIDERS = [
    // Shopify's authorize URL is per-shop (https://{shop_domain}/admin/oauth/
    // authorize) — the only OAuth connector that needs one extra field
    // before it can redirect at all. needsShopDomain drives ProviderCard to
    // show ShopifyConnectModal instead of a plain "Connect" button.
    { id: 'shopify', label: 'Shopify', oauth: true, needsShopDomain: true },
    { id: 'amazon', label: 'Amazon', oauth: true },
    // Walmart has no OAuth redirect flow — the tenant submits their own
    // Walmart-issued client_id/client_secret directly (see
    // connectors/walmart.py's module docstring). Only connector in this
    // batch shaped this way.
    { id: 'walmart', label: 'Walmart', oauth: false },
    { id: 'ebay', label: 'eBay', oauth: true },
    { id: 'etsy', label: 'Etsy', oauth: true },
    // Messaging-only batch (2026-09-15) — see itsm-service's
    // registry.py/each connector's module docstring for scope +
    // "UNVERIFIED, no live credentials" caveats. OAuth ones (redirect
    // flow) vs formFields ones (client_credentials/API-token submitted
    // directly, same shape as Walmart) drive ProviderCard's branch below.
    { id: 'mercadolibre', label: 'Mercado Libre', oauth: true },
    { id: 'allegro', label: 'Allegro', oauth: true },
    {
        id: 'cdiscount', label: 'Cdiscount', oauth: false,
        formFields: [
            { key: 'seller_id', label: 'Seller ID' },
            { key: 'api_key', label: 'API Key', secret: true },
        ],
    },
    { id: 'lazada', label: 'Lazada', oauth: true },
    {
        id: 'wildberries', label: 'Wildberries', oauth: false,
        formFields: [{ key: 'api_token', label: 'API Token', secret: true }],
        hasEnvironment: true,
    },
    // Thin, email-fallback-only — no native messaging, see connectors/*.py.
    {
        id: 'bolcom', label: 'bol.com', oauth: false,
        formFields: [
            { key: 'client_id', label: 'Client ID' },
            { key: 'client_secret', label: 'Client Secret', secret: true },
        ],
    },
    {
        id: 'zalando', label: 'Zalando', oauth: false,
        formFields: [
            { key: 'client_id', label: 'Client ID' },
            { key: 'client_secret', label: 'Client Secret', secret: true },
        ],
        hasEnvironment: true,
    },
    { id: 'flipkart', label: 'Flipkart', oauth: true },
    // Best Buy / Newegg / Shopee (2026-09-16) — see itsm-service's
    // connectors/{bestbuy,newegg,shopee}.py module docstrings for scope +
    // "UNVERIFIED, no live credentials" caveats.
    {
        id: 'bestbuy', label: 'Best Buy Marketplace', oauth: false,
        formFields: [{ key: 'api_key', label: 'API Key', secret: true }],
    },
    {
        id: 'newegg', label: 'Newegg', oauth: false,
        formFields: [
            { key: 'seller_id', label: 'Seller ID' },
            { key: 'api_key', label: 'API Key', secret: true },
            { key: 'secret_key', label: 'Secret Key', secret: true },
        ],
    },
    { id: 'shopee', label: 'Shopee', oauth: true },
]

const CAPABILITY_LABEL = {
    none: 'No messaging',
    outbound_only: 'Outbound messaging only',
    full: 'Full messaging (unverified)',
}
const CAPABILITY_TONE = { none: 'gray', outbound_only: 'amber', full: 'green' }

function WalmartConnectModal({ open, onClose, onConnected }) {
    const { post } = useItsmApi()
    const { toast } = useToast()
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [environment, setEnvironment] = useState('sandbox')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const submit = async () => {
        setBusy(true); setError(null)
        try {
            const result = await post('/marketplaces/walmart/connect', { client_id: clientId, client_secret: clientSecret, environment })
            if (!result.success) throw new Error(result.error || 'Connection failed')
            toast('Walmart connected', 'success')
            onConnected()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <Modal open={open} onClose={onClose} title="Connect Walmart">
            <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Generate a Client ID and Client Secret in the Walmart Developer Portal
                    (API Keys → Sandbox Keys for testing) and paste them here — Walmart has
                    no consent-screen flow like the other marketplaces.
                </p>
                {error && <ErrorBanner message={error.message} />}
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Client ID
                    <input className="input text-sm mt-1" value={clientId} onChange={e => setClientId(e.target.value)} />
                </label>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Client Secret
                    <input type="password" className="input text-sm mt-1" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
                </label>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Environment
                    <select className="input text-sm mt-1" value={environment} onChange={e => setEnvironment(e.target.value)}>
                        <option value="sandbox">Sandbox</option>
                        <option value="production">Production</option>
                    </select>
                </label>
                <Button onClick={submit} disabled={busy || !clientId || !clientSecret}>Connect</Button>
            </div>
        </Modal>
    )
}

// Collects the one extra field Shopify needs (shop_domain) before it can
// even build an authorize URL — every other OAuth connector here (Amazon,
// eBay, Etsy) needs nothing beyond the click itself. Still redirects via
// window.location.href same as the plain connectOAuth() path, unlike
// Walmart which never leaves the app at all.
function ShopifyConnectModal({ open, onClose, onError }) {
    const { post } = useItsmApi()
    const [shopDomain, setShopDomain] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const submit = async () => {
        setBusy(true); setError(null)
        try {
            const result = await post('/marketplaces/shopify/connect', { shop_domain: shopDomain.trim() })
            if (result.error) throw new Error(result.error)
            window.location.href = result.authorize_url
        } catch (err) { setError(err); setBusy(false); onError?.(err) }
    }

    return (
        <Modal open={open} onClose={onClose} title="Connect Shopify">
            <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Enter the store's myshopify.com domain — you'll be redirected to Shopify's
                    consent screen to approve access.
                </p>
                {error && <ErrorBanner message={error.message} />}
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    Shop domain
                    <input
                        className="input text-sm mt-1"
                        placeholder="your-store.myshopify.com"
                        value={shopDomain}
                        onChange={e => setShopDomain(e.target.value)}
                    />
                </label>
                <Button onClick={submit} disabled={busy || !shopDomain.trim()}>Connect</Button>
            </div>
        </Modal>
    )
}

// Shared by every messaging-only-batch connector that submits credentials
// directly (Cdiscount, Wildberries, bol.com, Zalando) instead of an OAuth
// redirect — one configurable modal rather than 4 near-identical copies.
// Walmart keeps its own dedicated WalmartConnectModal above (pre-dates this
// batch, not touched here to avoid risking already-working code) even
// though its fields would fit this same shape.
function GenericConnectModal({ open, onClose, onConnected, provider }) {
    const { post } = useItsmApi()
    const { toast } = useToast()
    const [values, setValues] = useState({})
    const [environment, setEnvironment] = useState('sandbox')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const setField = (key) => (e) => setValues(v => ({ ...v, [key]: e.target.value }))
    const allFilled = provider.formFields.every(f => (values[f.key] || '').trim())

    const submit = async () => {
        setBusy(true); setError(null)
        try {
            const body = { ...values, ...(provider.hasEnvironment ? { environment } : {}) }
            const result = await post(`/marketplaces/${provider.id}/connect`, body)
            if (result.error || result.success === false) throw new Error(result.error || 'Connection failed')
            toast(`${provider.label} connected`, 'success')
            onConnected()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <Modal open={open} onClose={onClose} title={`Connect ${provider.label}`}>
            <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    UNVERIFIED against a live {provider.label} account — this connector was built directly
                    against {provider.label}'s published docs, not tested end-to-end yet. Connecting here is the
                    actual test.
                </p>
                {error && <ErrorBanner message={error.message} />}
                {provider.formFields.map(f => (
                    <label key={f.key} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        {f.label}
                        <input
                            type={f.secret ? 'password' : 'text'}
                            className="input text-sm mt-1"
                            value={values[f.key] || ''}
                            onChange={setField(f.key)}
                        />
                    </label>
                ))}
                {provider.hasEnvironment && (
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Environment
                        <select className="input text-sm mt-1" value={environment} onChange={e => setEnvironment(e.target.value)}>
                            <option value="sandbox">Sandbox</option>
                            <option value="production">Production</option>
                        </select>
                    </label>
                )}
                <Button onClick={submit} disabled={busy || !allFilled}>Connect</Button>
            </div>
        </Modal>
    )
}

// Each card owns its own connection fetch (one useItsmResource call per
// mounted instance) rather than the parent calling the hook once per
// provider inside a .map() — PROVIDERS is a stable constant so that would
// likely have worked in practice, but this way there's no rules-of-hooks
// question to reason about at all, and each card reloads independently
// without needing a parent-held array of resource objects.
function ProviderCard({ provider }) {
    const { get, post, remove } = useItsmApi()
    const { toast } = useToast()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [showWalmartModal, setShowWalmartModal] = useState(false)
    const [showShopifyModal, setShowShopifyModal] = useState(false)
    const [showGenericModal, setShowGenericModal] = useState(false)

    const { data, loading, reload } = useItsmResource(
        () => get(`/marketplaces/${provider.id}/connection`), [get, provider.id],
    )
    const connection = data?.connection

    const connected = connection?.status === 'connected'

    const connectOAuth = async () => {
        setBusy(true); setError(null)
        try {
            const result = await post(`/marketplaces/${provider.id}/connect`, {})
            if (result.error) throw new Error(result.error)
            // Real top-level redirect — the marketplace's consent screen
            // requires this, an XHR/fetch can't complete an OAuth redirect
            // (same constraint noted in both repos' OAuth route docstrings).
            window.location.href = result.authorize_url
        } catch (err) { setError(err); setBusy(false) }
    }

    const disconnect = async () => {
        setBusy(true); setError(null)
        try {
            await remove(`/marketplaces/${provider.id}/connection`)
            toast(`${provider.label} disconnected`, 'info')
            reload()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    const syncNow = async (kind) => {
        setBusy(true); setError(null)
        try {
            const result = await post(`/marketplaces/${provider.id}/sync?kind=${kind}`, {})
            if (result.error) throw new Error(result.error)
            toast(
                kind === 'orders'
                    ? `Synced ${result.synced ?? 0} orders`
                    : `Created ${result.tickets_created ?? 0} return/replacement tickets`,
                'success',
            )
            reload()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    if (loading) return <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50"><LoadingSpinner /></div>

    return (
        <div className="flex items-center justify-between gap-3 text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50">
            <div className="min-w-0">
                <div className="flex items-center gap-2">
                    <p className="font-medium text-slate-700 dark:text-slate-300">{provider.label}</p>
                    <Badge tone={connected ? 'green' : 'gray'}>{connected ? 'Connected' : 'Not connected'}</Badge>
                    {connected && connection.messaging_capability && (
                        <Badge tone={CAPABILITY_TONE[connection.messaging_capability] || 'gray'}>
                            {CAPABILITY_LABEL[connection.messaging_capability] || connection.messaging_capability}
                        </Badge>
                    )}
                </div>
                {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error.message}</p>}
                {connected && connection.last_synced_at && (
                    <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Last synced {new Date(connection.last_synced_at).toLocaleString()}</p>
                )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
                {connected ? (
                    <>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => syncNow('orders')}>Sync orders</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => syncNow('returns')}>Sync returns</Button>
                        <Button variant="secondary" size="sm" disabled={busy} onClick={disconnect}>Disconnect</Button>
                    </>
                ) : provider.needsShopDomain ? (
                    <>
                        <Button size="sm" disabled={busy} onClick={() => setShowShopifyModal(true)}>Connect</Button>
                        <ShopifyConnectModal open={showShopifyModal} onClose={() => setShowShopifyModal(false)} onError={setError} />
                    </>
                ) : provider.formFields ? (
                    <>
                        <Button size="sm" disabled={busy} onClick={() => setShowGenericModal(true)}>Connect</Button>
                        <GenericConnectModal
                            open={showGenericModal}
                            provider={provider}
                            onClose={() => setShowGenericModal(false)}
                            onConnected={() => { setShowGenericModal(false); reload() }}
                        />
                    </>
                ) : provider.oauth ? (
                    <Button size="sm" disabled={busy} onClick={connectOAuth}>Connect</Button>
                ) : (
                    <>
                        <Button size="sm" disabled={busy} onClick={() => setShowWalmartModal(true)}>Connect</Button>
                        <WalmartConnectModal open={showWalmartModal} onClose={() => setShowWalmartModal(false)} onConnected={() => { setShowWalmartModal(false); reload() }} />
                    </>
                )}
            </div>
        </div>
    )
}

export default function MarketplacesSection() {
    const { get, put } = useItsmApi()
    const { toast } = useToast()
    const [savingSettings, setSavingSettings] = useState(false)

    const { data: settingsData, loading: settingsLoading, reload: reloadSettings } = useItsmResource(
        () => get('/marketplaces/settings'), [get],
    )

    const enabledMarketplaces = settingsData?.settings?.enabled_marketplaces || []
    const toggleEnabled = async (providerId) => {
        const next = enabledMarketplaces.includes(providerId)
            ? enabledMarketplaces.filter(p => p !== providerId)
            : [...enabledMarketplaces, providerId]
        setSavingSettings(true)
        try {
            await put('/marketplaces/settings', { settings: { ...settingsData.settings, enabled_marketplaces: next } })
            reloadSettings()
        } catch (err) { toast(err.message, 'error') } finally { setSavingSettings(false) }
    }

    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Enabled marketplaces</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Which marketplaces this tenant syncs orders/returns from — tenant-level only, no org-wide default (§0a of the native-connector plan).
                </p>
                {settingsLoading ? <LoadingSpinner /> : (
                    <div className="mt-2 flex flex-wrap gap-3">
                        {PROVIDERS.map(p => (
                            <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    disabled={savingSettings}
                                    checked={enabledMarketplaces.includes(p.id)}
                                    onChange={() => toggleEnabled(p.id)}
                                />
                                {p.label}
                            </label>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Connections</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-2">
                    None of these have been verified against a live account yet — connecting is the actual test.
                </p>
                <div className="space-y-1.5">
                    {PROVIDERS.map(p => <ProviderCard key={p.id} provider={p} />)}
                </div>
            </div>
        </div>
    )
}
