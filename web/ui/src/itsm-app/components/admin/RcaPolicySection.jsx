import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

const OPS = ['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'exists']
const FIELDS = ['ticket_type', 'priority', 'sla_breached', 'severity_rank', 'repeat_count_window', 'security_flag', 'manual_override']

// ── RCA policies ─────────────────────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove }) {
    return (
        <div className="flex items-center gap-1.5">
            <select className="input text-xs" value={cond.field} onChange={e => onChange({ ...cond, field: e.target.value })}>
                {FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="input text-xs" value={cond.op} onChange={e => onChange({ ...cond, op: e.target.value })}>
                {OPS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <input className="input text-xs flex-1" placeholder="value (JSON or plain text)"
                   value={typeof cond.value === 'string' ? cond.value : JSON.stringify(cond.value)}
                   onChange={e => {
                       let v = e.target.value
                       try { v = JSON.parse(v) } catch { /* keep as string */ }
                       onChange({ ...cond, value: v })
                   }} />
            <button onClick={onRemove} className="text-xs text-rose-500 hover:underline shrink-0">remove</button>
        </div>
    )
}

function PolicyCard({ policy, onChanged }) {
    const { patch, remove, post } = useItsmApi()
    const [conditions, setConditions] = useState(policy.conditions || [])
    const [outputs, setOutputs] = useState(policy.outputs || {})
    const [status, setStatus] = useState(policy.status)
    const [testResult, setTestResult] = useState(null)
    const [dirty, setDirty] = useState(false)

    const addCondition = () => { setConditions([...conditions, { field: FIELDS[0], op: 'eq', value: '' }]); setDirty(true) }
    const updateCondition = (i, next) => { const c = [...conditions]; c[i] = next; setConditions(c); setDirty(true) }
    const removeCondition = (i) => { setConditions(conditions.filter((_, idx) => idx !== i)); setDirty(true) }

    const save = async () => {
        try { await patch(`/tenant/rca-policies/${policy.id}`, { name: policy.name, status, conditions, outputs, priority: policy.priority }); setDirty(false); onChanged() }
        catch { /* ignore */ }
    }
    const del = async () => { try { await remove(`/tenant/rca-policies/${policy.id}`); onChanged() } catch { /* ignore */ } }
    const test = async () => {
        try { setTestResult(await post(`/tenant/rca-policies/${policy.id}/test`, { severity_rank: 1, sla_breached: true, priority: 'critical' })) }
        catch { /* ignore */ }
    }

    return (
        <li className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{policy.name} <span className="text-xs text-slate-400">· priority {policy.priority}</span></span>
                <div className="flex items-center gap-2">
                    <select className="input text-xs" value={status} onChange={e => { setStatus(e.target.value); setDirty(true) }}>
                        {['draft', 'active', 'disabled', 'archived'].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button onClick={del} className="text-xs text-rose-500 hover:underline">delete</button>
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Conditions (ALL must match)</p>
                {conditions.map((c, i) => <ConditionRow key={i} cond={c} onChange={n => updateCondition(i, n)} onRemove={() => removeCondition(i)} />)}
                <button onClick={addCondition} className="text-xs text-blue-600 hover:underline">+ condition</button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-slate-500">Due (days)
                    <input type="number" className="input text-xs w-16 ml-1" value={outputs.due_days ?? 3}
                           onChange={e => { setOutputs({ ...outputs, due_days: parseInt(e.target.value, 10) || 3 }); setDirty(true) }} />
                </label>
                <label className="text-xs text-slate-500">Owner role
                    <select className="input text-xs ml-1" value={outputs.owner_role || 'agent'}
                            onChange={e => { setOutputs({ ...outputs, owner_role: e.target.value }); setDirty(true) }}>
                        {['agent', 'team_lead', 'manager'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </label>
                <label className="text-xs text-slate-500">Approver role
                    <select className="input text-xs ml-1" value={outputs.approver_role || 'manager'}
                            onChange={e => { setOutputs({ ...outputs, approver_role: e.target.value }); setDirty(true) }}>
                        {['manager', 'admin'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </label>
            </div>
            <div className="flex items-center gap-2">
                {dirty && <button onClick={save} className="btn-primary text-xs">Save</button>}
                <button onClick={test} className="btn-ghost text-xs">Test policy (sev1 + SLA breach)</button>
                {testResult && (
                    <span className={`text-xs ${testResult.required ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {testResult.required ? `→ required, due in ${testResult.due_days}d` : '→ not required'}
                    </span>
                )}
            </div>
        </li>
    )
}

function NewPolicyForm({ onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [busy, setBusy] = useState(false)

    const create = async () => {
        if (!name.trim() || busy) return
        setBusy(true)
        try {
            await post('/tenant/rca-policies', { name: name.trim(), status: 'draft', conditions: [], outputs: { due_days: 3 }, priority: 100 })
            setName(''); onCreated()
        } catch { /* ignore */ } finally { setBusy(false) }
    }

    return (
        <div className="flex items-end gap-2">
            <input className="input text-sm flex-1" placeholder="New policy name" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn-primary text-xs" onClick={create} disabled={busy || !name.trim()}>{busy ? 'Adding…' : '+ Add policy'}</button>
        </div>
    )
}

function PoliciesTab() {
    const { get } = useItsmApi()
    const { data, loading, error, reload } = useItsmResource(() => get('/tenant/rca-policies'), [get])
    const policies = data?.items || []
    return (
        <div className="space-y-3">
            <NewPolicyForm onCreated={reload} />
            <p className="text-xs text-slate-400">
                Policies are evaluated by priority (lowest first); the first <b>active</b> policy whose conditions all match wins.
                If no policy matches (or none are active), a built-in default requires an RCA for Sev1 closures, critical/high SLA breaches, security flags, and manager overrides.
            </p>
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (policies.length === 0
                ? <EmptyState>No RCA policies yet — the built-in default trigger table applies.</EmptyState>
                : <ul className="space-y-1.5">{policies.map(p => <PolicyCard key={p.id} policy={p} onChanged={reload} />)}</ul>
            )}
        </div>
    )
}

// ── Recording policy singleton ───────────────────────────────────────────────

function RecordingPolicyTab() {
    const { get, patch } = useItsmApi()
    const { data, loading, error, reload } = useItsmResource(() => get('/tenant/recording-policies'), [get])
    const [form, setForm] = useState(null)
    const policy = form || data

    const set = (k) => (e) => setForm({ ...(form || data), [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
    const save = async () => { try { await patch('/tenant/recording-policies', form); setForm(null); reload() } catch { /* ignore */ } }

    if (loading) return <LoadingSpinner />
    if (error) return <ErrorBanner message={error.message} />
    if (!policy) return null

    return (
        <div className="space-y-2.5 max-w-md">
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={policy.block_link_if_missing_consent} onChange={set('block_link_if_missing_consent')} />
                Block linking a recording if consent is missing
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={policy.allow_ai_summary} onChange={set('allow_ai_summary')} />
                Allow AI-generated recording summaries
            </label>
            <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={policy.allow_manual_upload} onChange={set('allow_manual_upload')} />
                Allow manual recording file upload
            </label>
            <label className="text-sm block">Retention (days)
                <input type="number" className="input text-sm w-24 ml-2" value={policy.recording_retention_days} onChange={set('recording_retention_days')} />
            </label>
            {form && <button className="btn-primary text-xs" onClick={save}>Save</button>}
        </div>
    )
}

const TABS = [
    { id: 'policies', label: 'RCA Policies', render: () => <PoliciesTab /> },
    { id: 'recording', label: 'Recording Policy', render: () => <RecordingPolicyTab /> },
]

export default function RcaPolicySection() {
    const [tab, setTab] = useState('policies')
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
