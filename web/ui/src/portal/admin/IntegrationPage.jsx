import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
    KeyRound, HardDrive, Mail, Sparkles, Webhook, MessageSquare, Puzzle,
    Search, Database, ArrowRight, Check, Minus, Code2,
} from 'lucide-react'
import { useApi } from '../useApi'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { useDerivedItsmTenantId } from '../useDerivedItsmTenantId'

// ── Managed services (read-only status strip) ──────────────────────────────────
// Status is derived from the platform config (/admin/config) — a key being set
// means the service is wired. These aren't installable here; they're managed on
// the Configuration page. Shown as a compact strip, not full cards — this is
// status to glance at, not something to act on from this page.
const MANAGED = [
    { key: 'identity', name: 'Identity & SSO', icon: KeyRound, desc: 'Keycloak single sign-on', anySet: ['keycloak_url'] },
    { key: 'storage',  name: 'File storage',   icon: HardDrive, desc: 'Attachment storage (itsm-service)', anySet: ['itsm_service_url'] },
    { key: 'email',    name: 'Email (SMTP)',   icon: Mail, desc: 'Outbound email notifications', anySet: ['smtp_host'] },
    { key: 'ai',       name: 'AI summaries',   icon: Sparkles, desc: 'LLM-powered conversation summaries', anySet: ['llm_api_key'], anyTrue: ['llm_summary_enabled'] },
]

// ── KB data-source connectors (link-outs) ──────────────────────────────────────
const KB_SOURCES = [
    { key: 'firecrawl', name: 'Firecrawl', icon: Search, desc: 'Crawl & ingest websites into the knowledge base', to: '/admin/firecrawl' },
    { key: 'kb_sources', name: 'Data sources', icon: Database, desc: 'Confluence, Notion, Zendesk, Jira… into the knowledge base', to: '/admin/kb' },
]

const ICONS = { 'microsoft-teams': MessageSquare, webhook: Webhook }

function StatusBadge({ ok, okLabel = 'Connected', offLabel = 'Not configured' }) {
    return (
        <span className={`badge ${ok ? 'bg-success/10 text-success' : 'bg-surface2 text-fgsubtle'}`}>
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

    const Icon = ICONS[integration.icon] || Puzzle

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="card p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="w-4.5 h-4.5 text-primary" strokeWidth={2} />
                    </span>
                    <h3 className="text-base font-semibold text-fg">{existing ? 'Edit' : 'Connect'} {integration.name}</h3>
                </div>
                <p className="text-xs text-fgmuted">{integration.description}</p>

                {error && <div className="text-sm text-danger bg-danger/10 rounded-lg p-2">{error}</div>}

                {integration.config_schema.map(f => (
                    <div key={f.name}>
                        <label className="block text-xs text-fgmuted mb-1">
                            {f.label}{f.required && ' *'}
                        </label>
                        <input
                            type={f.type === 'password' ? 'password' : 'text'}
                            value={cfg[f.name] ?? ''}
                            placeholder={f.placeholder || ''}
                            onChange={e => setCfg(c => ({ ...c, [f.name]: e.target.value }))}
                            className="input font-mono" />
                        {f.name === 'secret' && <p className="text-[11px] text-fgsubtle mt-1">Minimum 16 characters. Used to HMAC-sign each delivery.</p>}
                    </div>
                ))}

                <div>
                    <label className="block text-xs text-fgmuted mb-1.5">Events to deliver</label>
                    <div className="flex flex-wrap gap-2">
                        {eventTypes.map(ev => (
                            <button key={ev} onClick={() => toggleEvent(ev)}
                                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${events.includes(ev)
                                    ? 'bg-primary border-primary text-primary-fg'
                                    : 'border-bordc text-fgmuted hover:bg-surface2'}`}>
                                {ev}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="btn-ghost">Cancel</button>
                    <button onClick={submit} disabled={saving || !events.length} className="btn-primary">
                        {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── Project IQ extensions (native — google_sheets, ms_teams, shopify) ──────────
// Talks to this app's own /admin/extensions/* API (config/secrets, install/
// test/run) — a different backend + shape than the webhook integrations above
// (itsm-service's /webhooks-config/endpoints), so it keeps its own card/modal
// rather than overloading one component for both action sets.
function ExtensionConfigModal({ manifest, existing, onClose, onSave }) {
    const initial = {}
    manifest.config_schema.forEach(f => { initial[f.name] = existing?.config?.[f.name] ?? '' })
    const [cfg, setCfg] = useState(initial)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const submit = async () => {
        setSaving(true); setError(null)
        try { await onSave({ cfg }) }
        catch (e) { setError(e.message); setSaving(false) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="card p-6 w-full max-w-lg space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-lg">
                        {manifest.icon}
                    </span>
                    <h3 className="text-base font-semibold text-fg">{existing ? 'Edit' : 'Connect'} {manifest.name}</h3>
                </div>
                <p className="text-xs text-fgmuted">{manifest.description}</p>

                {error && <div className="text-sm text-danger bg-danger/10 rounded-lg p-2">{error}</div>}

                {manifest.config_schema.map(f => (
                    <div key={f.name}>
                        <label className="block text-xs text-fgmuted mb-1">{f.label}{f.required && ' *'}</label>
                        <input
                            type={f.type === 'password' ? 'password' : (f.type === 'url' || f.type === 'number' ? f.type : 'text')}
                            value={cfg[f.name] ?? ''}
                            placeholder={f.placeholder || (f.secret && existing ? '(unchanged)' : '')}
                            onChange={e => setCfg(c => ({ ...c, [f.name]: e.target.value }))}
                            className="input font-mono" />
                    </div>
                ))}

                <div className="flex justify-end gap-2 pt-2">
                    <button onClick={onClose} className="btn-ghost">Cancel</button>
                    <button onClick={submit} disabled={saving} className="btn-primary">
                        {saving ? 'Saving…' : existing ? 'Save changes' : 'Connect'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ── One connector card — shared visual shell for both notification endpoints
// and native extensions, which have different action sets underneath ─────────
function ConnectorShell({ icon, name, statusBadge, description, meta, message, actions, modal }) {
    return (
        <div className="card p-4">
            <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-lg">
                    {icon}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-fg">{name}</h4>
                        {statusBadge}
                    </div>
                    <p className="text-xs text-fgmuted mt-0.5">{description}</p>
                    {meta && <p className="text-[11px] text-fgsubtle mt-1 font-mono truncate">{meta}</p>}
                    {message}
                </div>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">{actions}</div>
            {modal}
        </div>
    )
}

function ActionButton({ children, danger, ...props }) {
    return (
        <button {...props}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${danger
                ? 'border-transparent text-danger hover:underline px-1'
                : 'border-bordc text-fgmuted hover:bg-surface2'}`}>
            {children}
        </button>
    )
}

function ExtensionCard({ manifest, install, ext, onChanged }) {
    const [modal, setModal] = useState(false)
    const [busy, setBusy] = useState(false)
    const [msg, setMsg] = useState(null)

    // Commerce extensions (Shopify) keep their own dedicated OAuth-connect
    // page — that flow needs a real browser redirect, which a generic
    // install-a-config-object form can't do. Link out instead.
    if (manifest.manage_url) {
        return (
            <Link to={manifest.manage_url} className="card p-4 hover:border-primary/40 transition-colors flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 text-lg">{manifest.icon}</span>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-fg">{manifest.name}</h4>
                    <p className="text-xs text-fgmuted mt-0.5">{manifest.description}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-fgsubtle shrink-0" />
            </Link>
        )
    }

    const save = async ({ cfg }) => {
        const config = {}, secrets = {}
        manifest.config_schema.forEach(f => { (f.secret ? secrets : config)[f.name] = cfg[f.name] })
        await ext.post(`/admin/extensions/${manifest.id}/install`, { config, secrets })
        setModal(false); onChanged()
    }

    const test = async () => {
        setBusy(true); setMsg(null)
        try {
            const r = await ext.post(`/admin/extensions/${manifest.id}/test`, {})
            setMsg({ ok: r.status === 'success', text: r.status === 'success' ? 'Connection OK' : (r.error || 'Test failed') })
        } catch (e) { setMsg({ ok: false, text: e.message }) }
        finally { setBusy(false) }
    }

    const run = async () => {
        setBusy(true); setMsg(null)
        try {
            const r = await ext.post(`/admin/extensions/${manifest.id}/run`, {})
            setMsg({ ok: r.status === 'success', text: r.status === 'success' ? `Synced — ${r.saved ?? 0} article(s) saved` : (r.error || 'Run failed') })
            onChanged()
        } catch (e) { setMsg({ ok: false, text: e.message }) }
        finally { setBusy(false) }
    }

    const remove = async () => {
        if (!window.confirm(`Remove ${manifest.name}?`)) return
        setBusy(true)
        try { await ext.remove(`/admin/extensions/${manifest.id}`); onChanged() }
        finally { setBusy(false) }
    }

    return (
        <ConnectorShell
            icon={manifest.icon}
            name={manifest.name}
            statusBadge={install && <StatusBadge ok={install.status === 'installed'} okLabel="Installed" offLabel={install.status} />}
            description={manifest.description}
            meta={install?.last_run_at ? `Last run: ${new Date(install.last_run_at).toLocaleString()}` : null}
            message={msg && <p className={`text-xs mt-1.5 ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</p>}
            actions={!install ? (
                <button onClick={() => setModal(true)} className="btn-primary text-xs px-3 py-1.5">Connect</button>
            ) : (
                <>
                    <ActionButton onClick={() => setModal(true)} disabled={busy}>Configure</ActionButton>
                    <ActionButton onClick={test} disabled={busy}>Test</ActionButton>
                    {manifest.kind === 'source' && <ActionButton onClick={run} disabled={busy}>Run now</ActionButton>}
                    <ActionButton onClick={remove} disabled={busy} danger>Remove</ActionButton>
                </>
            )}
            modal={modal && (
                <ExtensionConfigModal manifest={manifest} existing={install} onClose={() => setModal(false)} onSave={save} />
            )}
        />
    )
}

// ── One installable notification/webhook integration ───────────────────────────
function IntegrationCard({ integration, eventTypes, instance, api, onChanged }) {
    const [modal, setModal] = useState(false)
    const [busy, setBusy] = useState(false)
    const [testMsg, setTestMsg] = useState(null)
    const Icon = ICONS[integration.icon] || Puzzle

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
        <ConnectorShell
            icon={<Icon className="w-4.5 h-4.5 text-primary" strokeWidth={2} />}
            name={integration.name}
            statusBadge={instance && <StatusBadge ok={instance.is_active} okLabel="Active" offLabel="Paused" />}
            description={integration.description}
            meta={instance?.url}
            message={testMsg && <p className={`text-xs mt-1.5 ${testMsg.ok ? 'text-success' : 'text-danger'}`}>{testMsg.text}</p>}
            actions={!instance ? (
                <button onClick={() => setModal(true)} className="btn-primary text-xs px-3 py-1.5">Connect</button>
            ) : (
                <>
                    <ActionButton onClick={() => setModal(true)} disabled={busy}>Configure</ActionButton>
                    <ActionButton onClick={runTest} disabled={busy}>Send test</ActionButton>
                    <ActionButton onClick={toggle} disabled={busy}>{instance.is_active ? 'Pause' : 'Resume'}</ActionButton>
                    <ActionButton onClick={disconnect} disabled={busy} danger>Disconnect</ActionButton>
                </>
            )}
            modal={modal && (
                <ConfigModal integration={integration} eventTypes={eventTypes} existing={instance}
                    onClose={() => setModal(false)} onSave={save} />
            )}
        />
    )
}

// ── Compact platform-status strip (was 4 full cards — this is informational,
// not actionable, so it shouldn't compete visually with real integrations) ────
function PlatformStatusStrip({ config }) {
    const isSet = (m) => (m.anySet || []).some(k => config[k]) || (m.anyTrue || []).some(k => config[k] === 'true')
    return (
        <div className="card p-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {MANAGED.map(m => {
                    const ok = isSet(m)
                    const Icon = m.icon
                    return (
                        <div key={m.key} className="flex items-center gap-1.5" title={m.desc}>
                            <Icon className="w-3.5 h-3.5 text-fgsubtle" strokeWidth={2} />
                            <span className="text-xs text-fgmuted">{m.name}</span>
                            {ok
                                ? <Check className="w-3.5 h-3.5 text-success" strokeWidth={2.5} />
                                : <Minus className="w-3.5 h-3.5 text-fgsubtle" strokeWidth={2.5} />}
                        </div>
                    )
                })}
                <span className="text-[11px] text-fgsubtle ml-auto">Managed in Configuration</span>
            </div>
        </div>
    )
}

// ── Compact knowledge-base source quick links (was 2 full cards) ──────────────
function KbSourceLinks() {
    return (
        <div className="card divide-y divide-bordc">
            {KB_SOURCES.map(s => {
                const Icon = s.icon
                return (
                    <Link key={s.key} to={s.to} className="flex items-center gap-3 px-4 py-3 hover:bg-surface2 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
                        <Icon className="w-4 h-4 text-fgsubtle shrink-0" strokeWidth={2} />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-fg">{s.name}</p>
                            <p className="text-xs text-fgmuted truncate">{s.desc}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-fgsubtle shrink-0" />
                    </Link>
                )
            })}
        </div>
    )
}

// ── Integrations tab ─────────────────────────────────────────────────────────
function IntegrationsTab() {
    const { call } = useApi()
    const ext = useMemo(() => ({
        get:    (path)       => call(path),
        post:   (path, body) => call(path, { method: 'POST', body: JSON.stringify(body) }),
        remove: (path)       => call(path, { method: 'DELETE' }),
    }), [call])
    // Reuse the SAME tenant scope every other admin page uses (the "Blue Team"-
    // style switcher in the header, portal/admin/Layout.jsx's TenantSwitcher) —
    // not a separate one.
    //
    // The org picked up there is IAM's org id — itsm-service's X-Tenant-ID
    // expects its own internal Tenant.id, a different UUID, so it goes
    // through the iam_org_id -> itsm tenant id lookup rather than being
    // passed straight through (passing it directly 404'd with "tenant
    // '<iam org id>' not found" — confirmed live, 2026-08-20).
    const itsmTenantId = useDerivedItsmTenantId()
    const itsm = useItsmApi(itsmTenantId)

    const [catalog, setCatalog] = useState(null)
    const [eventTypes, setEventTypes] = useState([])
    const [endpoints, setEndpoints] = useState([])
    const [config, setConfig] = useState({})
    const [extCatalog, setExtCatalog] = useState(null)
    const [extInstalls, setExtInstalls] = useState([])
    const [err, setErr] = useState(null)

    useEffect(() => {
        itsm.get('/integrations/catalog')
            .then(d => { setCatalog(d.integrations || []); setEventTypes(d.event_types || []) })
            .catch(e => setErr(e.message))
        call('/admin/config').then(d => setConfig(d?.config || {})).catch(() => {})
    }, [itsm, call])

    const loadEndpoints = useCallback(() => {
        itsm.get('/webhooks-config/endpoints', { page_size: 100 })
            .then(d => setEndpoints(d.items || []))
            .catch(e => setErr(e.message))
    }, [itsm])

    useEffect(() => { loadEndpoints() }, [loadEndpoints])

    // Project IQ's own extension catalog (/admin/extensions/*, not itsm-service).
    // Excludes managed_by === 'itsm-service' entries — those are the SAME
    // Teams/webhook integrations already shown above via /integrations/catalog,
    // merged into this endpoint for API consumers that want one list; showing
    // them again here would duplicate the notification cards.
    useEffect(() => {
        ext.get('/admin/extensions/catalog')
            .then(d => setExtCatalog((d.extensions || []).filter(e => e.managed_by !== 'itsm-service')))
            .catch(e => setErr(e.message))
    }, [ext])

    const loadExtInstalls = useCallback(() => {
        ext.get('/admin/extensions')
            .then(d => setExtInstalls(d.installs || []))
            .catch(e => setErr(e.message))
    }, [ext])

    useEffect(() => { loadExtInstalls() }, [loadExtInstalls])

    const installable = (catalog || []).filter(i => i.kind === 'outbound_webhook')
    const instanceFor = (key) => endpoints.find(e => e.integration_key === key)
    const installFor = (id) => extInstalls.find(i => i.extension_id === id)
    const loaded = catalog && extCatalog
    const nothingInstalled = loaded && installable.length === 0 && extCatalog.length === 0

    return (
        <div className="space-y-6">
            {err && <div className="card p-3 bg-danger/10 text-danger text-sm">{err}</div>}

            {/* One unified grid for everything connectable — notifications and
                native extensions are different backends underneath, but to
                someone scanning this page they're the same idea: "things I can
                connect". Splitting them into two full sections with their own
                headers doubled the visual weight for no real benefit. */}
            <section className="space-y-3">
                <div>
                    <h3 className="text-sm font-semibold text-fg">Connect a tool</h3>
                    <p className="text-xs text-fgmuted">Deliver events to chat/webhooks, pull in content, or connect a commerce provider.</p>
                </div>
                {!loaded ? (
                    <div className="text-sm text-fgsubtle py-10 text-center">Loading…</div>
                ) : nothingInstalled ? (
                    <div className="card p-8 text-center text-sm text-fgmuted">Nothing available to connect yet.</div>
                ) : (
                    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {installable.map(i => (
                            <IntegrationCard key={i.key} integration={i} eventTypes={eventTypes}
                                instance={instanceFor(i.key)} api={itsm} onChanged={loadEndpoints} />
                        ))}
                        {extCatalog.map(m => (
                            <ExtensionCard key={m.id} manifest={m} install={installFor(m.id)} ext={ext} onChanged={loadExtInstalls} />
                        ))}
                    </div>
                )}
            </section>

            <div className="grid md:grid-cols-2 gap-4">
                <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-fgsubtle">Knowledge base sources</h3>
                    <KbSourceLinks />
                </section>
                <section className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-fgsubtle">Platform status</h3>
                    <PlatformStatusStrip config={config} />
                </section>
            </div>
        </div>
    )
}

// ── Widget embed tab (unchanged behavior, restyled to match) ────────────────────
function CodeBlock({ code }) {
    const [copied, setCopied] = useState(false)
    const copy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    return (
        <div className="relative rounded-xl overflow-hidden border border-bordc">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-900">
                <span className="text-xs text-slate-400 flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" /> HTML embed code</span>
                <button onClick={copy} className="text-xs text-slate-400 hover:text-white transition-colors">{copied ? '✓ Copied' : 'Copy'}</button>
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
                <h3 className="text-sm font-semibold text-fg">Widget configuration</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs text-fgmuted mb-1">Widget title</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} className="input" />
                    </div>
                    <div>
                        <label className="block text-xs text-fgmuted mb-1">App ID</label>
                        <input value={appId} onChange={e => setAppId(e.target.value)} className="input" />
                    </div>
                    <div>
                        <label className="block text-xs text-fgmuted mb-1">Theme colour</label>
                        <div className="flex gap-2 items-center">
                            <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                                className="h-9 w-14 border border-bordc rounded-lg cursor-pointer" />
                            <input value={themeColor} onChange={e => setThemeColor(e.target.value)} className="input font-mono" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-fgmuted mb-1">Server URL</label>
                        <input value={serverUrl} onChange={e => setServerUrl(e.target.value)} className="input font-mono" />
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-fg">Web Component embed (recommended)</h3>
                <p className="text-xs text-fgmuted">Paste this snippet into any HTML page. The widget renders as a floating button.</p>
                <CodeBlock code={embedCode} />
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold text-fg">iframe embed</h3>
                <p className="text-xs text-fgmuted">Use this if Web Components are blocked. The widget renders inside a fixed-size frame.</p>
                <CodeBlock code={iframeCode} />
            </div>
        </div>
    )
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function IntegrationPage() {
    const [tab, setTab] = useState('integrations')
    const tabs = [['integrations', 'Integrations'], ['embed', 'Widget embed']]
    return (
        <div className="max-w-5xl space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-fg">Integrations</h2>
                <p className="text-sm text-fgmuted mt-0.5">Connect Project IQ to your tools and embed the chat widget.</p>
            </div>
            <div className="flex gap-1 border-b border-bordc">
                {tabs.map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)}
                        className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${tab === id
                            ? 'border-primary text-primary'
                            : 'border-transparent text-fgmuted hover:text-fg'}`}>
                        {label}
                    </button>
                ))}
            </div>
            {tab === 'integrations' ? <IntegrationsTab /> : <EmbedTab />}
        </div>
    )
}
