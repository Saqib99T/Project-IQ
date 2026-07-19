import { useState } from 'react'
import { useItsmApi, useItsmResource, useUserDirectory } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'

const STATUS_TONE = {
    required: 'bg-amber-100 text-amber-700', draft: 'bg-slate-100 text-slate-600',
    under_review: 'bg-blue-100 text-blue-700', approved: 'bg-indigo-100 text-indigo-700',
    actions_in_progress: 'bg-indigo-100 text-indigo-700', completed: 'bg-emerald-100 text-emerald-700',
    rejected: 'bg-rose-100 text-rose-700', waived: 'bg-slate-100 text-slate-500',
    overdue: 'bg-rose-100 text-rose-700',
}

function StatusPill({ status }) {
    return <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${STATUS_TONE[status] || 'bg-slate-100 text-slate-600'}`}>{status.replace(/_/g, ' ')}</span>
}

const NARRATIVE_FIELDS = [
    ['executive_summary', 'Executive summary'],
    ['root_cause_statement', 'Root cause statement'],
    ['customer_impact', 'Customer impact'],
    ['contributing_factors', 'Contributing factors'],
    ['detection_gap', 'Detection gap'],
    ['response_gap', 'Response gap'],
    ['prevention_plan', 'Prevention plan'],
]

function NarrativeEditor({ rca, onSaved, canEdit }) {
    const { patch } = useItsmApi()
    const [draft, setDraft] = useState(() => Object.fromEntries(NARRATIVE_FIELDS.map(([k]) => [k, rca[k] || ''])))
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)

    const set = (k) => (e) => { setDraft(d => ({ ...d, [k]: e.target.value })); setDirty(true) }
    const save = async () => {
        setSaving(true)
        try { await patch(`/rca/${rca.id}`, draft); onSaved(); setDirty(false) }
        catch { /* ignore */ } finally { setSaving(false) }
    }

    return (
        <div className="space-y-2.5">
            {NARRATIVE_FIELDS.map(([key, label]) => (
                <div key={key}>
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</label>
                    <textarea
                        className="input text-xs w-full min-h-[50px]"
                        value={draft[key]} onChange={set(key)} disabled={!canEdit}
                    />
                </div>
            ))}
            {canEdit && <button className="btn-primary text-xs" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save narrative'}</button>}
        </div>
    )
}

function EvidenceChecklist({ rcaId, canManage }) {
    const { get, patch, post } = useItsmApi()
    const { data, reload } = useItsmResource(() => get(`/rca/${rcaId}/evidence-checklist`), [get, rcaId])
    const items = data?.items || []

    const markProvided = async (id) => { try { await patch(`/rca/${rcaId}/evidence-checklist/${id}`, { status: 'provided' }); reload() } catch { /* ignore */ } }
    const waive = async (id) => {
        const reason = window.prompt('Reason for waiving this evidence item:')
        if (!reason) return
        try { await post(`/rca/${rcaId}/evidence-checklist/${id}/waive`, { reason }); reload() } catch { /* ignore */ }
    }

    if (!items.length) return null
    return (
        <div className="space-y-1">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Evidence checklist</p>
            <ul className="space-y-1">
                {items.map(i => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-600 dark:text-slate-300">{i.evidence_type.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                                i.status === 'missing' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{i.status}</span>
                            {i.status === 'missing' && (
                                <>
                                    <button onClick={() => markProvided(i.id)} className="text-blue-600 hover:underline">Mark provided</button>
                                    {canManage && <button onClick={() => waive(i.id)} className="text-slate-400 hover:underline">Waive</button>}
                                </>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}

function ActionItems({ rcaId, canManage }) {
    const { get, post } = useItsmApi()
    const users = useUserDirectory()
    const { data, reload } = useItsmResource(() => get(`/rca/${rcaId}/actions`), [get, rcaId])
    const items = data?.items || []
    const [desc, setDesc] = useState('')
    const [priority, setPriority] = useState('medium')

    const add = async () => {
        if (!desc.trim()) return
        try { await post(`/rca/${rcaId}/actions`, { description: desc.trim(), priority }); setDesc(''); reload() } catch { /* ignore */ }
    }
    const verify = async (id) => { try { await post(`/rca/${rcaId}/actions/${id}/verify`, {}); reload() } catch { /* ignore */ } }
    const acceptRisk = async (id) => {
        const reason = window.prompt('Reason for accepting risk on this action item:')
        if (!reason) return
        try { await post(`/rca/${rcaId}/actions/${id}/accept-risk`, { reason }); reload() } catch { /* ignore */ }
    }

    return (
        <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Action items</p>
            <ul className="space-y-1">
                {items.map(i => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-xs p-1.5 rounded bg-slate-50 dark:bg-slate-800/50">
                        <span className="text-slate-600 dark:text-slate-300 truncate">{i.title || i.description}
                            <span className="ml-1.5 text-slate-400">· {i.priority} · {i.status}{i.owner_id ? ` · ${users[i.owner_id] || i.owner_id.slice(0, 8)}` : ''}</span>
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                            {i.status === 'done' && !i.verified_by && <button onClick={() => verify(i.id)} className="text-blue-600 hover:underline">Verify</button>}
                            {canManage && i.status !== 'done' && i.status !== 'cancelled' && i.status !== 'accepted_risk' && (
                                <button onClick={() => acceptRisk(i.id)} className="text-slate-400 hover:underline">Accept risk</button>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
            <div className="flex items-end gap-2">
                <input className="input text-xs flex-1" placeholder="New action item" value={desc} onChange={e => setDesc(e.target.value)} />
                <select className="input text-xs" value={priority} onChange={e => setPriority(e.target.value)}>
                    {['low', 'medium', 'high', 'critical'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn-ghost text-xs" onClick={add} disabled={!desc.trim()}>+ Add</button>
            </div>
        </div>
    )
}

function AiDraftSection({ rcaId, onAccepted }) {
    const { post } = useItsmApi()
    const [draft, setDraft] = useState(null)
    const [busy, setBusy] = useState(false)

    const generate = async () => {
        setBusy(true)
        try { setDraft(await post(`/rca/${rcaId}/generate-ai-draft`, {})) } catch { /* ignore */ } finally { setBusy(false) }
    }
    const accept = async () => {
        try { await post(`/rca/${rcaId}/ai-draft/${draft.id}/accept`, {}); setDraft(null); onAccepted() } catch { /* ignore */ }
    }
    const reject = async () => {
        try { await post(`/rca/${rcaId}/ai-draft/${draft.id}/reject`, {}); setDraft(null) } catch { /* ignore */ }
    }

    return (
        <div className="space-y-1.5">
            <button className="btn-ghost text-xs" onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate AI draft'}</button>
            {draft && (
                <div className="p-2.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 space-y-1.5 text-xs">
                    <p className="font-medium text-indigo-700 dark:text-indigo-300">AI draft (model: {draft.model_version})</p>
                    <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{draft.summary}</p>
                    <div className="flex items-center gap-2">
                        <button onClick={accept} className="text-emerald-600 hover:underline">Accept into RCA</button>
                        <button onClick={reject} className="text-rose-600 hover:underline">Reject</button>
                    </div>
                </div>
            )}
        </div>
    )
}

// Client-side mirror of the backend state machine, for showing/hiding action
// buttons — the server's 409 (with valid_transitions) is always authoritative.
const NEXT_STEPS = {
    required: ['draft', 'waived'], draft: ['under_review', 'waived'],
    under_review: ['approved', 'rejected'], rejected: ['draft'],
    approved: ['actions_in_progress', 'completed'], actions_in_progress: ['completed'],
}

function LifecycleActions({ rca, canManage, onChanged }) {
    const { post } = useItsmApi()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const next = NEXT_STEPS[rca.status] || []

    const run = async (action, body) => {
        setBusy(true); setError(null)
        try { await post(`/rca/${rca.id}/${action}`, body || {}); onChanged() }
        catch (e) { setError(e) } finally { setBusy(false) }
    }
    const reject = () => { const reason = window.prompt('Reason for rejecting:'); if (reason) run('reject', { reason }) }
    const waive = () => { const reason = window.prompt('Reason for waiving:'); if (reason) run('waive', { reason }) }

    return (
        <div className="space-y-1.5">
            {error && <ErrorBanner message={error.message} />}
            <div className="flex flex-wrap gap-2">
                {next.includes('under_review') && <button className="btn-primary text-xs" onClick={() => run('submit')} disabled={busy}>Submit for review</button>}
                {canManage && next.includes('approved') && <button className="btn-primary text-xs" onClick={() => run('approve')} disabled={busy}>Approve</button>}
                {canManage && rca.status === 'under_review' && <button className="btn-ghost text-xs text-rose-600" onClick={reject} disabled={busy}>Reject</button>}
                {canManage && next.includes('waived') && <button className="btn-ghost text-xs" onClick={waive} disabled={busy}>Waive</button>}
                {rca.status === 'actions_in_progress' && <button className="btn-primary text-xs" onClick={() => run('complete')} disabled={busy}>Complete</button>}
                {canManage && (rca.status === 'completed' || rca.status === 'waived') && <button className="btn-ghost text-xs" onClick={() => run('reopen')} disabled={busy}>Reopen</button>}
            </div>
        </div>
    )
}

function RcaDetail({ rca, onChanged, canManage }) {
    return (
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-700">
            <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{rca.rca_number}</span>
                <StatusPill status={rca.status} />
                {rca.due_at && <span className="text-xs text-slate-400">due {new Date(rca.due_at).toLocaleDateString()}</span>}
            </div>
            <LifecycleActions rca={rca} canManage={canManage} onChanged={onChanged} />
            <NarrativeEditor rca={rca} onSaved={onChanged} canEdit={rca.status !== 'completed' && rca.status !== 'waived'} />
            <AiDraftSection rcaId={rca.id} onAccepted={onChanged} />
            <EvidenceChecklist rcaId={rca.id} canManage={canManage} />
            <ActionItems rcaId={rca.id} canManage={canManage} />
        </div>
    )
}

export default function RcaPanel({ incidentId, incidentTitle }) {
    const { get, post } = useItsmApi()
    const { isManager } = useItsmPermissions()
    const { data, loading, error, reload } = useItsmResource(
        () => get('/rca', { incident_id: incidentId }), [get, incidentId]
    )
    const rca = (data?.items || [])[0]
    const [creating, setCreating] = useState(false)

    const createRca = async () => {
        setCreating(true)
        try { await post('/rca', { title: `RCA for ${incidentTitle}`, incident_id: incidentId }); reload() }
        catch { /* ignore */ } finally { setCreating(false) }
    }

    if (loading) return <LoadingSpinner />
    return (
        <div className="space-y-2">
            {error && <ErrorBanner message={error.message} />}
            {!rca && (
                <button className="btn-ghost text-xs" onClick={createRca} disabled={creating}>
                    {creating ? 'Creating…' : '+ Create RCA'}
                </button>
            )}
            {rca && <RcaDetail rca={rca} onChanged={reload} canManage={isManager} />}
        </div>
    )
}
