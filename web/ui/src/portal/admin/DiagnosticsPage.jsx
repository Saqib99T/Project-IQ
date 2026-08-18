import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Server, Container, Stethoscope, Plug, FileText, Link2, Search,
    RefreshCw, Loader2,
} from 'lucide-react'
import { useApi } from '../useApi'

// ── Status pill ────────────────────────────────────────────────────────────────
function Pill({ ok, children }) {
    const cls = ok === true ? 'bg-success/10 text-success'
        : ok === false ? 'bg-danger/10 text-danger'
            : 'bg-surface2 text-fgsubtle'
    const dot = ok === true ? 'bg-success' : ok === false ? 'bg-danger' : 'bg-fgsubtle'
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {children}
        </span>
    )
}

function Row({ name, info, ok }) {
    const pill = ok === true ? 'bg-success/10 text-success'
        : ok === false ? 'bg-danger/10 text-danger'
            : 'bg-surface2 text-fgsubtle'
    const dot = ok === true ? 'bg-success' : ok === false ? 'bg-danger' : 'bg-fgsubtle'
    return (
        <div className="flex items-center gap-2 py-1.5 border-b border-bordc/60 last:border-0" title={info}>
            <span className="text-xs text-fg truncate flex-1">{name}</span>
            {info && <span className="text-[10px] text-fgsubtle truncate max-w-[38%] text-right shrink-0">{info}</span>}
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold shrink-0 ${pill}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dot} ${ok === true ? 'animate-pulse' : ''}`} />
                {ok === true ? 'Up' : ok === false ? 'Down' : '—'}
            </span>
        </div>
    )
}

// ── Services view ────────────────────────────────────────────────────────────
// Friendly systemd service labels.
const SERVICE_LABELS = { 'ml-core': 'ML Core', 'actions': 'Actions', 'admin': 'Admin' }

// Friendly container labels + grouping (ITSM / Firecrawl) for the raw docker names.
const CONTAINER_LABELS = {
    'api': 'API', 'worker': 'Worker', 'worker-beat': 'Beat', 'beat': 'Beat',
    'db': 'Database', 'redis': 'Redis', 'minio': 'MinIO (storage)',
    'rabbitmq': 'RabbitMQ', 'nuq-postgres': 'Postgres', 'playwright-service': 'Playwright',
}
function containerInfo(name) {
    let group = 'Other', comp = name || ''
    if (comp.startsWith('itsm-service_'))        { group = 'ITSM';      comp = comp.slice('itsm-service_'.length) }
    else if (comp.startsWith('firecrawl-selfhost_')) { group = 'Firecrawl'; comp = comp.slice('firecrawl-selfhost_'.length) }
    comp = comp.replace(/_\d+$/, '')  // strip trailing _1
    const label = CONTAINER_LABELS[comp] || comp.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    return { group, label }
}
function groupContainers(containers) {
    const order = { ITSM: 0, Firecrawl: 1, Other: 2 }
    const groups = []
    containers.forEach(c => {
        const { group, label } = containerInfo(c.name)
        let bucket = groups.find(b => b.name === group)
        if (!bucket) { bucket = { name: group, items: [] }; groups.push(bucket) }
        bucket.items.push({ ...c, label })
    })
    groups.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9))
    return groups
}

function ServicesPanel({ call, registerRefresh }) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [updatedAt, setUpdatedAt] = useState(null)
    const pollRef = useRef(null)

    const refresh = useCallback(async () => {
        try {
            const d = await call('/api/status')
            setData(d)
            setError(null)
            setUpdatedAt(new Date())
        } catch (e) {
            setError(e.message)
        }
    }, [call])

    useEffect(() => { registerRefresh?.(refresh) }, [registerRefresh, refresh])

    useEffect(() => {
        refresh()
        pollRef.current = setInterval(refresh, 60000)  // auto-refresh every 1 min
        return () => clearInterval(pollRef.current)
    }, [refresh])

    if (error) return <div className="card p-4 bg-danger/10 text-danger text-sm">{error}</div>
    if (!data) return (
        <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-primary animate-spin" strokeWidth={2} />
        </div>
    )

    const services   = data.services   || []
    const containers = data.containers || []
    const health     = data.health     || []
    const ports      = data.ports      || []

    const Card = ({ icon: Icon, title, count, children }) => (
        <div className="card p-4">
            <h3 className="text-xs font-semibold text-fgmuted mb-2.5 flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-fgsubtle" strokeWidth={2} />
                {title}
                <span className="ml-auto text-[10px] font-normal text-fgsubtle tabular-nums">{count}</span>
            </h3>
            {children}
        </div>
    )

    return (
        <div className="space-y-3">
            <div className="flex justify-end -mt-1">
                <span className="text-[10px] text-fgsubtle">
                    {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''} · auto every 1 min
                </span>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 items-start">
                <Card icon={Server} title="System services" count={services.length}>
                    {services.map(s => (
                        <Row key={s.name} name={SERVICE_LABELS[s.name] || s.name} ok={s.ok}
                            info={[s.uptime && s.uptime !== 'n/a' ? s.uptime : null,
                                   s.mem && s.mem !== 'n/a' ? s.mem : null].filter(Boolean).join(' · ')} />
                    ))}
                </Card>

                <Card icon={Container} title="Containers" count={containers.length}>
                    {containers.length === 0 && <p className="text-[10px] text-fgsubtle py-2">None.</p>}
                    {groupContainers(containers).map(g => (
                        <div key={g.name} className="mt-2 first:mt-0">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-fgsubtle mb-0.5">{g.name}</div>
                            {g.items.map(c => (
                                <Row key={c.name} name={c.label} ok={c.ok} info={c.status} />
                            ))}
                        </div>
                    ))}
                </Card>

                <Card icon={Stethoscope} title="Health checks" count={health.length}>
                    {health.map(h => (
                        <Row key={h.name} name={h.name} ok={h.ok} info={h.detail} />
                    ))}
                </Card>

                <Card icon={Plug} title="Listening ports" count={ports.length}>
                    {ports.map(p => (
                        <Row key={p.port} name={`:${p.port}`} info={p.label} ok={p.ok} />
                    ))}
                </Card>
            </div>
        </div>
    )
}

// ── Logs view ──────────────────────────────────────────────────────────────
const LEVEL_CLASS = (line) => {
    const u = line.toUpperCase()
    if (u.includes(' ERROR') || u.includes('ERROR ') || u.includes('TRACEBACK') || u.includes('CRITICAL')) return 'text-red-400'
    if (u.includes('WARN')) return 'text-amber-400'
    if (u.includes(' INFO')) return 'text-emerald-400'
    return 'text-slate-300'
}

// Strip the noisy log prefix → { time: 'HH:MM:SS', msg }.
// systemd short-iso: "<ts> <host> <ident>[pid]: <msg>"   ·   docker: "<ts> <msg>"
function cleanLogLine(line) {
    let m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+)\S*\s+\S+\s+\S+\[\d+\]:\s?(.*)$/)
    if (m) return { time: m[1].slice(11), msg: m[2] }
    m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+)\S*\s+(.*)$/)
    if (m) return { time: m[1].slice(11, 19), msg: m[2] }
    return { time: '', msg: line }
}

// Group sources by their `group`, preserving first-appearance order. Sources
// with no group become their own standalone cluster (rendered without a label).
function groupSources(sources) {
    const groups = []
    sources.forEach(s => {
        const g = s.group || ''
        if (!g) { groups.push({ name: '', items: [s] }); return }
        const bucket = groups.find(x => x.name === g)
        if (bucket) bucket.items.push(s)
        else groups.push({ name: g, items: [s] })
    })
    return groups
}

function LogsPanel({ call, registerRefresh }) {
    const [sources, setSources] = useState([])
    const [source, setSource]   = useState(null)
    const [search, setSearch]   = useState('')
    const [lines, setLines]     = useState(400)
    const [autoRefresh, setAutoRefresh] = useState(false)
    const [logLines, setLogLines] = useState([])
    const [note, setNote]       = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError]     = useState(null)
    const [updatedAt, setUpdatedAt] = useState(null)
    const pollRef = useRef(null)
    const viewRef = useRef(null)

    // Load available sources once
    useEffect(() => {
        call('/admin/diagnostics/logs/sources')
            .then(d => {
                const list = d.data || []
                setSources(list)
                if (list.length) setSource(list[0].key)
            })
            .catch(e => setError(e.message))
    }, [call])

    const fetchLogs = useCallback(async () => {
        if (!source) return
        setLoading(true)
        try {
            const params = new URLSearchParams({ source, lines: String(lines) })
            if (search.trim()) params.set('q', search.trim())
            const d = await call(`/admin/diagnostics/logs?${params.toString()}`)
            setLogLines(d.data || [])
            setNote(d.note || null)
            setError(null)
            setUpdatedAt(new Date())
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, source, lines, search])

    // On source (tab) switch, clear the old logs immediately + show loading so
    // the user gets instant feedback that the new log is being fetched.
    useEffect(() => {
        setLogLines([]); setNote(null); setLoading(true)
    }, [source])

    // Fetch on source/lines change; debounce search
    useEffect(() => {
        if (!source) return
        const t = setTimeout(fetchLogs, 300)
        return () => clearTimeout(t)
    }, [fetchLogs, source])

    useEffect(() => { registerRefresh?.(fetchLogs) }, [registerRefresh, fetchLogs])

    // Auto-refresh (opt-in) — every 1 min
    useEffect(() => {
        clearInterval(pollRef.current)
        if (autoRefresh && source) pollRef.current = setInterval(fetchLogs, 60000)
        return () => clearInterval(pollRef.current)
    }, [autoRefresh, fetchLogs, source])

    // Keep scrolled to the bottom (newest) on new content
    useEffect(() => {
        if (viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight
    }, [logLines])

    return (
        <div className="space-y-3">
            {/* Source tabs (grouped) + search/controls on ONE row — search after the Firecrawl tab */}
            <div className="flex flex-wrap gap-x-5 gap-y-3 items-end">
                {groupSources(sources).map((grp, gi) => (
                    <div key={gi} className="flex flex-col gap-1">
                        {grp.name && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-fgsubtle px-0.5">{grp.name}</span>
                        )}
                        <div className="flex gap-1">
                            {grp.items.map(s => (
                                <button key={s.key} onClick={() => setSource(s.key)} title={s.kind}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                                        source === s.key
                                            ? 'bg-primary text-primary-fg border-primary'
                                            : 'bg-surface text-fgmuted border-bordc hover:border-primary/40'
                                    }`}>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Search + line count + auto — inline, right after the last tab */}
                <div className="flex items-center gap-2 flex-1 min-w-[260px]">
                    <div className="relative flex-1 min-w-[150px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fgsubtle" strokeWidth={2} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search this log…"
                            className="input pl-9"
                        />
                    </div>
                    <select value={lines} onChange={e => setLines(Number(e.target.value))} className="select w-auto">
                        {[100, 200, 400, 800, 1500].map(n => <option key={n} value={n}>{n} lines</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-sm text-fgmuted px-2 whitespace-nowrap">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
                        Auto (1m)
                    </label>
                </div>
            </div>

            {error && <div className="card p-3 bg-danger/10 text-danger text-sm">{error}</div>}

            {/* Viewer (no header bar) */}
            <div className="card overflow-hidden">
                <div ref={viewRef} className="bg-slate-950 px-4 py-3 h-[60vh] overflow-y-auto font-mono text-xs leading-relaxed">
                    {note && <p className="text-amber-400 mb-2">{note}</p>}
                    {loading && logLines.length === 0 && !note && (
                        <div className="flex items-center gap-2 text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                            Loading logs…
                        </div>
                    )}
                    {!loading && logLines.length === 0 && !note && (
                        <p className="text-slate-500">No log lines.</p>
                    )}
                    {logLines.map((l, i) => {
                        const { time, msg } = cleanLogLine(l)
                        return (
                            <div key={i} className="flex gap-3 whitespace-pre-wrap break-all">
                                {time && <span className="text-slate-500 shrink-0 select-none">{time}</span>}
                                <span className={LEVEL_CLASS(msg)}>{msg}</span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

// ── Trace view ───────────────────────────────────────────────────────────────
// Reconstructs one turn across services by correlation id (X-Request-ID),
// built on /admin/observability/trace/<id>.
function TracePanel({ call, registerRefresh }) {
    const [reqId, setReqId]     = useState('')
    const [entries, setEntries] = useState(null)
    const [count, setCount]     = useState(0)
    const [loading, setLoading] = useState(false)
    const [error, setError]     = useState(null)

    const run = useCallback(async () => {
        const id = reqId.trim()
        if (!id) return
        setLoading(true); setError(null)
        try {
            const d = await call(`/admin/observability/trace/${encodeURIComponent(id)}`)
            setEntries(d.data || [])
            setCount(d.count || 0)
        } catch (e) {
            setError(e.message); setEntries(null)
        } finally {
            setLoading(false)
        }
    }, [call, reqId])

    useEffect(() => { registerRefresh?.(run) }, [registerRefresh, run])

    const levelColor = (lvl) => ({
        ERROR: 'text-red-400', CRITICAL: 'text-red-400',
        WARNING: 'text-amber-400', INFO: 'text-emerald-400',
    }[lvl] || 'text-slate-400')

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <input
                    value={reqId}
                    onChange={e => setReqId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && run()}
                    placeholder="Paste a request ID (X-Request-ID)…"
                    className="input flex-1 font-mono"
                />
                <button onClick={run} disabled={loading || !reqId.trim()} className="btn-primary">Trace</button>
            </div>
            <p className="text-[11px] text-fgsubtle">
                Find an ID in the <b className="text-fgmuted">Logs</b> tab (<code>req=…</code>) or the <code>X-Request-ID</code> response header.
            </p>

            {error && <div className="card p-3 bg-danger/10 text-danger text-sm">{error}</div>}

            <div className="card overflow-hidden">
                <div className="bg-slate-950 px-4 py-3 h-[60vh] overflow-y-auto font-mono text-xs leading-relaxed">
                    {loading && (
                        <div className="flex items-center gap-2 text-slate-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                            Tracing…
                        </div>
                    )}
                    {!loading && entries === null && <p className="text-slate-500">Enter a request ID to reconstruct its trace.</p>}
                    {!loading && entries && entries.length === 0 && <p className="text-slate-500">No log entries found for that request ID.</p>}
                    {!loading && entries && entries.length > 0 && (
                        <>
                            <p className="text-slate-400 mb-2">{count} entries across services</p>
                            {entries.map((e, i) => (
                                <div key={i} className="flex gap-3 whitespace-pre-wrap break-all py-0.5">
                                    <span className="text-slate-500 shrink-0 select-none">{(e.timestamp || '').slice(11, 23)}</span>
                                    <span className="inline-block px-1.5 rounded text-[10px] font-semibold bg-slate-700 text-slate-200 shrink-0 self-center">{e.source}</span>
                                    <span className={`${levelColor(e.level)} shrink-0 w-14`}>{e.level}</span>
                                    <span className="text-slate-400">
                                        {e.logger ? `${e.logger.split('.').pop()}: ` : ''}{e.message}
                                    </span>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DiagnosticsPage() {
    const { call } = useApi()
    const [tab, setTab] = useState('services')
    // The active panel registers its refresh fn here so the header button can call it.
    const refreshRef = useRef(() => {})
    const registerRefresh = useCallback((fn) => { refreshRef.current = fn }, [])

    const TABS = [
        { key: 'services', label: 'Services', icon: Server },
        { key: 'logs',     label: 'Logs',     icon: FileText },
        { key: 'trace',    label: 'Trace',    icon: Link2 },
    ]

    return (
        <div className="max-w-6xl space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-fg">Diagnostics</h2>
                <p className="text-sm text-fgmuted mt-0.5">Server services, container states, and live logs</p>
            </div>

            {/* Tabs (underline) on the left · Refresh button pinned right */}
            <div className="flex items-center gap-1 border-b border-bordc">
                {TABS.map(t => {
                    const Icon = t.icon
                    return (
                        <button key={t.key} onClick={() => setTab(t.key)}
                            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                                tab === t.key
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-fgmuted hover:text-fg'
                            }`}>
                            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                            {t.label}
                        </button>
                    )
                })}
                <button onClick={() => refreshRef.current?.()}
                    className="btn-ghost border border-bordc text-sm px-3 py-1.5 ml-auto mb-1 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} /> Refresh
                </button>
            </div>

            {tab === 'services' && <ServicesPanel call={call} registerRefresh={registerRefresh} />}
            {tab === 'logs'     && <LogsPanel call={call} registerRefresh={registerRefresh} />}
            {tab === 'trace'    && <TracePanel call={call} registerRefresh={registerRefresh} />}
        </div>
    )
}
