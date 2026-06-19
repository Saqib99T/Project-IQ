import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi } from '../useApi'

// ── Status pill ────────────────────────────────────────────────────────────────
function Pill({ ok, children }) {
    const cls = ok === true
        ? 'bg-green-50 text-green-700 dark:bg-emerald-500/10 dark:text-emerald-400'
        : ok === false
            ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
            : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
    const dot = ok === true ? 'bg-green-500' : ok === false ? 'bg-red-500' : 'bg-gray-400'
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {children}
        </span>
    )
}

function Row({ name, info, ok }) {
    const pill = ok === true
        ? 'bg-green-100 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-400'
        : ok === false
            ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
            : 'bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400'
    const dot = ok === true ? 'bg-green-500' : ok === false ? 'bg-red-500' : 'bg-gray-400'
    return (
        <div className="flex items-center gap-2 py-1.5 border-b border-gray-100 dark:border-slate-800 last:border-0" title={info}>
            <span className="text-xs text-gray-800 dark:text-slate-200 truncate flex-1">{name}</span>
            {info && <span className="text-[10px] text-gray-400 dark:text-slate-500 truncate max-w-[38%] text-right shrink-0">{info}</span>}
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

    if (error) return <div className="card p-4 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm">{error}</div>
    if (!data) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

    const services   = data.services   || []
    const containers = data.containers || []
    const health     = data.health     || []
    const ports      = data.ports      || []

    const Card = ({ icon, title, count, children }) => (
        <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-700 dark:text-slate-300 mb-2.5 flex items-center gap-1.5">
                <span>{icon}</span> {title}
                <span className="ml-auto text-[10px] font-normal text-gray-400 dark:text-slate-500">{count}</span>
            </h3>
            {children}
        </div>
    )

    return (
        <div className="space-y-3">
            <div className="flex justify-end -mt-1">
                <span className="text-[10px] text-gray-400 dark:text-slate-500">
                    {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : ''} · auto every 1 min
                </span>
            </div>

            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 items-start">
                <Card icon="⚙️" title="System services" count={services.length}>
                    {services.map(s => (
                        <Row key={s.name} name={SERVICE_LABELS[s.name] || s.name} ok={s.ok}
                            info={[s.uptime && s.uptime !== 'n/a' ? s.uptime : null,
                                   s.mem && s.mem !== 'n/a' ? s.mem : null].filter(Boolean).join(' · ')} />
                    ))}
                </Card>

                <Card icon="🐳" title="Containers" count={containers.length}>
                    {containers.length === 0 && <p className="text-[10px] text-gray-400 dark:text-slate-500 py-2">None.</p>}
                    {groupContainers(containers).map(g => (
                        <div key={g.name} className="mt-2 first:mt-0">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 mb-0.5">{g.name}</div>
                            {g.items.map(c => (
                                <Row key={c.name} name={c.label} ok={c.ok} info={c.status} />
                            ))}
                        </div>
                    ))}
                </Card>

                <Card icon="🩺" title="Health checks" count={health.length}>
                    {health.map(h => (
                        <Row key={h.name} name={h.name} ok={h.ok} info={h.detail} />
                    ))}
                </Card>

                <Card icon="🔌" title="Listening ports" count={ports.length}>
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
    return 'text-gray-300 dark:text-slate-400'
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
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500 px-0.5">{grp.name}</span>
                        )}
                        <div className="flex gap-1">
                            {grp.items.map(s => (
                                <button key={s.key} onClick={() => setSource(s.key)} title={s.kind}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                                        source === s.key
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:border-blue-300'
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
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search this log…"
                            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                    </div>
                    <select value={lines} onChange={e => setLines(Number(e.target.value))}
                        className="text-sm border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-300">
                        {[100, 200, 400, 800, 1500].map(n => <option key={n} value={n}>{n} lines</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-slate-300 px-2 whitespace-nowrap">
                        <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
                        Auto (1m)
                    </label>
                </div>
            </div>

            {error && <div className="card p-3 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm">{error}</div>}

            {/* Viewer (no header bar) */}
            <div className="card overflow-hidden">
                <div ref={viewRef} className="bg-gray-900 px-4 py-3 h-[60vh] overflow-y-auto font-mono text-xs leading-relaxed">
                    {note && <p className="text-amber-400 mb-2">{note}</p>}
                    {loading && logLines.length === 0 && !note && (
                        <div className="flex items-center gap-2 text-gray-400">
                            <span className="w-3.5 h-3.5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                            Loading logs…
                        </div>
                    )}
                    {!loading && logLines.length === 0 && !note && (
                        <p className="text-gray-500">No log lines.</p>
                    )}
                    {logLines.map((l, i) => {
                        const { time, msg } = cleanLogLine(l)
                        return (
                            <div key={i} className="flex gap-3 whitespace-pre-wrap break-all">
                                {time && <span className="text-gray-500 shrink-0 select-none">{time}</span>}
                                <span className={LEVEL_CLASS(msg)}>{msg}</span>
                            </div>
                        )
                    })}
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
        { key: 'services', label: 'Services', icon: '🖥️' },
        { key: 'logs',     label: 'Logs',     icon: '📋' },
    ]

    return (
        <div className="max-w-6xl space-y-4">
            <div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Diagnostics</h2>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Server services, container states, and live logs</p>
            </div>

            {/* Tabs (underline) on the left · Refresh button pinned right */}
            <div className="flex items-center gap-1 border-b border-gray-200 dark:border-slate-800">
                {TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                            tab === t.key
                                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                        }`}>
                        <span className="mr-1.5">{t.icon}</span>{t.label}
                    </button>
                ))}
                <button onClick={() => refreshRef.current?.()}
                    className="btn-ghost border border-gray-200 dark:border-slate-700 text-sm px-3 py-1.5 ml-auto mb-1">↻ Refresh</button>
            </div>

            {tab === 'services'
                ? <ServicesPanel call={call} registerRefresh={registerRefresh} />
                : <LogsPanel call={call} registerRefresh={registerRefresh} />}
        </div>
    )
}
