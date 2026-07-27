import { useCallback, useEffect, useState } from 'react'
import { useItsmApi, useUserDirectory } from '../../shared/itsm/useItsmApi'
import { ItsmTenantScope } from '../../shared/itsm/ItsmTenantContext'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'
import { PageHeader } from '../../shared/itsm/ui'
import RcaPanel from '../components/RcaPanel'

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
        // Carry the alert's own service forward — without this, the incident
        // never attaches to a service, so it can't flip that service's
        // internal_metric SLO (uptime/incident_free) to "bad" even though this
        // is exactly the path a burn-alert-triggered declare goes through.
        const body = { title: a.title, source_alert_id: a.id }
        if (a.service_id) body.affected_service_ids = [a.service_id]
        try { await post('/incidents', body); load() } catch (e) { setError(e) }
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
    // Mutating actions need the incident's OWN tenant — a platform user's
    // cross-tenant "All tenants" view carries no X-Tenant-ID by default, which
    // 403s writes ("Tenant context required") even though reads (scoped via
    // the backend's cross-tenant _scope() fallback) already succeeded above.
    // Mirrors TicketDetailPage's explicit useItsmApi(ticket?.tenant_id) pattern.
    const { post: scopedPost } = useItsmApi(inc?.tenant_id)
    const users = useUserDirectory(inc?.tenant_id)
    const [timeline, setTimeline] = useState([])
    const [roles, setRoles] = useState([])
    const [status, setStatus] = useState('')
    const [roleUser, setRoleUser] = useState('')
    const [role, setRole] = useState('ic')
    const [update, setUpdate] = useState('')
    const [error, setError] = useState(null)

    const load = useCallback(() => {
        get(`/incidents/${incidentId}`).then(setInc).catch(setError)
        get(`/incidents/${incidentId}/timeline`).then(d => setTimeline(d.events || [])).catch(() => {})
        get(`/incidents/${incidentId}/roles`).then(d => setRoles(d.roles || [])).catch(() => {})
    }, [get, incidentId])
    useEffect(() => { load() }, [load])

    const changeStatus = async () => {
        if (!status) return
        try { await scopedPost(`/incidents/${incidentId}/change-status`, { status }); setStatus(''); load(); onChanged?.() }
        catch (e) { setError(e) }
    }
    const assignRole = async () => {
        if (!roleUser) return
        try { await scopedPost(`/incidents/${incidentId}/assign-role`, { role, user_id: roleUser }); setRoleUser(''); load() }
        catch (e) { setError(e) }
    }
    const postUpdate = async () => {
        if (!update.trim()) return
        try { await scopedPost(`/incidents/${incidentId}/status-updates`, { body: update, audience: 'public' }); setUpdate(''); load() }
        catch (e) { setError(e) }
    }
    const genPir = async () => { try { await scopedPost(`/incidents/${incidentId}/pir-draft`, {}); load() } catch (e) { setError(e) } }

    if (error && !inc) return <ErrorBanner message={error.message} />
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

            {roles.length > 0 && (
                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                    {roles.map(r => <span key={r.role}><b className="text-slate-700 dark:text-slate-300 uppercase">{r.role}</b> {users[r.user_id] || r.user_id.slice(0, 8)}</span>)}
                </div>
            )}
            <div className="flex items-end gap-2">
                <select className="input text-xs" value={role} onChange={e => setRole(e.target.value)}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="input text-xs flex-1" value={roleUser} onChange={e => setRoleUser(e.target.value)}>
                    <option value="">Assign to…</option>
                    {Object.entries(users).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button className="btn-ghost text-xs" onClick={assignRole} disabled={!roleUser}>Assign</button>
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
                            {e.data?.to ? ` → ${e.data.to}` : ''}
                            {e.data?.role ? ` (${e.data.role})` : ''}
                            {e.data?.user_id ? ` → ${users[e.data.user_id] || e.data.user_id.slice(0, 8)}` : ''}
                        </li>
                    ))}
                </ul>
            </div>

            <ItsmTenantScope tenantId={inc.tenant_id}>
                <RcaPanel incidentId={incidentId} incidentTitle={inc.title} />
            </ItsmTenantScope>
        </div>
    )
}

// ── Incidents tab (master/detail) ─────────────────────────────────────────────
// Exported (not just used internally) so it can be unit-tested directly
// without needing to render the whole page/tab chrome.
export function IncidentsTab() {
    const { get } = useItsmApi()
    // `incidents`/`selected` are stored TOGETHER with the `get` reference they
    // were fetched under. IncidentDetail is a child that reads the SAME
    // ambient tenant context via its own useItsmApi(), so on a tenant switch
    // it would independently re-fire its own fetch for whatever incidentId it
    // currently has — the OLD tenant's selection — under the NEW tenant
    // scope. A fix that clears the selection in a sibling useEffect can't
    // reliably close that gap: React runs a CHILD's effects before its
    // PARENT's effects within the same commit, so IncidentDetail's stale
    // fetch fires before this component's own "clear" effect ever runs.
    // Deriving staleness DURING RENDER instead sidesteps effect ordering
    // entirely — the very first render after `get` changes already treats the
    // old data as gone, before IncidentDetail ever gets a chance to mount
    // with a mismatched incidentId.
    const [state, setState] = useState({ get: null, incidents: null, selected: null })
    const [error, setError] = useState(null)
    const isStale = state.get !== get
    const incidents = isStale ? null : state.incidents
    const selected = isStale ? null : state.selected

    const load = useCallback(() => {
        get('/incidents').then(d => {
            setState(prev => ({
                get,
                incidents: d,
                // Re-validate the previous selection against the fresh list —
                // e.g. switching tenants reloads this list, and a selection
                // from the previous tenant would otherwise keep pointing at
                // an incident id that's no longer in scope (404 on fetch).
                selected: (prev.selected && d.some(i => i.id === prev.selected)) ? prev.selected : (d[0]?.id ?? null),
            }))
        }).catch(setError)
    }, [get])
    useEffect(() => { load() }, [load])

    const setSelected = (id) => setState(prev => ({ ...prev, selected: id }))

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
