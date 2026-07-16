import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

// Budget gauge: remaining % as a coloured bar (green >20, amber >0, red ≤0).
// `remaining` is consumed-budget expressed as a % and is NOT capped server-side
// (burning 1000x a tiny allowed-error budget legitimately computes to -99900%)
// — the bar width is already clamped to 0-100, so the label must match it,
// otherwise a blown-out SLO shows an empty red bar next to a nonsense number.
// The burn-rate figure shown alongside this (e.g. "1000x") is what actually
// conveys how far over budget things are; this label just says "gone" past 0.
function BudgetGauge({ remaining }) {
    if (remaining == null) return <span className="text-xs text-slate-400">no data yet</span>
    const clamped = Math.max(0, Math.min(100, remaining))
    const tone = remaining <= 0 ? 'bg-rose-500' : remaining < 20 ? 'bg-amber-500' : 'bg-emerald-500'
    return (
        <div className="flex items-center gap-2">
            <div className="h-2 w-32 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div className={`h-full ${tone}`} style={{ width: `${clamped}%` }} />
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">{clamped}%</span>
        </div>
    )
}

function MeetingPill({ meeting }) {
    if (meeting == null) return <span className="pill-slate text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">no data</span>
    return meeting
        ? <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">meeting</span>
        : <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">at&nbsp;risk</span>
}

// ── Error-budget board ────────────────────────────────────────────────────────
function ErrorBudgetTab() {
    const { get } = useItsmApi()
    const { data, loading, error } = useItsmResource(() => get('/slo/reports/error-budget'), [get])
    const rows = data?.objectives || []
    return (
        <div className="space-y-3">
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (rows.length === 0 ? <EmptyState>No SLOs defined yet. Add one on the SLOs tab.</EmptyState> : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                    {rows.map(o => (
                        <div key={o.slo_id} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{o.name}</span>
                                <MeetingPill meeting={o.meeting} />
                            </div>
                            <div className="text-xs text-slate-500 flex gap-3 font-mono tabular-nums">
                                <span>SLI {o.sli_pct == null ? '—' : `${o.sli_pct}%`}</span>
                                <span>target {o.target_pct}%</span>
                                <span>burn {o.burn_rate_1h ?? '—'}×</span>
                            </div>
                            <div>
                                <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Error budget remaining</p>
                                <BudgetGauge remaining={o.budget_remaining_pct} />
                            </div>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

// ── SLO objectives (+ burn rules + simulate) ────────────────────────────────────
function ObjectiveCard({ slo, onChanged }) {
    const { get, post, remove } = useItsmApi()
    const { data: status, reload } = useItsmResource(() => get(`/slo/objectives/${slo.id}/status`), [get, slo.id])
    const { data: rules, reload: reloadRules } = useItsmResource(() => get(`/slo/objectives/${slo.id}/burn-alerts`), [get, slo.id])
    const st = status || {}

    const [burnBusy, setBurnBusy] = useState(false)
    const addBurn = async (kind) => {
        if (burnBusy) return
        setBurnBusy(true)
        try { await post(`/slo/objectives/${slo.id}/burn-alerts`, { kind }); reloadRules() }
        catch { /* ignore */ }
        finally { setBurnBusy(false) }
    }
    const simulate = async (good, total) => { try { await post(`/slo/${slo.id}/measurements`, { good_count: good, total_count: total }); reload(); reloadRules() } catch { /* ignore */ } }

    return (
        <li className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{slo.name}
                    <span className="ml-2 text-xs text-slate-400">{slo.objective_type} · {slo.window} · target {slo.target_pct}%</span></span>
                <button onClick={() => remove(`/slo/objectives/${slo.id}`).then(onChanged)} className="text-xs text-red-500 hover:underline">delete</button>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 font-mono tabular-nums">
                <span>SLI {st.sli_pct == null ? '—' : `${st.sli_pct}%`}</span>
                <span>burn(1h) {st.burn_rate_1h ?? '—'}×</span>
                {st.eta_hours != null && <span className="text-amber-600">budget gone in ~{st.eta_hours}h</span>}
                <MeetingPill meeting={st.meeting} />
            </div>
            <BudgetGauge remaining={st.budget_remaining_pct} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400">burn rules:</span>
                {(rules || []).map(r => (
                    <span key={r.id} className={`text-[11px] font-mono px-2 py-0.5 rounded-full ${r.state === 'firing' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                        {r.kind} · {r.state}
                    </span>
                ))}
                {(rules || []).length === 0 && (
                    <>
                        <button onClick={() => addBurn('fast_burn')} disabled={burnBusy} className="btn-ghost text-[11px]">+ fast-burn</button>
                        <button onClick={() => addBurn('slow_burn')} disabled={burnBusy} className="btn-ghost text-[11px]">+ slow-burn</button>
                    </>
                )}
                <span className="text-[11px] text-slate-300">|</span>
                <button onClick={() => simulate(1000, 1000)} className="text-[11px] text-emerald-600 hover:underline">simulate healthy</button>
                <button onClick={() => simulate(0, 500)} className="text-[11px] text-rose-600 hover:underline">simulate outage</button>
            </div>
        </li>
    )
}

function ObjectivesTab() {
    const { get, post } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get('/slo/objectives'), [get])
    const { data: services } = useItsmResource(() => get('/services'), [get])
    const { data: sources } = useItsmResource(() => get('/slo/sources'), [get])
    const [f, setF] = useState({ name: '', service_id: '', sli_source_id: '', target_pct: 99.9, window: 'rolling_28d' })
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const list = data || []

    const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
    const create = async () => {
        if (busy || !f.name.trim() || !f.service_id || !f.sli_source_id) return
        setBusy(true)
        setError(null)
        try { await post('/slo/objectives', { ...f, target_pct: parseFloat(f.target_pct) }); setF({ ...f, name: '' }); reload() }
        catch (e) { setError(e) }
        finally { setBusy(false) }
    }
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <input className="input text-sm w-44" placeholder="SLO name" value={f.name} onChange={set('name')} />
                <select className="input text-sm" value={f.service_id} onChange={set('service_id')}>
                    <option value="">Service…</option>
                    {(services || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="input text-sm" value={f.sli_source_id} onChange={set('sli_source_id')}>
                    <option value="">SLI source…</option>
                    {(sources || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="input text-sm w-20" type="number" step="0.001" value={f.target_pct} onChange={set('target_pct')} title="target %" />
                <select className="input text-sm" value={f.window} onChange={set('window')}>
                    {['rolling_7d', 'rolling_28d', 'rolling_30d', 'calendar_month', 'quarter'].map(w => <option key={w} value={w}>{w}</option>)}
                </select>
                <button className="btn-primary text-xs" onClick={create} disabled={busy || !f.name.trim() || !f.service_id || !f.sli_source_id}>{busy ? 'Adding…' : '+ Add SLO'}</button>
            </div>
            {(services || []).length === 0 && <p className="text-xs text-amber-600">Create an on-call Service first (On-Call / Escalation → Services).</p>}
            {(sources || []).length === 0 && <p className="text-xs text-amber-600">Create an SLI source first (Sources tab).</p>}
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0 ? <EmptyState>No SLOs yet.</EmptyState> : (
                <ul className="space-y-1.5">{list.map(s => <ObjectiveCard key={s.id} slo={s} onChanged={reload} />)}</ul>
            ))}
        </div>
    )
}

// ── SLI sources ─────────────────────────────────────────────────────────────
function SourcesTab() {
    const { get, post, remove } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get('/slo/sources'), [get])
    const [name, setName] = useState('')
    const [type, setType] = useState('internal_metric')
    const [metric, setMetric] = useState('uptime')
    const [error, setError] = useState(null)
    const [busy, setBusy] = useState(false)
    const list = data || []

    const create = async () => {
        if (busy || !name.trim()) return
        setBusy(true)
        setError(null)
        const config = type === 'internal_metric' ? { metric } : null
        try { await post('/slo/sources', { name, type, config }); setName(''); reload() }
        catch (e) { setError(e) }
        finally { setBusy(false) }
    }
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <input className="input text-sm w-44" placeholder="Source name" value={name} onChange={e => setName(e.target.value)} />
                <select className="input text-sm" value={type} onChange={e => setType(e.target.value)}>
                    {['internal_metric', 'push_api', 'http_uptime_check', 'prometheus', 'datadog', 'log_query'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {type === 'internal_metric' && (
                    <select className="input text-sm" value={metric} onChange={e => setMetric(e.target.value)}>
                        {['uptime', 'incident_free', 'ticket_sla_compliance'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                )}
                <button className="btn-primary text-xs" onClick={create} disabled={busy || !name.trim()}>{busy ? 'Adding…' : '+ Add source'}</button>
            </div>
            <p className="text-xs text-slate-400"><b>internal_metric</b> is computed from data you already own (no external monitor). <b>push_api</b> accepts pushed counts. Others need a backend wired.</p>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0 ? <EmptyState>No SLI sources.</EmptyState> : (
                <ul className="space-y-1">
                    {list.map(s => (
                        <li key={s.id} className="flex items-center justify-between text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-slate-700 dark:text-slate-300">{s.name}
                                <span className="ml-2 text-xs text-slate-400">{s.type}{s.config?.metric ? ` · ${s.config.metric}` : ''}</span></span>
                            <button onClick={() => remove(`/slo/sources/${s.id}`).then(reload)} className="text-xs text-red-500 hover:underline">delete</button>
                        </li>
                    ))}
                </ul>
            ))}
        </div>
    )
}

const TABS = [
    { id: 'budget', label: 'Error Budget', render: () => <ErrorBudgetTab /> },
    { id: 'objectives', label: 'SLOs', render: () => <ObjectivesTab /> },
    { id: 'sources', label: 'SLI Sources', render: () => <SourcesTab /> },
]

export default function SloSection() {
    const [tab, setTab] = useState('budget')
    return (
        <div className="space-y-4">
            <div className="flex gap-1 border-b border-slate-100 dark:border-slate-700">
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`px-3 py-1.5 text-xs font-medium -mb-px border-b-2 ${tab === t.id
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                        {t.label}
                    </button>
                ))}
            </div>
            {TABS.find(t => t.id === tab).render()}
        </div>
    )
}
