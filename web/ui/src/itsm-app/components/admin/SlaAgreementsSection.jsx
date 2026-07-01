import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

const METRICS = ['first_response', 'next_response', 'periodic_update', 'time_to_acknowledge', 'time_to_mitigate', 'resolution']
const KIND_LABEL = { sla: 'SLA', ola: 'OLA', uc: 'UC' }

function KindBadge({ kind }) {
    const cls = kind === 'sla' ? 'bg-blue-100 text-blue-700'
        : kind === 'ola' ? 'bg-violet-100 text-violet-700'
        : 'bg-amber-100 text-amber-700'
    return <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{KIND_LABEL[kind] || kind}</span>
}

// ── Agreements + targets ────────────────────────────────────────────────────

function NewAgreementModal({ open, onClose, onCreated, teams, vendors }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [kind, setKind] = useState('sla')
    const [ownerTeamId, setOwnerTeamId] = useState('')
    const [vendorId, setVendorId] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const submit = async (e) => {
        e.preventDefault(); setBusy(true); setError(null)
        try {
            const body = { name, kind }
            if (kind === 'ola') body.owner_team_id = ownerTeamId || null
            if (kind === 'uc') body.vendor_id = vendorId || null
            await post('/sla/agreements', body)
            setName(''); setKind('sla'); setOwnerTeamId(''); setVendorId('')
            onCreated()
        } catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <Modal open={open} onClose={onClose} title="New agreement">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Critical Production" />
                </FormField>
                <FormField label="Kind">
                    <select className="input" value={kind} onChange={e => setKind(e.target.value)}>
                        <option value="sla">SLA — provider → customer</option>
                        <option value="ola">OLA — team → team</option>
                        <option value="uc">UC — vendor → provider</option>
                    </select>
                </FormField>
                {kind === 'ola' && (
                    <FormField label="Owner team">
                        <select className="input" required value={ownerTeamId} onChange={e => setOwnerTeamId(e.target.value)}>
                            <option value="">Select team…</option>
                            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </FormField>
                )}
                {kind === 'uc' && (
                    <FormField label="Vendor">
                        <select className="input" required value={vendorId} onChange={e => setVendorId(e.target.value)}>
                            <option value="">Select vendor…</option>
                            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                    </FormField>
                )}
                {error && <ErrorBanner message={error.message} />}
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" onClick={onClose} className="btn-ghost text-sm" disabled={busy}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</button>
                </div>
            </form>
        </Modal>
    )
}

function TargetsEditor({ agreement, windows, onChanged }) {
    const { get, post, remove } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get(`/sla/agreements/${agreement.id}`), [get, agreement.id])
    const [adding, setAdding] = useState(false)
    const [metric, setMetric] = useState('first_response')
    const [minutes, setMinutes] = useState('60')
    const [cwId, setCwId] = useState('')
    const [error, setError] = useState(null)
    const targets = data?.targets || []

    const add = async (e) => {
        e.preventDefault(); setError(null)
        try {
            await post(`/sla/agreements/${agreement.id}/targets`, {
                metric, duration_minutes: Number(minutes), coverage_window_id: cwId || null,
            })
            setAdding(false); setMetric('first_response'); setMinutes('60'); setCwId('')
            reload(); onChanged?.()
        } catch (err) { setError(err) }
    }
    const del = async (id) => { try { await remove(`/sla/targets/${id}`); reload(); onChanged?.() } catch (err) { setError(err) } }

    return (
        <div className="mt-2 pl-3 border-l-2 border-slate-100 dark:border-slate-700 space-y-2">
            {loading ? <LoadingSpinner /> : targets.length === 0
                ? <p className="text-xs text-slate-400">No targets yet.</p>
                : targets.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600 dark:text-slate-300">
                            {t.metric.replace(/_/g, ' ')} · {t.duration_minutes}m
                            {t.coverage_window_id ? ' · scheduled' : ' · 24×7'}
                        </span>
                        <button onClick={() => del(t.id)} className="text-red-500 hover:underline">remove</button>
                    </div>
                ))}
            {error && <ErrorBanner message={error.message} />}
            {adding ? (
                <form onSubmit={add} className="flex flex-wrap items-end gap-2">
                    <select className="input text-xs" value={metric} onChange={e => setMetric(e.target.value)}>
                        {METRICS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input type="number" min={1} className="input text-xs w-24" value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="minutes" />
                    <select className="input text-xs" value={cwId} onChange={e => setCwId(e.target.value)}>
                        <option value="">24×7</option>
                        {windows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <button type="submit" className="btn-primary text-xs">Add</button>
                    <button type="button" className="btn-ghost text-xs" onClick={() => setAdding(false)}>Cancel</button>
                </form>
            ) : (
                <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:underline">+ Add target</button>
            )}
        </div>
    )
}

function AgreementsTab() {
    const { get, remove } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const [expanded, setExpanded] = useState(null)
    const { data: agreements, loading, reload } = useItsmResource(() => get('/sla/agreements'), [get])
    const { data: teamsData } = useItsmResource(() => get('/tenant/teams'), [get])
    const { data: vendorsData } = useItsmResource(() => get('/vendors'), [get])
    const { data: windowsData } = useItsmResource(() => get('/sla/coverage-windows'), [get])
    const list = agreements || []
    const teams = teamsData || []
    const vendors = vendorsData?.items || vendorsData || []
    const windows = windowsData || []

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Agreements (SLA / OLA / UC)</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New agreement</button>
            </div>
            <NewAgreementModal open={showNew} onClose={() => setShowNew(false)} teams={teams} vendors={vendors}
                onCreated={() => { setShowNew(false); reload() }} />
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0
                ? <EmptyState>No agreements yet.</EmptyState>
                : <ul className="space-y-1.5">
                    {list.map(a => (
                        <li key={a.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <div className="flex items-center justify-between gap-2">
                                <button className="flex items-center gap-2 min-w-0 text-left"
                                    onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                                    <KindBadge kind={a.kind} />
                                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{a.name}</span>
                                    <span className="text-xs text-slate-400">v{a.version} · {(a.targets || []).length} targets</span>
                                </button>
                                <button onClick={() => remove(`/sla/agreements/${a.id}`).then(reload)}
                                    className="text-xs text-red-500 hover:underline shrink-0">delete</button>
                            </div>
                            {expanded === a.id && <TargetsEditor agreement={a} windows={windows} onChanged={reload} />}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ── Rules ────────────────────────────────────────────────────────────────────

function RulesTab() {
    const { get, post, remove, patch } = useItsmApi()
    const { data: rules, loading, reload } = useItsmResource(() => get('/sla/rules'), [get])
    const { data: agreements } = useItsmResource(() => get('/sla/agreements'), [get])
    const [agreementId, setAgreementId] = useState('')
    const [priority, setPriority] = useState('')
    const [type, setType] = useState('')
    const [error, setError] = useState(null)
    const list = rules || []
    const ags = agreements || []
    const agName = (id) => ags.find(a => a.id === id)?.name || id

    const create = async () => {
        if (!agreementId) return
        setError(null)
        const conditions = {}
        if (priority) conditions.priority = priority
        if (type) conditions.type = type
        try { await post('/sla/rules', { agreement_id: agreementId, conditions }); setPriority(''); setType(''); reload() }
        catch (err) { setError(err) }
    }
    const move = async (idx, dir) => {
        const ids = list.map(r => r.id)
        const j = idx + dir
        if (j < 0 || j >= ids.length) return
        [ids[idx], ids[j]] = [ids[j], ids[idx]]
        try { await patch('/sla/rules/reorder', { ordered_ids: ids }); reload() } catch (err) { setError(err) }
    }

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Matching rules (first match wins)</h3>
            <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <select className="input text-xs" value={agreementId} onChange={e => setAgreementId(e.target.value)}>
                    <option value="">Agreement…</option>
                    {ags.filter(a => a.kind === 'sla').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select className="input text-xs" value={priority} onChange={e => setPriority(e.target.value)}>
                    <option value="">any priority</option>
                    {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <select className="input text-xs" value={type} onChange={e => setType(e.target.value)}>
                    <option value="">any type</option>
                    {['incident', 'service_request', 'problem', 'change'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="btn-primary text-xs" onClick={create} disabled={!agreementId}>+ Add rule</button>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0
                ? <EmptyState>No rules — tickets fall back to the default SLA path.</EmptyState>
                : <ul className="space-y-1">
                    {list.map((r, i) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-slate-400">#{r.position}</span>
                            <span className="flex-1 min-w-0 text-slate-600 dark:text-slate-300 truncate">
                                {Object.keys(r.conditions || {}).length === 0 ? 'any ticket' : JSON.stringify(r.conditions)} → {agName(r.agreement_id)}
                            </span>
                            <button onClick={() => move(i, -1)} className="text-slate-400 hover:text-slate-600">↑</button>
                            <button onClick={() => move(i, 1)} className="text-slate-400 hover:text-slate-600">↓</button>
                            <button onClick={() => remove(`/sla/rules/${r.id}`).then(reload)} className="text-red-500 hover:underline">del</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ── Coverage windows ──────────────────────────────────────────────────────────

function CoverageTab() {
    const { get, post, remove } = useItsmApi()
    const { data: windows, loading, reload } = useItsmResource(() => get('/sla/coverage-windows'), [get])
    const [name, setName] = useState('')
    const [tz, setTz] = useState('UTC')
    const [is247, setIs247] = useState(false)
    const [start, setStart] = useState('09:00')
    const [end, setEnd] = useState('17:00')
    const [error, setError] = useState(null)
    const list = windows || []

    const create = async () => {
        if (!name.trim()) return
        setError(null)
        try {
            await post('/sla/coverage-windows', {
                name, timezone: tz, is_247: is247, work_days: [1, 2, 3, 4, 5],
                windows: is247 ? null : [{ start, end }],
            })
            setName('')
            reload()
        } catch (err) { setError(err) }
    }

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Coverage windows</h3>
            <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                <input className="input text-xs w-40" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
                <input className="input text-xs w-32" placeholder="Timezone" value={tz} onChange={e => setTz(e.target.value)} />
                <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={is247} onChange={e => setIs247(e.target.checked)} /> 24×7</label>
                {!is247 && <>
                    <input type="time" className="input text-xs" value={start} onChange={e => setStart(e.target.value)} />
                    <input type="time" className="input text-xs" value={end} onChange={e => setEnd(e.target.value)} />
                </>}
                <button className="btn-primary text-xs" onClick={create} disabled={!name.trim()}>+ Add</button>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0
                ? <EmptyState>No coverage windows (Mon–Fri "Default" is created from Business Hours).</EmptyState>
                : <ul className="space-y-1">
                    {list.map(w => (
                        <li key={w.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-slate-600 dark:text-slate-300">
                                {w.name} · {w.is_247 ? '24×7' : (w.windows?.[0] ? `${w.windows[0].start}–${w.windows[0].end}` : '—')} · {w.timezone}
                            </span>
                            <button onClick={() => remove(`/sla/coverage-windows/${w.id}`).then(reload)} className="text-red-500 hover:underline">del</button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ── At-risk board ─────────────────────────────────────────────────────────────

function BoardTab() {
    const { get } = useItsmApi()
    const { data: atRisk, loading } = useItsmResource(() => get('/sla/reports/at-risk', { window_minutes: 240 }), [get])
    const { data: overview } = useItsmResource(() => get('/sla/reports/overview'), [get])
    const items = atRisk?.items || []

    return (
        <div className="space-y-3">
            {overview && (
                <div className="grid grid-cols-3 gap-2">
                    <Stat label="At risk" value={overview.at_risk ?? 0} />
                    <Stat label="Breached" value={overview.breached ?? 0} tone="danger" />
                    <Stat label="Compliance" value={overview.compliance_pct == null ? '—' : `${overview.compliance_pct}%`} />
                </div>
            )}
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">At risk (next 4h / overdue)</h3>
            {loading && <LoadingSpinner />}
            {!loading && (items.length === 0
                ? <EmptyState>Nothing at risk right now.</EmptyState>
                : <ul className="space-y-1">
                    {items.map(i => (
                        <li key={i.instance_id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-slate-600 dark:text-slate-300">#{i.ticket_number} · {i.metric.replace(/_/g, ' ')}</span>
                            <span className={i.remaining_seconds < 0 ? 'text-red-500' : 'text-amber-600'}>
                                {i.remaining_seconds < 0 ? 'overdue' : `${Math.round(i.remaining_seconds / 60)}m left`}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function Stat({ label, value, tone }) {
    return (
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-center">
            <div className={`text-lg font-semibold ${tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{value}</div>
            <div className="text-[11px] text-slate-400 uppercase tracking-wide">{label}</div>
        </div>
    )
}

// ── Section shell ─────────────────────────────────────────────────────────────

const TABS = [
    { id: 'agreements', label: 'Agreements', render: () => <AgreementsTab /> },
    { id: 'rules', label: 'Rules', render: () => <RulesTab /> },
    { id: 'coverage', label: 'Coverage', render: () => <CoverageTab /> },
    { id: 'board', label: 'At-risk', render: () => <BoardTab /> },
]

export default function SlaAgreementsSection() {
    const [tab, setTab] = useState('agreements')
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
