import { useState, type FormEvent } from 'react'
import { useIam } from '../../widget/hooks/useIam'
import { useItsmApi, useItsmResource } from './useItsmApi'
import { useItsmPermissions } from './useItsmPermissions'
import { LoadingSpinner, ErrorBanner, EmptyState } from './primitives'
import { useConfirm } from './ui'

export interface Comment {
    id: string
    ticket_id: string
    author_id: string
    author_name?: string
    body: string
    is_internal?: boolean
    created_at?: string
}

function formatDate(iso?: string): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

function CommentItem({ comment, canEdit, onSaved, onDeleted }: {
    comment: Comment
    canEdit: (c: Comment) => boolean
    onSaved: (updated: Comment) => void
    onDeleted: (id: string) => void
}) {
    const { patch, remove } = useItsmApi()
    const confirm = useConfirm()
    const [editing, setEditing] = useState(false)
    const [body, setBody] = useState(comment.body)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const save = async () => {
        setBusy(true); setError(null)
        try {
            const updated = await patch<Comment>(`/tickets/${comment.ticket_id}/comments/${comment.id}`, { body })
            onSaved(updated)
            setEditing(false)
        } catch (err) { setError(err as Error) } finally { setBusy(false) }
    }

    const del = async () => {
        if (!(await confirm({ title: 'Delete comment?', message: 'This comment will be deleted.', danger: true, confirmLabel: 'Delete' }))) return
        setBusy(true); setError(null)
        try {
            await remove(`/tickets/${comment.ticket_id}/comments/${comment.id}`)
            onDeleted(comment.id)
        } catch (err) { setError(err as Error); setBusy(false) }
    }

    return (
        <div className={`p-3 rounded-xl border text-sm ${
            comment.is_internal
                ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20'
                : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
        }`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                    {/* Prefer the resolved name from itsm-service; fall back to the id */}
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{comment.author_name || comment.author_id}</span>
                    {comment.is_internal && <span className="badge bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">Internal note</span>}
                </div>
                <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(comment.created_at)}</span>
            </div>

            {editing ? (
                <div className="space-y-2">
                    <textarea className="input min-h-[80px] text-sm" value={body} onChange={e => setBody(e.target.value)} />
                    {error && <ErrorBanner message={error.message} />}
                    <div className="flex items-center gap-2">
                        <button onClick={save} disabled={busy} className="btn-primary text-xs py-1.5">Save</button>
                        <button onClick={() => { setEditing(false); setBody(comment.body) }} disabled={busy} className="btn-ghost text-xs py-1.5">Cancel</button>
                    </div>
                </div>
            ) : (
                <>
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{comment.body}</p>
                    {canEdit(comment) && (
                        <div className="flex items-center gap-3 mt-1.5">
                            <button onClick={() => setEditing(true)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Edit</button>
                            <button onClick={del} className="text-xs text-red-600 dark:text-red-400 hover:underline">Delete</button>
                        </div>
                    )}
                    {error && <ErrorBanner message={error.message} />}
                </>
            )}
        </div>
    )
}

/**
 * Ticket comments — lists comments and posts new ones. Agents (incl. operators)
 * may post internal notes; the backend enforces the real authorization and the
 * internal/public visibility filter. Shared by the portal and the itsm-app.
 */
export default function CommentsSection({ ticketId }: { ticketId: string }) {
    const { user }: { user?: { sub?: string; local_user_id?: string } } = useIam()
    const { isAgent } = useItsmPermissions()
    const { get, post } = useItsmApi()
    const [body, setBody] = useState('')
    const [isInternal, setIsInternal] = useState(false)
    const [posting, setPosting] = useState(false)
    const [postError, setPostError] = useState<Error | null>(null)

    const { data, loading, error, reload } = useItsmResource<Comment[]>(
        () => get(`/tickets/${ticketId}/comments`),
        [get, ticketId]
    )
    const comments = data || []

    // Server enforces author-only edits + 5-minute window; this just hides the
    // controls for comments that obviously aren't the current user's.
    const canEdit = (c: Comment) => c.author_id === user?.sub || c.author_id === user?.local_user_id

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!body.trim()) return
        setPosting(true); setPostError(null)
        try {
            await post(`/tickets/${ticketId}/comments`, { body, is_internal: isInternal })
            setBody(''); setIsInternal(false)
            reload()
        } catch (err) { setPostError(err as Error) } finally { setPosting(false) }
    }

    return (
        <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Comments</h3>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && !error && (
                comments.length === 0
                    ? <EmptyState>No comments yet.</EmptyState>
                    : (
                        <div className="space-y-2.5">
                            {comments.map(c => (
                                <CommentItem
                                    key={c.id}
                                    comment={c}
                                    canEdit={canEdit}
                                    onSaved={() => reload()}
                                    onDeleted={() => reload()}
                                />
                            ))}
                        </div>
                    )
            )}

            <form onSubmit={submit} className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <textarea
                    className="input min-h-[80px] text-sm"
                    placeholder="Write a comment…"
                    value={body}
                    onChange={e => setBody(e.target.value)}
                />
                <div className="flex items-center justify-between">
                    {isAgent ? (
                        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                            Internal note (not visible to requester)
                        </label>
                    ) : <span />}
                    <button type="submit" disabled={posting || !body.trim()} className="btn-primary text-xs py-1.5">
                        {posting ? 'Posting…' : 'Post comment'}
                    </button>
                </div>
                {postError && <ErrorBanner message={postError.message} />}
            </form>
        </div>
    )
}
