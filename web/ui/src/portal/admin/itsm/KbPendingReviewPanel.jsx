import { useState, useEffect, useRef, useCallback } from 'react'
import {
    useItsmApi, useItsmResource,
    loadKbSpaces, loadKbCategories, loadPendingKbDrafts,
    triggerKbCuration, approveKbDraft, rejectKbDraft,
} from '../../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../../shared/itsm/useItsmPermissions'
import { useConfirm } from '../../../shared/itsm/ui'
import { LoadingSpinner, ErrorBanner, EmptyState, Modal, FormField } from '../../../shared/itsm/primitives'
import Pagination from '../../../shared/itsm/Pagination'

// How long (ms) to keep auto-polling GET /kb/curation/pending after a draft
// enters a "something's happening in the background" state (new run, or an
// approve/reject that fired an async Celery task) — the DB row only changes
// once that task finishes, so there's nothing to await synchronously here.
const WATCH_WINDOW_MS = 32000
const POLL_INTERVAL_MS = 15000
const PENDING_PAGE_SIZE = 10

const TRIGGER_LABEL = {
    manual: 'Manual',
    ticket_resolved: 'Ticket resolved',
    gap_feedback: 'Gap feedback',
}

const STATE_META = {
    running:            { label: 'Curating…', cls: 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400' },
    ready_for_review:   { label: 'Ready for review', cls: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    failed:             { label: 'Failed', cls: 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400' },
}

function stateMeta(state) {
    return STATE_META[state] || { label: state || 'Unknown', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' }
}

function formatRelativeTime(iso) {
    if (!iso) return '—'
    const diffMs = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins} min ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
    const days = Math.floor(hours / 24)
    return `${days} day${days > 1 ? 's' : ''} ago`
}

function NewDraftModal({ open, onClose, onCreated }) {
    const { get, post } = useItsmApi()
    const [spaces, setSpaces] = useState([])
    const [categories, setCategories] = useState([])
    const [spaceId, setSpaceId] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [title, setTitle] = useState('')
    const [sourceText, setSourceText] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!open) return
        setSpaceId(''); setCategoryId(''); setTitle(''); setSourceText(''); setError(null)
        loadKbSpaces(get).then(setSpaces).catch(err => setError(err))
    }, [open, get])

    useEffect(() => {
        if (!spaceId) { setCategories([]); setCategoryId(''); return }
        loadKbCategories(get, spaceId).then(setCategories).catch(() => setCategories([]))
    }, [spaceId, get])

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const draft = await triggerKbCuration(post, {
                space_id: spaceId,
                title: title.trim(),
                source_text: sourceText.trim(),
                ...(categoryId ? { category_id: categoryId } : {}),
            })
            onCreated(draft)
            onClose()
        } catch (err) {
            setError(err)
        } finally {
            setSubmitting(false)
        }
    }

    const valid = spaceId && title.trim().length >= 3 && sourceText.trim().length >= 10

    return (
        <Modal open={open} onClose={onClose} title="Start a new KB curation draft" maxWidth="max-w-xl">
            <form onSubmit={submit} className="space-y-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    Paste raw notes or a source document — an AI pipeline drafts a full article from it,
                    then pauses for your review before anything publishes.
                </p>
                {error && <ErrorBanner message={error.message} />}

                <FormField label="Space">
                    <select className="input text-sm" value={spaceId} onChange={e => setSpaceId(e.target.value)} required>
                        <option value="">Select a space…</option>
                        {spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </FormField>

                <FormField label="Category (optional)">
                    <select className="input text-sm" value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={!spaceId}>
                        <option value="">No category</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </FormField>

                <FormField label="Title">
                    <input
                        type="text" className="input text-sm" value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="How refunds are processed" minLength={3} required
                    />
                </FormField>

                <FormField label="Source text">
                    <textarea
                        className="input text-sm" rows={8} value={sourceText}
                        onChange={e => setSourceText(e.target.value)}
                        placeholder="Paste the raw notes / doc content to curate into an article…"
                        minLength={10} required
                    />
                </FormField>

                <div className="flex justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancel</button>
                    <button type="submit" disabled={!valid || submitting} className="btn-primary text-sm">
                        {submitting ? 'Starting…' : 'Start curation'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

function RejectForm({ onCancel, onSubmit, busy }) {
    const [notes, setNotes] = useState('')
    const [resynthesize, setResynthesize] = useState(false)
    return (
        <div className="mt-3 space-y-2 border-t border-slate-200 dark:border-slate-700 pt-3">
            <textarea
                className="input text-sm w-full" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Why is this being rejected? (required)"
            />
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <input type="checkbox" checked={resynthesize} onChange={e => setResynthesize(e.target.checked)} />
                Ask AI to regenerate with this feedback instead of archiving
            </label>
            <div className="flex justify-end gap-2">
                <button onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
                <button
                    onClick={() => onSubmit({ reviewer_notes: notes.trim(), resynthesize })}
                    disabled={busy || notes.trim().length === 0}
                    className="btn-ghost text-xs text-red-600 dark:text-red-400"
                >
                    {busy ? 'Working…' : resynthesize ? 'Regenerate' : 'Reject & archive'}
                </button>
            </div>
        </div>
    )
}

function DraftCard({ draft, canReview, busy, onApprove, onReject, onDismiss }) {
    const [expanded, setExpanded] = useState(false)
    const [rejecting, setRejecting] = useState(false)
    const source = draft.curation_source || {}
    const meta = stateMeta(source.state)
    const isBusy = busy === draft.id

    return (
        <div className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {TRIGGER_LABEL[source.trigger] || source.trigger || 'unknown'}
                        </span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                            {source.state === 'running' && (
                                <span className="w-2.5 h-2.5 mr-1 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            )}
                            {meta.label}
                        </span>
                    </div>
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{draft.title}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{formatRelativeTime(draft.created_at)}</p>
                </div>
            </div>

            {source.state === 'failed' && source.error && (
                <p className="text-sm text-red-600 dark:text-red-400">Error: {source.error}</p>
            )}

            {source.state === 'ready_for_review' && (
                <>
                    <button onClick={() => setExpanded(e => !e)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        {expanded ? 'Hide draft' : 'Read draft'}
                    </button>
                    {expanded && (
                        <div className="space-y-2 bg-slate-50 dark:bg-slate-800/50 rounded p-3">
                            <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{draft.body || '(empty)'}</p>
                            {!!(source.lint_findings || []).length && (
                                <div>
                                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">Lint findings</p>
                                    <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400">
                                        {source.lint_findings.map((f, i) => <li key={i}>{f}</li>)}
                                    </ul>
                                </div>
                            )}
                            {!!(source.citations || []).length && (
                                <div>
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Citations</p>
                                    <ul className="list-disc list-inside text-xs text-slate-500 dark:text-slate-400">
                                        {source.citations.map((c, i) => <li key={i}>{c}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {canReview && source.state === 'ready_for_review' && !rejecting && (
                <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => onApprove(draft)} disabled={isBusy} className="btn-ghost text-xs text-green-700 dark:text-emerald-400">
                        {isBusy ? 'Working…' : 'Approve'}
                    </button>
                    <button onClick={() => setRejecting(true)} disabled={isBusy} className="btn-ghost text-xs text-red-600 dark:text-red-400">
                        Reject
                    </button>
                </div>
            )}
            {canReview && source.state === 'ready_for_review' && rejecting && (
                <RejectForm
                    busy={isBusy}
                    onCancel={() => setRejecting(false)}
                    onSubmit={(body) => onReject(draft, body)}
                />
            )}

            {canReview && source.state === 'failed' && (
                <div className="pt-1">
                    <button onClick={() => onDismiss(draft)} disabled={isBusy} className="btn-ghost text-xs">
                        {isBusy ? 'Working…' : 'Dismiss'}
                    </button>
                </div>
            )}
        </div>
    )
}

export default function KbPendingReviewPanel() {
    const { get, post } = useItsmApi()
    const { isAgent, isTeamLead } = useItsmPermissions()
    const confirm = useConfirm()
    const [modalOpen, setModalOpen] = useState(false)
    const [busyId, setBusyId] = useState(null)
    const [actionError, setActionError] = useState(null)

    const { data, loading, error, reload } = useItsmResource(() => loadPendingKbDrafts(get), [get])
    const drafts = data || []

    // Keep polling while anything looks like it's still cooking in the
    // background (new run, or an approve/reject whose Celery task hasn't
    // landed yet) — see the module doc comment above.
    const watchUntilRef = useRef(0)
    const watch = useCallback(() => { watchUntilRef.current = Date.now() + WATCH_WINDOW_MS }, [])
    useEffect(() => {
        if (drafts.some(d => d.curation_source?.state === 'running')) watch()
    }, [drafts, watch])
    useEffect(() => {
        const id = setInterval(() => { if (Date.now() < watchUntilRef.current) reload() }, POLL_INTERVAL_MS)
        return () => clearInterval(id)
    }, [reload])

    const runMutation = async (draft, fn) => {
        setBusyId(draft.id); setActionError(null)
        try {
            await fn()
            watch()
            reload()
        } catch (err) {
            setActionError(err)
        } finally {
            setBusyId(null)
        }
    }

    const handleApprove = (draft) => runMutation(draft, () => approveKbDraft(post, draft.id))
    const handleReject = (draft, body) => runMutation(draft, () => rejectKbDraft(post, draft.id, body))
    const handleDismiss = async (draft) => {
        if (!(await confirm({
            title: 'Dismiss failed draft?',
            message: `Archive the failed draft "${draft.title}"? This cannot be undone.`,
            danger: true, confirmLabel: 'Dismiss',
        }))) return
        runMutation(draft, () => rejectKbDraft(post, draft.id, { reviewer_notes: 'Dismissed after synthesis failure.' }))
    }
    const handleCreated = () => { watch(); reload() }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    AI-curated drafts awaiting review before they publish to the knowledge base.
                </p>
                <div className="flex items-center gap-2">
                    {isAgent && (
                        <button onClick={() => setModalOpen(true)} className="btn-primary text-xs">+ New Draft</button>
                    )}
                    <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
                </div>
            </div>

            {actionError && <ErrorBanner message={actionError.message} />}
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                drafts.length === 0
                    ? <EmptyState>No drafts pending review.</EmptyState>
                    : (
                        <div className="space-y-2.5">
                            {drafts.map(d => (
                                <DraftCard
                                    key={d.id}
                                    draft={d}
                                    canReview={isTeamLead}
                                    busy={busyId}
                                    onApprove={handleApprove}
                                    onReject={handleReject}
                                    onDismiss={handleDismiss}
                                />
                            ))}
                        </div>
                    )
            )}

            <NewDraftModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
        </div>
    )
}
