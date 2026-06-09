import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../shared/itsm/primitives'
import AccessLevelField, { ACCESS_LEVELS } from '../../shared/itsm/AccessLevelField'

const VISIBILITIES = ['internal', 'public', 'agents_only']

export default function NewArticleModal({ open, onClose, onCreated }) {
    const { get, post } = useItsmApi()
    const [spaceId, setSpaceId] = useState('')
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [excerpt, setExcerpt] = useState('')
    const [visibility, setVisibility] = useState('internal')
    const [accessLevel, setAccessLevel] = useState('tenant')
    const [productId, setProductId] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const { data: spaces } = useItsmResource(() => (open ? get('/kb/spaces') : Promise.resolve(null)), [get, open])
    const spaceList = spaces || []

    const needsProduct = !!ACCESS_LEVELS.find(l => l.value === accessLevel)?.needsProduct

    const reset = () => {
        setSpaceId(''); setTitle(''); setBody(''); setExcerpt(''); setVisibility('internal')
        setAccessLevel('tenant'); setProductId(''); setError(null)
    }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const article = await post('/kb/articles', {
                space_id: spaceId,
                title,
                body,
                excerpt: excerpt || null,
                visibility,
                access_level: accessLevel,
                product_id: needsProduct ? (productId || null) : null,
            })
            reset()
            onCreated(article)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New article" maxWidth="max-w-2xl">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Space">
                    <select className="select" required value={spaceId} onChange={e => setSpaceId(e.target.value)}>
                        <option value="">Select a space…</option>
                        {spaceList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </FormField>
                <FormField label="Title">
                    <input className="input" required minLength={3} maxLength={500} value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" />
                </FormField>
                <FormField label="Excerpt (optional)">
                    <input className="input" value={excerpt} onChange={e => setExcerpt(e.target.value)} placeholder="Short summary shown in lists" />
                </FormField>
                <FormField label="Body">
                    <textarea className="input min-h-[180px] text-sm font-mono" required minLength={10} value={body} onChange={e => setBody(e.target.value)} placeholder="Article content (Markdown supported)…" />
                </FormField>
                <FormField label="Visibility">
                    <select className="select" value={visibility} onChange={e => setVisibility(e.target.value)}>
                        {VISIBILITIES.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                    </select>
                </FormField>
                <FormField label="Access level">
                    <AccessLevelField
                        value={accessLevel}
                        onChange={setAccessLevel}
                        productId={productId}
                        onProductChange={setProductId}
                    />
                </FormField>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !spaceId || !title.trim() || body.trim().length < 10 || (needsProduct && !productId)}>
                        {submitting ? 'Creating…' : 'Create draft'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
