import { useCallback, useEffect, useState } from 'react'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'
import { PageHeader } from '../../shared/itsm/ui'

const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved', 'postmortem', 'closed', 'cancelled']
const ROLES = ['ic', 'comms', 'ops', 'scribe']

function StatusPill({ status }) {
    const tone = status === 'resolved' || status === 'closed' ? 'bg-emerald-100 text-emerald-700'
        : status === 'cancelled' ? 'bg-slate-100 text-slate-600'
        : 'bg-amber-100 text-amber-700'
    return <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${tone}`}>{status}</span>
}

// ── Alerts inbox ──────────────────────────────────────────────────────────────

function AlertsTab() {
    const { get, post } = useItsmApi()
    const [alerts, setAlerts] = useState(null)
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        get('/alerts', { status: 'open' }).then(setAlerts).catch(setError)
    }, [get])
    useEffect(() => { load() }, [load])

    const act = async (id, action) => {
        try { await post(`/alerts/${id}/${action}`, {}); load() } catch (e) { setError(e) }
    }
    const declare = async (a) => {
        try { await post('/incidents', { title: a.title, source_alert_id: a.id }); load() } catch (e) { setError(e) }
    }

    if (error) return <ErrorBanner message={error.message} />
    if (alerts === null) return <LoadingSpinner />
    if (alerts.length === 0) return <EmptyState>No open alerts.</EmptyState>
    return (
        <ul className="space-y-1.5">
            {alerts.map(a => (
                <li key={a.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    <div className="min-w-0">
                        <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{a.title}</p>
                        <p className="text-xs text-slate-400">{a.source} · ×{a.occurrence_count}{a.incident_id ? ' · linked' : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => act(a.id, 'acknowledge')} className="btn-ghost text-xs">Ack</button>
                        <button onClick={() => act(a.id, 'resolve')} className="btn-ghost text-xs">Resolve</button>
                        {!a.incident_id && <button onClick={() => declare(a)} className="btn-primary text-xs">Declare incident</button>}
                    </div>
                </li>
            ))}
        </ul>
    )
}

// ── Incident detail ───────────────────────────────────────────────────────────

function IncidentDetail({ incidentId, onChanged }) {
    const { get, post } = useItsmApi()
    const [inc, setInc] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [status, setStatus] = useState('')
    const [roleUser, setRoleUser] = useState('')
    const [role, setRole] = useState('ic')
    const [update, setUpdate] = useState('')
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        get(`/incidents/${incidentId}`).then(setInc).catch(setError)
        get(`/incidents/${incidentId}/timeline`).then(d => setTimeline(d.events || [])).catch(() => {})
    }, [get, incidentId])
    useEffect(() => { load() }, [load])

    const changeStatus = async () => {
        if (!status) return
        try { await post(`/incidents/${incidentId}/change-status`, { status }); setStatus(''); load(); onChanged?.() }
        catch (e) { setError(e) }
    }
    const assignRole = async () => {
        if (!roleUser.trim()) return
        try { await post(`/incidents/${incidentId}/assign-role`, { role, user_id: roleUser.trim() }); setRoleUser(''); load() }
        catch (e) { setError(e) }
    }
    const postUpdate = async () => {
        if (!update.trim()) return
        try { await post(`/incidents/${incidentId}/status-updates`, { body: update, audience: 'public' }); setUpdate(''); load() }
        catch (e) { setError(e) }
    }
    const genPir = async () => { try { await post(`/incidents/${incidentId}/pir-draft`, {}); load() } catch (e) { setError(e) } }

    if (!inc) return <LoadingSpinner />
    return (
        <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{inc.incident_number}</span>
                <StatusPill status={inc.status} />
            </div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">{inc.title}</h3>
            {error && <ErrorBanner message={error.message} />}

            <div className="flex items-end gap-2">
                <select className="input text-xs" value={status} onChange={e => setStatus(e.target.value)}>
                    <option value="">Change status…</option>
                    {INCIDENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button className="btn-primary text-xs" onClick={changeStatus} disabled={!status}>Apply</button>
                <button className="btn-ghost text-xs" onClick={genPir}>Generate PIR draft</button>
            </div>

            <div className="flex items-end gap-2">
                <select className="input text-xs" value={role} onChange={e => setRole(e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <input className="input text-xs flex-1" placeholder="assign user-id" value={roleUser} onChange={e => setRoleUser(e.target.value)} />
                <button className="btn-ghost text-xs" onClick={assignRole} disabled={!roleUser.trim()}>Assign</button>
            </div>

            <div className="flex items-end gap-2">
                <input className="input text-xs flex-1" placeholder="post status update (public)" value={update} onChange={e => setUpdate(e.target.value)} />
                <button className="btn-ghost text-xs" onClick={postUpdate} disabled={!update.trim()}>Post</button>
            </div>

            <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Timeline</p>
                <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {timeline.map((e, i) => (
                        <li key={i} className="text-xs text-slate-500">
                            <span className="text-slate-400">{e.at ? new Date(e.at).toLocaleTimeString() : ''}</span> · {e.event_type}
                            {e.data?.to ? ` → ${e.data.to}` : ''}{e.data?.role ? ` (${e.data.role})` : ''}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

// ── Incidents tab (master/detail) ─────────────────────────────────────────────

function IncidentsTab() {
    const { get } = useItsmApi()
    const [incidents, setIncidents] = useState(null)
    const [selected, setSelected] = useState(null)
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        get('/incidents').then(d => { setIncidents(d); if (!selected && d.length) setSelected(d[0].id) }).catch(setError)
    }, [get, selected])
    useEffect(() => { load() }, [load])

    if (error) return <ErrorBanner message={error.message} />
    if (incidents === null) return <LoadingSpinner />
    if (incidents.length === 0) return <EmptyState>No incidents. Declare one from an alert.</EmptyState>
    return (
        <div className="grid md:grid-cols-2 gap-4">
            <ul className="space-y-1">
                {incidents.map(i => (
                    <li key={i.id}>
                        <button onClick={() => setSelected(i.id)}
                            className={`w-full text-left p-2.5 rounded-lg text-sm ${selected === i.id ? 'bg-blue-50 dark:bg-blue-500/10' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                            <span className="font-mono text-xs text-slate-400">{i.incident_number}</span> <StatusPill status={i.status} />
                            <p className="text-slate-700 dark:text-slate-300 truncate">{i.title}</p>
                        </button>
                    </li>
                ))}
            </ul>
            <div className="card p-4">
                {selected ? <IncidentDetail incidentId={selected} onChanged={load} /> : <EmptyState>Select an incident.</EmptyState>}
            </div>
        </div>
    )
}

export default function IncidentsPage() {
    const [tab, setTab] = useState('alerts')
    return (
        <div className="space-y-4">
            <PageHeader title="Incidents & Alerts" subtitle="Alert triage, incident command, and response" />
            <div className="flex gap-1 border-b border-slate-100 dark:border-slate-700">
                {[['alerts', 'Alerts'], ['incidents', 'Incidents']].map(([id, label]) => (
                    <button key={id} onClick={() => setTab(id)}
                        className={`px-3 py-1.5 text-sm font-medium -mb-px border-b-2 ${tab === id
                            ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                        {label}
                    </button>
                ))}
            </div>
            {tab === 'alerts' ? <AlertsTab /> : <IncidentsTab />}
        </div>
    )
}
