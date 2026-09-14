import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, Modal } from '../../../shared/itsm/primitives'
import { Badge, Button, useToast } from '../../../shared/itsm/ui'

// Matches app/services/marketplaces/registry.py in itsm-service. No backend
// endpoint lists "known providers" (fixed set, not dynamic data) — same
// duplication as the Orders/Returns pages' filter dropdowns.
const PROVIDERS = [
    { id: 'shopify', label: 'Shopify', oauth: true },
    { id: 'amazon', label: 'Amazon', oauth: true },
    // Walmart has no OAuth redirect flow — the tenant submits their own
    // Walmart-issued client_id/client_secret directly (see
    // connectors/walmart.py's module docstring). Only connector in this
    // batch shaped this way.
    { id: 'walmart', label: 'Walmart', oauth: false },
    { id: 'ebay', label: 'eBay', oauth: true },
    { id: 'etsy', label: 'Etsy', oauth: true },
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
