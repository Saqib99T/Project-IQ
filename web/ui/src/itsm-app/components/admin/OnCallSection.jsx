import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

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
    const { get, post } = useItsmApi()
    const { data: full, reload } = useItsmResource(() => get(`/on-call/schedules/${sch.id}`), [get, sch.id])
    const [onCall, setOnCall] = useState(null)
    const [participants, setParticipants] = useState('')
    const layers = full?.layers || []

    const whoNow = async () => {
        try { const r = await get(`/on-call/schedules/${sch.id}/preview`); setOnCall(r) } catch { /* ignore */ }
    }
    const addLayer = async () => {
        const ids = participants.split(',').map(s => s.trim()).filter(Boolean)
        try { await post(`/on-call/schedules/${sch.id}/layers`, { layer_rank: layers.length + 1, participants: ids }); setParticipants(''); reload() } catch { /* ignore */ }
    }
    return (
        <li className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{sch.name} <span className="text-xs text-slate-400">· {sch.rotation_type}</span></span>
                <button onClick={whoNow} className="text-xs text-blue-600 hover:underline">who's on call?</button>
            </div>
            {onCall && (
                <p className="text-xs text-slate-500">Primary now: <span className="font-mono">{onCall.primary_user_id?.slice(0, 8) || '—'}</span></p>
            )}
            <div className="text-xs text-slate-500">{layers.length} layer(s)</div>
            <div className="flex items-center gap-2">
                <input className="input text-xs flex-1" placeholder="participant user-ids (comma-sep)" value={participants} onChange={e => setParticipants(e.target.value)} />
                <button className="btn-ghost text-xs" onClick={addLayer} disabled={!participants.trim()}>+ layer</button>
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
    const [test, setTest] = useState(null)
    const me = (full || []).find(p => p.id === pol.id) || pol
    const [uid, setUid] = useState('')

    const addStep = async () => {
        if (!uid.trim()) return
        try { await post(`/on-call/escalation-policies/${pol.id}/steps`, { position: (me.steps?.length || 0) + 1, target_type: 'user', target_id: uid.trim(), timeout_minutes: 15 }); setUid(''); reload() } catch { /* ignore */ }
    }
    const runTest = async () => { try { setTest(await post(`/on-call/escalation-policies/${pol.id}/test`, {})) } catch { /* ignore */ } }
    return (
        <li className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{me.name} <span className="text-xs text-slate-400">· {me.steps?.length || 0} steps</span></span>
                <button onClick={runTest} className="text-xs text-blue-600 hover:underline">test</button>
            </div>
            {test && <div className="text-xs text-slate-500">{test.steps.map(s => `#${s.position} ${s.target_type}→${(s.would_page[0] || '—').slice(0, 8)}`).join(' · ')}</div>}
            <div className="flex items-center gap-2">
                <input className="input text-xs flex-1" placeholder="step target user-id" value={uid} onChange={e => setUid(e.target.value)} />
                <button className="btn-ghost text-xs" onClick={addStep} disabled={!uid.trim()}>+ step (user)</button>
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
