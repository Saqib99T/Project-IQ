import { useState } from 'react'
import { useItsmApi, useItsmResource, useUserDirectory } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

// Small checkbox list of tenant users — replaces free-text user-id entry
// wherever an admin needs to pick one or more people (nobody has user ids
// memorized). `selected` is a Set of user ids; `onToggle(id)` flips one.
function UserPicker({ selected, onToggle, emptyHint }) {
    const users = useUserDirectory()
    const entries = Object.entries(users)
    if (entries.length === 0) {
        return <p className="text-xs text-slate-400 italic">{emptyHint || 'No users found for this tenant yet.'}</p>
    }
    return (
        <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
            {entries.map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
                    <input type="checkbox" checked={selected.has(id)} onChange={() => onToggle(id)} className="rounded" />
                    {name}
                </label>
            ))}
        </div>
    )
}

// ── Services ──────────────────────────────────────────────────────────────────

function ServicesTab() {
    const { get, post, remove } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get('/services'), [get])
    const { data: policies } = useItsmResource(() => get('/on-call/escalation-policies'), [get])
    const [name, setName] = useState('')
    const [policyId, setPolicyId] = useState('')
    const [error, setError] = useState(null)
    const list = data || []
    const pols = policies || []

    const create = async () => {
        if (!name.trim()) return
        setError(null)
        try { await post('/services', { name, escalation_policy_id: policyId || null }); setName(''); setPolicyId(''); reload() }
        catch (e) { setError(e) }
    }
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <input className="input text-sm w-48" placeholder="Service name" value={name} onChange={e => setName(e.target.value)} />
                <select className="input text-sm" value={policyId} onChange={e => setPolicyId(e.target.value)}>
                    <option value="">No escalation policy</option>
                    {pols.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button className="btn-primary text-xs" onClick={create} disabled={!name.trim()}>+ Add service</button>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0 ? <EmptyState>No services.</EmptyState> : (
                <ul className="space-y-1">
                    {list.map(s => (
                        <li key={s.id} className="flex items-center justify-between text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                            <span className="text-slate-700 dark:text-slate-300">{s.name}
                                <span className="ml-2 text-xs text-slate-400">{s.current_state}</span></span>
                            <button onClick={() => remove(`/services/${s.id}`).then(reload)} className="text-xs text-red-500 hover:underline">delete</button>
                        </li>
                    ))}
                </ul>
            ))}
        </div>
    )
}

// ── Schedules ─────────────────────────────────────────────────────────────────

function ScheduleCard({ sch, onChanged }) {
    const { get, post, remove } = useItsmApi()
    const { data: full, reload } = useItsmResource(() => get(`/on-call/schedules/${sch.id}`), [get, sch.id])
    const users = useUserDirectory()
    const [onCall, setOnCall] = useState(null)
    const [selected, setSelected] = useState(() => new Set())
    const layers = full?.layers || []

    const toggle = (id) => setSelected(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
    })
    const whoNow = async () => {
        try { const r = await get(`/on-call/schedules/${sch.id}/preview`); setOnCall(r) } catch { /* ignore */ }
    }
    const addLayer = async () => {
        const ids = [...selected]
        try { await post(`/on-call/schedules/${sch.id}/layers`, { layer_rank: layers.length + 1, participants: ids }); setSelected(new Set()); reload() } catch { /* ignore */ }
    }
    const removeLayer = async (layerId) => {
        try { await remove(`/on-call/schedules/${sch.id}/layers/${layerId}`); reload() } catch { /* ignore */ }
    }
    const deleteSchedule = async () => {
        if (!window.confirm(`Delete schedule "${sch.name}"? Any escalation step pointing at it will stop working.`)) return
        try { await remove(`/on-call/schedules/${sch.id}`); onChanged() } catch { /* ignore */ }
    }
    return (
        <li className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{sch.name} <span className="text-xs text-slate-400">· {sch.rotation_type}</span></span>
                <div className="flex items-center gap-3">
                    <button onClick={whoNow} className="text-xs text-blue-600 hover:underline">who's on call?</button>
                    <button onClick={deleteSchedule} className="text-xs text-red-500 hover:underline">delete</button>
                </div>
            </div>
            {onCall && (
                <p className="text-xs text-slate-500">Primary now: <span className="font-medium">{users[onCall.primary_user_id] || onCall.primary_user_id || '—'}</span></p>
            )}
            {layers.map(l => (
                <p key={l.id} className="text-xs text-slate-500 flex items-center gap-2">
                    <span>Layer {l.layer_rank}: {(l.participants || []).map(id => users[id] || id.slice(0, 8)).join(', ') || '—'}</span>
                    <button onClick={() => removeLayer(l.id)} className="text-red-400 hover:underline">remove</button>
                </p>
            ))}
            <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Add layer — pick who's in the rotation</p>
                <UserPicker selected={selected} onToggle={toggle} />
                <button className="btn-ghost text-xs" onClick={addLayer} disabled={selected.size === 0}>+ layer ({selected.size} selected)</button>
            </div>
        </li>
    )
}

function SchedulesTab() {
    const { get, post } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get('/on-call/schedules'), [get])
    const [name, setName] = useState('')
    const [rotation, setRotation] = useState('weekly')
    const [error, setError] = useState(null)
    const list = data || []

    const create = async () => {
        if (!name.trim()) return
        setError(null)
        try { await post('/on-call/schedules', { name, rotation_type: rotation, start_at: new Date().toISOString() }); setName(''); reload() }
        catch (e) { setError(e) }
    }
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
                <input className="input text-sm w-48" placeholder="Schedule name" value={name} onChange={e => setName(e.target.value)} />
                <select className="input text-sm" value={rotation} onChange={e => setRotation(e.target.value)}>
                    {['daily', 'weekly', 'custom', 'follow_the_sun'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button className="btn-primary text-xs" onClick={create} disabled={!name.trim()}>+ Add schedule</button>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0 ? <EmptyState>No schedules.</EmptyState> : (
                <ul className="space-y-1.5">{list.map(s => <ScheduleCard key={s.id} sch={s} onChanged={reload} />)}</ul>
            ))}
        </div>
    )
}

// ── Escalation policies ───────────────────────────────────────────────────────

function PolicyCard({ pol }) {
    const { get, post } = useItsmApi()
    const { data: full, reload } = useItsmResource(() => get(`/on-call/escalation-policies`), [get])
    const users = useUserDirectory()
    const [test, setTest] = useState(null)
    const me = (full || []).find(p => p.id === pol.id) || pol
    const [uid, setUid] = useState('')

    const addStep = async () => {
        if (!uid) return
        try { await post(`/on-call/escalation-policies/${pol.id}/steps`, { position: (me.steps?.length || 0) + 1, target_type: 'user', target_id: uid, timeout_minutes: 15 }); setUid(''); reload() } catch { /* ignore */ }
    }
    const runTest = async () => { try { setTest(await post(`/on-call/escalation-policies/${pol.id}/test`, {})) } catch { /* ignore */ } }
    return (
        <li className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{me.name} <span className="text-xs text-slate-400">· {me.steps?.length || 0} steps</span></span>
                <button onClick={runTest} className="text-xs text-blue-600 hover:underline">test</button>
            </div>
            {test && <div className="text-xs text-slate-500">{test.steps.map(s => `#${s.position} ${s.target_type}→${users[s.would_page[0]] || (s.would_page[0] || '—').slice(0, 8)}`).join(' · ')}</div>}
            {(me.steps || []).map(s => (
                <p key={s.id} className="text-xs text-slate-500">Step {s.position}: {s.target_type === 'user' ? (users[s.target_id] || s.target_id.slice(0, 8)) : s.target_type} · {s.timeout_minutes}m timeout</p>
            ))}
            <div className="flex items-center gap-2">
                <select className="input text-xs flex-1" value={uid} onChange={e => setUid(e.target.value)}>
                    <option value="">Escalate to…</option>
                    {Object.entries(users).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button className="btn-ghost text-xs" onClick={addStep} disabled={!uid}>+ step (user)</button>
            </div>
        </li>
    )
}

function EscalationTab() {
    const { get, post } = useItsmApi()
    const { data, loading, reload } = useItsmResource(() => get('/on-call/escalation-policies'), [get])
    const [name, setName] = useState('')
    const list = data || []
    const create = async () => { if (!name.trim()) return; try { await post('/on-call/escalation-policies', { name }); setName(''); reload() } catch { /* ignore */ } }
    return (
        <div className="space-y-3">
            <div className="flex items-end gap-2">
                <input className="input text-sm w-56" placeholder="Policy name" value={name} onChange={e => setName(e.target.value)} />
                <button className="btn-primary text-xs" onClick={create} disabled={!name.trim()}>+ Add policy</button>
            </div>
            {loading && <LoadingSpinner />}
            {!loading && (list.length === 0 ? <EmptyState>No escalation policies.</EmptyState> : (
                <ul className="space-y-1.5">{list.map(p => <PolicyCard key={p.id} pol={p} />)}</ul>
            ))}
        </div>
    )
}

const TABS = [
    { id: 'services', label: 'Services', render: () => <ServicesTab /> },
    { id: 'schedules', label: 'Schedules', render: () => <SchedulesTab /> },
    { id: 'escalation', label: 'Escalation', render: () => <EscalationTab /> },
]

export default function OnCallSection() {
    const [tab, setTab] = useState('services')
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
