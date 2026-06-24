import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../useApi'
import { useItsmApi, useTenantDirectory } from '../../shared/itsm/useItsmApi'

// ── Managed services (read-only "Connected" cards) ─────────────────────────────
// Status is derived from the platform config (/admin/config) — a key being set
// means the service is wired. These are not installable; they're shown so the
// marketplace reflects everything the platform is already integrated with.
const MANAGED = [
    { key: 'identity', name: 'Identity & SSO', icon: '🔐', desc: 'Keycloak single sign-on', anySet: ['keycloak_url'] },
    { key: 'storage',  name: 'File storage',   icon: '📦', desc: 'Attachment storage (itsm-service)', anySet: ['itsm_service_url'] },
    { key: 'email',    name: 'Email (SMTP)',   icon: '✉️', desc: 'Outbound email notifications', anySet: ['smtp_host'] },
    { key: 'ai',       name: 'AI summaries',   icon: '🧠', desc: 'LLM-powered conversation summaries', anySet: ['llm_api_key'], anyTrue: ['llm_summary_enabled'] },
]

// ── KB data-source connectors (link-outs) ──────────────────────────────────────
const KB_SOURCES = [
    { key: 'firecrawl', name: 'Firecrawl', icon: '🕷️', desc: 'Crawl & ingest websites into the knowledge base', to: '/admin/firecrawl' },
    { key: 'airbyte',   name: 'Data sources', icon: '🔌', desc: 'Confluence, Notion, Zendesk, Jira… into the knowledge base', to: '/admin/kb' },
]

const ICONS = { 'microsoft-teams': '💬', webhook: '🪝' }

function StatusBadge({ ok, okLabel = 'Connected', offLabel = 'Not configured' }) {
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ok
            ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400'
            : 'bg-gray-100 dark:bg-slate-700/50 text-gray-500 dark:text-slate-400'}`}>
            {ok ? okLabel : offLabel}
        </span>
    )
}

// ── Configure modal (driven by the catalog entry's config_schema) ──────────────
function ConfigModal({ integration, eventTypes, existing, onClose, onSave }) {
    const initialCfg = {}
    integration.config_schema.forEach(f => { initialCfg[f.name] = f.name === 'url' && existing ? existing.url : '' })
    const [cfg, setCfg] = useState(initialCfg)
    const [events, setEvents] = useState(existing?.events || integration.default_events || [])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const toggleEvent = (ev) => setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev])

    const submit = async () => {
        setSaving(true); setError(null)
        try { await onSave({ cfg, events }) }
        catch (e) { setError(e.message); setSaving(false) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="card p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                    <span className="text-2xl">{ICONS[integration.icon] || '🧩'}</span>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{existing ? 'Edit' : 'Connect'} {integration.name}</h3>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">{integration.description}</p>

                {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 rounded-lg p-2">{error}</div>}

                {integration.config_schema.map(f => (
                    <div key={f.name}>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
                            {f.label}{f.required && ' *'}
                        </label>
                        <input
                            type={f.type === 'password' ? 'password' : 'text'}
                            value={cfg[f.name] ?? ''}
                            placeholder={f.placeholder || ''}
                            onChange={e => setCfg(c => ({ ...c, [f.name]: e.target.value }))}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono" />
                        {f.name === 'secret' && <p className="text-[11px] text-gray-400 mt-1">Minimum 16 characters. Used to HMAC-sign each delivery.</p>}
                    </div>
                ))}

                <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1.5">Events to deliver</label>
                    <div className="flex flex-wrap gap-2">
                        {eventTypes.map(ev => (
                            <button key={ev} onClick={() => toggleEvent(ev)}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${events.includes(ev)
                                    ? 'bg-blue-600 border-blue-600 text-white'
                                    : 'border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300'}`}>
                                {ev}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-slate-300 hover:underline">Cancel</button>
                    <button onClick={submit} disabled={saving || !events.length} className="btn-primary disabled:opacity-50">
                        {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── One installable integration card ───────────────────────────────────────────
function IntegrationCard({ integration, eventTypes, instance, api, onChanged }) {
    const [modal, setModal] = useState(false)
    const [busy, setBusy] = useState(false)
    const [testMsg, setTestMsg] = useState(null)

    const save = async ({ cfg, events }) => {
        const body = { name: integration.name, url: cfg.url, events, format: integration.format, integration_key: integration.key }
        if (cfg.secret) body.secret = cfg.secret
        if (instance) await api.patch(`/webhooks-config/endpoints/${instance.id}`, { url: cfg.url, events, ...(cfg.secret ? { secret: cfg.secret } : {}) })
        else await api.post('/webhooks-config/endpoints', body)
        setModal(false); onChanged()
    }

    const runTest = async () => {
        setBusy(true); setTestMsg(null)
        try { await api.post(`/webhooks-config/endpoints/${instance.id}/test`); setTestMsg({ ok: true, text: 'Test event sent — check the channel.' }) }
        catch (e) { setTestMsg({ ok: false, text: e.message }) }
        finally { setBusy(false) }
    }

    const toggle = async () => {
        setBusy(true)
        try { await api.patch(`/webhooks-config/endpoints/${instance.id}`, { is_active: !instance.is_active }); onChanged() }
        finally { setBusy(false) }
    }

    const disconnect = async () => {
        if (!window.confirm(`Disconnect ${integration.name}?`)) return
        setBusy(true)
        try { await api.remove(`/webhooks-config/endpoints/${instance.id}`); onChanged() }
        finally { setBusy(false) }
    }

    return (
        <div className="card p-4">
            <div className="flex items-start gap-3">
                <span className="text-2xl">{ICONS[integration.icon] || '🧩'}</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{integration.name}</h4>
                        {instance && <StatusBadge ok={instance.is_active} okLabel="Active" offLabel="Paused" />}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{integration.description}</p>
                    {instance && (
                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1 font-mono truncate">{instance.url}</p>
                    )}
                    {testMsg && <p className={`text-xs mt-1.5 ${testMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{testMsg.text}</p>}
                </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
                {!instance ? (
                    <button onClick={() => setModal(true)} className="btn-primary text-xs px-3 py-1.5">Connect</button>
                ) : (
                    <>
                        <button onClick={() => setModal(true)} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300">Configure</button>
                        <button onClick={runTest} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300">Send test</button>
                        <button onClick={toggle} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300">{instance.is_active ? 'Pause' : 'Resume'}</button>
                        <button onClick={disconnect} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg text-red-500 hover:underline">Disconnect</button>
                    </>
                )}
            </div>
            {modal && (
                <ConfigModal integration={integration} eventTypes={eventTypes} existing={instance}
                    onClose={() => setModal(false)} onSave={save} />
            )}
        </div>
    )
}

// ── Marketplace tab ─────────────────────────────────────────────────────────────
function MarketplaceTab() {
    const { call } = useApi()
    const tenants = useTenantDirectory(true)
    const tenantList = Object.entries(tenants)
    // A non-empty directory means this is a platform user (super_admin) who must
    // pick a tenant to scope into. Tenant admins (org_admin/Admin) get an empty
    // directory — they operate on their OWN org, resolved from the JWT when
    // tenantId stays null (useItsmApi(null) sends no X-Tenant-ID).
    const isPlatform = tenantList.length > 0
    const [tenantId, setTenantId] = useState(null)
    const itsm = useItsmApi(tenantId)

    const [catalog, setCatalog] = useState(null)
    const [eventTypes, setEventTypes] = useState([])
    const [endpoints, setEndpoints] = useState([])
    const [config, setConfig] = useState({})
    const [err, setErr] = useState(null)

    // Platform users: auto-select the first tenant once the directory loads.
    useEffect(() => { if (isPlatform && !tenantId && tenantList.length) setTenantId(tenantList[0][0]) }, [tenantList, tenantId, isPlatform])

    useEffect(() => {
        itsm.get('/integrations/catalog')
            .then(d => { setCatalog(d.integrations || []); setEventTypes(d.event_types || []) })
            .catch(e => setErr(e.message))
        call('/admin/config').then(d => setConfig(d?.config || {})).catch(() => {})
    }, [itsm, call])

    const loadEndpoints = useCallback(() => {
        // Platform users must pick a tenant first; tenant admins load their own
        // org's endpoints directly (tenantId === null → JWT-resolved tenant).
        if (isPlatform && !tenantId) { setEndpoints([]); return }
        itsm.get('/webhooks-config/endpoints', { page_size: 100 })
            .then(d => setEndpoints(d.items || []))
            .catch(e => setErr(e.message))
    }, [itsm, tenantId, isPlatform])

    useEffect(() => { loadEndpoints() }, [loadEndpoints])

    const installable = (catalog || []).filter(i => i.kind === 'outbound_webhook')
    const instanceFor = (key) => endpoints.find(e => e.integration_key === key)
    const isManagedSet = (m) => (m.anySet || []).some(k => config[k]) || (m.anyTrue || []).some(k => config[k] === 'true')

    return (
        <div className="space-y-8">
            {err && <div className="card p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">{err}</div>}

            {/* Notifications */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Notifications</h3>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Deliver ticket, asset & knowledge-base events to your tools.</p>
                    </div>
                    {tenantList.length > 0 && (
                        <select value={tenantId || ''} onChange={e => setTenantId(e.target.value)}
                            className="border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100">
                            {tenantList.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                        </select>
                    )}
                </div>
                {!catalog ? (
                    <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>
                ) : (
                    <div className="grid sm:grid-cols-2 gap-3">
                        {installable.map(i => (
                            <IntegrationCard key={i.key} integration={i} eventTypes={eventTypes}
                                instance={instanceFor(i.key)} api={itsm} onChanged={loadEndpoints} />
                        ))}
                    </div>
                )}
            </section>

            {/* Connected (managed) */}
            <section className="space-y-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Connected services</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Platform services wired at deployment — managed in Configuration.</p>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {MANAGED.map(m => (
                        <div key={m.key} className="card p-4">
                            <div className="flex items-center gap-2"><span className="text-xl">{m.icon}</span>
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{m.name}</h4></div>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1 mb-2">{m.desc}</p>
                            <StatusBadge ok={isManagedSet(m)} />
                        </div>
                    ))}
                </div>
            </section>

            {/* KB data sources */}
            <section className="space-y-3">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Knowledge base sources</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">Bring external content into the knowledge base.</p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    {KB_SOURCES.map(s => (
                        <Link key={s.key} to={s.to} className="card p-4 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors block">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2"><span className="text-xl">{s.icon}</span>
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{s.name}</h4></div>
                                <span className="text-xs text-blue-600 dark:text-blue-400">Configure →</span>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{s.desc}</p>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    )
}

// ── Widget embed tab (the original generator, preserved) ────────────────────────
function CodeBlock({ code }) {
    const [copied, setCopied] = useState(false)
    const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    return (
        <div className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
                <span className="text-xs text-gray-400 dark:text-slate-500">HTML embed code</span>
                <button onClick={copy} className="text-xs text-gray-400 dark:text-slate-500 hover:text-white transition-colors">{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
            <pre className="bg-gray-950 text-green-400 text-xs p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">{code}</pre>
        </div>
    )
}

function EmbedTab() {
    const [title, setTitle]         = useState('IT Support')
    const [appId, setAppId]         = useState('IT')
    const [themeColor, setThemeColor] = useState('#2563eb')
    const [serverUrl, setServerUrl] = useState(window.location.origin.replace(':3000', ':8181'))

    const embedCode = `<!-- Project IQ Chat Widget -->
<script>
  window.__IAM_CONFIG__ = {
    url:      'https://id.dev.iam.99technologies.com',
    realm:    '99-iam',
    clientId: 'project-iq',
  };
</script>
<script src="${serverUrl}/itsm-chat-widget.js" defer></script>
<itsm-chat-widget
  title="${title}"
  app-id="${appId}"
  theme-id="${themeColor}"
></itsm-chat-widget>`

    const iframeCode = `<!-- Project IQ Chat (iframe embed) -->
<iframe
  src="${serverUrl}/bot"
  width="100%"
  height="600"
  frameborder="0"
  allow="microphone"
></iframe>`

    return (
        <div className="max-w-3xl space-y-6">
            <div className="card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Widget configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Widget title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">App ID</label>
                        <input value={appId} onChange={e => setAppId(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40" />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Theme colour</label>
                        <div className="flex gap-2 items-center">
                            <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                                className="h-9 w-14 border border-gray-200 dark:border-slate-700 rounded-lg cursor-pointer" />
                            <input value={themeColor} onChange={e => setThemeColor(e.target.value)}
                                className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Server URL</label>
                        <input value={serverUrl} onChange={e => setServerUrl(e.target.value)}
                            className="w-full border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40 font-mono" />
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Web Component embed (recommended)</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">Paste this snippet into any HTML page. The widget renders as a floating button.</p>
                <CodeBlock code={embedCode} />
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">iframe embed</h3>
                <p className="text-xs text-gray-500 dark:text-slate-400">Use this if Web Components are blocked. The widget renders inside a fixed-size frame.</p>
                <CodeBlock code={iframeCode} />
            </div>
        </div>
    )
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function IntegrationPage() {
    const [tab, setTab] = useState('marketplace')
    const tabs = [['marketplace', 'Marketplace'], ['embed', 'Widget embed']]
    return (
        <div className="max-w-5xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Integrations</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Connect Project IQ to your tools and embed the chat widget.</p>
            </div>
            <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
                {tabs.map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)}
                        className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === id
                            ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'}`}>
                        {label}
                    </button>
                ))}
            </div>
            {tab === 'marketplace' ? <MarketplaceTab /> : <EmbedTab />}
        </div>
    )
}
