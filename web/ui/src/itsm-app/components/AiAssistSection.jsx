import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { ErrorBanner } from '../../shared/itsm/primitives'

const CLASSIFICATION_FIELDS = [
    { key: 'category',  label: 'Category',  value: c => c.suggested_category_id },
    { key: 'priority',  label: 'Priority',  value: c => c.suggested_priority },
    { key: 'assignee',  label: 'Assignee',  value: c => c.suggested_assignee_id },
    { key: 'team',      label: 'Team',      value: c => c.suggested_team_id },
]

function ClassificationCard({ ticketId, get, post }) {
    const { data: classification, loading, error, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}/ai-classification`).catch(err => err.status === 404 ? null : Promise.reject(err)),
        [get, ticketId]
    )
    const [busy, setBusy] = useState(false)
    const [actionError, setActionError] = useState(null)

    if (loading) return null
    if (error) return null
    if (!classification) return (
        <p className="text-sm text-slate-400 dark:text-slate-500">No AI classification suggested for this ticket.</p>
    )

    const fields = CLASSIFICATION_FIELDS.filter(f => f.value(classification))
    const decided = classification.accepted !== null && classification.accepted !== undefined

    const accept = async () => {
        setBusy(true); setActionError(null)
        try { await post(`/tickets/${ticketId}/ai-classification/accept`, { fields: fields.map(f => f.key) }); reload() }
        catch (err) { setActionError(err) } finally { setBusy(false) }
    }
    const reject = async () => {
        setBusy(true); setActionError(null)
        try { await post(`/tickets/${ticketId}/ai-classification/reject`, {}); reload() }
        catch (err) { setActionError(err) } finally { setBusy(false) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Suggested classification</p>
                <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    {Math.round(classification.confidence * 100)}% confidence
                </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {CLASSIFICATION_FIELDS.map(f => (
                    <div key={f.key}>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{f.label}</p>
                        <p className="text-slate-800 dark:text-slate-200 font-mono text-xs truncate">{f.value(classification) || '—'}</p>
                    </div>
                ))}
            </div>
            {actionError && <ErrorBanner message={actionError.message} />}
            {decided ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                    {classification.accepted ? '✓ Accepted' : '✕ Rejected'}
                    {classification.accepted_fields?.length ? ` — fields: ${classification.accepted_fields.join(', ')}` : ''}
                </p>
            ) : (
                <div className="flex items-center gap-2">
                    <button onClick={accept} disabled={busy || fields.length === 0} className="btn-primary text-xs py-1.5">Accept suggestion</button>
                    <button onClick={reject} disabled={busy} className="btn-ghost text-xs py-1.5">Reject</button>
                </div>
            )}
        </div>
    )
}

function DuplicatesCard({ ticketId, get, post, onNavigate }) {
    const { data, loading, error, reload } = useItsmResource(() => get(`/tickets/${ticketId}/ai-duplicates`), [get, ticketId])
    const [busyId, setBusyId] = useState(null)
    const [actionError, setActionError] = useState(null)
    const candidates = (data?.items || data || []).filter(c => !c.dismissed)

    if (loading) return null
    if (error) return null
    if (candidates.length === 0) return (
        <p className="text-sm text-slate-400 dark:text-slate-500">No potential duplicate tickets detected.</p>
    )

    const dismiss = async (candidateId) => {
        setBusyId(candidateId); setActionError(null)
        try { await post(`/tickets/${ticketId}/ai-duplicates/${candidateId}/dismiss`, {}); reload() }
        catch (err) { setActionError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Possible duplicates</p>
            {actionError && <ErrorBanner message={actionError.message} />}
            <div className="space-y-1.5">
                {candidates.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2">
                        <button onClick={() => onNavigate(c.candidate_id)} className="text-xs font-mono text-blue-600 dark:text-blue-400 hover:underline truncate">
                            {c.candidate_id}
                        </button>
                        <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0">{Math.round(c.similarity_score * 100)}% match</span>
                        <button onClick={() => dismiss(c.id)} disabled={busyId === c.id} className="btn-ghost text-xs py-1 shrink-0">Dismiss</button>
                    </div>
                ))}
            </div>
        </div>
    )
}

function ReplySuggestionCard({ ticketId, get, post }) {
    const { data: latest, loading, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}/ai-suggest-reply/latest`).catch(err => err.status === 404 ? null : Promise.reject(err)),
        [get, ticketId]
    )
    const [generating, setGenerating] = useState(false)
    const [error, setError] = useState(null)

    const generate = async () => {
        setGenerating(true); setError(null)
        try { await post(`/tickets/${ticketId}/ai-suggest-reply`, {}); reload() }
        catch (err) { setError(err) } finally { setGenerating(false) }
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Draft reply</p>
                <button onClick={generate} disabled={generating} className="btn-ghost text-xs py-1.5">
                    {generating ? 'Generating…' : '✨ Generate draft'}
                </button>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {!loading && !latest && !generating && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No AI draft reply yet — generate one from the ticket's recent comments and linked KB articles.</p>
            )}
            {latest && (
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2.5 space-y-1">
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{latest.body}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{latest.used ? '✓ Used in a reply' : 'Not yet used'} · {latest.model_version}</p>
                </div>
            )}
        </div>
    )
}

/**
 * Surfaces the AI ticket-assist features (classification suggestions, duplicate
 * detection, draft replies) — agent+ only, mirrors app/api/v1/ai_tickets.py.
 */
export default function AiAssistSection({ ticketId }) {
    const { get, post } = useItsmApi()
    const { isAgent } = useItsmPermissions()
    const goToNavigate = useNavigate()
    const navigate = (id) => goToNavigate(`/tickets/${id}`)

    if (!isAgent) return null

    return (
        <div className="card p-6 space-y-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">✨ AI assist</h3>
            <ClassificationCard ticketId={ticketId} get={get} post={post} />
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                <DuplicatesCard ticketId={ticketId} get={get} post={post} onNavigate={navigate} />
            </div>
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                <ReplySuggestionCard ticketId={ticketId} get={get} post={post} />
            </div>
        </div>
    )
}
