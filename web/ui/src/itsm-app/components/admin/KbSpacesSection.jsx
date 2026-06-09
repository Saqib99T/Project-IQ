import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

function NewSpaceModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [slug, setSlug] = useState('')
    const [description, setDescription] = useState('')
    const [isPublic, setIsPublic] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => { setName(''); setSlug(''); setDescription(''); setIsPublic(false); setError(null) }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const space = await post('/kb/spaces', { name, slug, description: description || null, is_public: isPublic })
            reset()
            onCreated(space)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New KB space">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required minLength={1} maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IT Support" />
                </FormField>
                <FormField label="Slug">
                    <input className="input font-mono" required pattern="^[a-z0-9-]+$" maxLength={100} value={slug} onChange={e => setSlug(e.target.value)} placeholder="it-support" />
                </FormField>
                <FormField label="Description (optional)">
                    <textarea className="input min-h-[70px] text-sm" value={description} onChange={e => setDescription(e.target.value)} />
                </FormField>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
                    Public (visible without authentication)
                </label>
                {error && <ErrorBanner message={error.message} />}
                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim() || !slug.trim()}>
                        {submitting ? 'Creating…' : 'Create space'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}

function SpaceRow({ space, onUpdated }) {
    const { patch } = useItsmApi()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const toggle = async (field) => {
        setBusy(true); setError(null)
        try { onUpdated(await patch(`/kb/spaces/${space.slug}`, { [field]: !space[field] })) }
        catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <li className="py-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-slate-800 dark:text-slate-200 truncate">{space.name}</p>
                    <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{space.slug} · {space.scope.replace(/_/g, ' ')}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => toggle('is_public')} disabled={busy} className={`px-2 py-1 rounded-full text-xs font-medium ${space.is_public ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        {space.is_public ? 'Public' : 'Private'}
                    </button>
                    <button onClick={() => toggle('is_active')} disabled={busy} className={`px-2 py-1 rounded-full text-xs font-medium ${space.is_active ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        {space.is_active ? 'Active' : 'Inactive'}
                    </button>
                </div>
            </div>
            {error && <ErrorBanner message={error.message} />}
        </li>
    )
}

export default function KbSpacesSection() {
    const { get } = useItsmApi()
    const [showNew, setShowNew] = useState(false)
    const { data: spaces, loading, error, reload } = useItsmResource(() => get('/kb/spaces'), [get])
    const spaceList = spaces || []

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Knowledge base spaces</h3>
                <button onClick={() => setShowNew(true)} className="btn-primary text-xs">+ New space</button>
            </div>

            <NewSpaceModal open={showNew} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); reload() }} />

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && spaceList.length === 0 && <EmptyState>No KB spaces yet.</EmptyState>}
            {spaceList.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {spaceList.map(s => <SpaceRow key={s.id} space={s} onUpdated={reload} />)}
                </ul>
            )}
        </div>
    )
}
