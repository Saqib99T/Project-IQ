import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { Modal, FormField, ErrorBanner } from '../../shared/itsm/primitives'

function NewTagModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [color, setColor] = useState('#3b82f6')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => { setName(''); setColor('#3b82f6'); setError(null) }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const tag = await post('/tickets/tags', { name, color })
            reset()
            onCreated(tag)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New tag">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required minLength={1} maxLength={50} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. needs-follow-up" />
                </FormField>
                <FormField label="Color">
                    <input type="color" className="h-10 w-20 rounded border border-slate-200 dark:border-slate-700 bg-transparent" value={color} onChange={e => setColor(e.target.value)} />
                </FormField>
                {error && <ErrorBanner message={error.message} />}
                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim()}>
                        {submitting ? 'Creating…' : 'Create tag'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

/**
 * itsm-service has no endpoint to list a ticket's *currently assigned* tags
 * (only tenant-wide tag list + idempotent assign/remove-by-id), so this can't
 * show which tags are already on the ticket — it offers assign/remove actions
 * against the full tenant tag palette, both of which are safe to repeat.
 */
export default function TicketTagsSection({ ticketId }) {
    const { isManager } = useItsmPermissions()
    const { get, post, remove } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data: tags, loading, reload } = useItsmResource(() => get('/tickets/tags'), [get])
    const tagList = tags || []
    const canCreate = isManager

    const assign = async (tag) => {
        setBusyId(tag.id); setError(null)
        try { await post(`/tickets/${ticketId}/tags`, { tag_id: tag.id }) }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }
    const unassign = async (tag) => {
        setBusyId(tag.id); setError(null)
        try { await remove(`/tickets/${ticketId}/tags/${tag.id}`) }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Tags</h3>
                {canCreate && <button onClick={() => setShowNew(true)} className="btn-ghost text-xs py-1.5">+ New tag</button>}
            </div>

            <NewTagModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />

            {error && <ErrorBanner message={error.message} />}
            {!loading && tagList.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No tags exist for this tenant yet.</p>
            )}

            <div className="flex flex-wrap gap-1.5">
                {tagList.map(tag => (
                    <span key={tag.id} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 pl-2 pr-1 py-0.5 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                        <span className="text-slate-700 dark:text-slate-300">{tag.name}</span>
                        <button
                            onClick={() => assign(tag)} disabled={busyId === tag.id}
                            className="px-1 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-full" title="Add to ticket"
                        >+</button>
                        <button
                            onClick={() => unassign(tag)} disabled={busyId === tag.id}
                            className="px-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-full" title="Remove from ticket"
                        >−</button>
                    </span>
                ))}
            </div>
        </div>
    )
}
