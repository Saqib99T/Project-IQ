import { useState } from 'react'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { ErrorBanner } from '../../shared/itsm/primitives'
import AccessLevelField, { ACCESS_LEVELS } from '../../shared/itsm/AccessLevelField'

const VISIBILITIES = ['internal', 'public', 'agents_only']

export default function ArticleEditPanel({ article, onUpdated }) {
    const { patch } = useItsmApi()
    const [editing, setEditing] = useState(false)
    const [title, setTitle] = useState(article.title)
    const [excerpt, setExcerpt] = useState(article.excerpt || '')
    const [body, setBody] = useState(article.body || '')
    const [visibility, setVisibility] = useState(article.visibility)
    const [accessLevel, setAccessLevel] = useState(article.access_level || 'tenant')
    const [productId, setProductId] = useState(article.product_id || '')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const needsProduct = !!ACCESS_LEVELS.find(l => l.value === accessLevel)?.needsProduct

    const startEdit = () => {
        setTitle(article.title); setExcerpt(article.excerpt || ''); setBody(article.body || '')
        setVisibility(article.visibility)
        setAccessLevel(article.access_level || 'tenant'); setProductId(article.product_id || '')
        setEditing(true)
    }

    const save = async () => {
        setSaving(true); setError(null)
        try {
            const updated = await patch(`/kb/articles/${article.id}`, {
                title, excerpt: excerpt || null, body, visibility,
                access_level: accessLevel,
                product_id: needsProduct ? (productId || null) : null,
            })
            onUpdated(updated)
            setEditing(false)
        } catch (err) { setError(err) } finally { setSaving(false) }
    }

    const currentLevelLabel = ACCESS_LEVELS.find(l => l.value === article.access_level)?.label

    if (!editing) {
        return (
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-fg">{article.title}</h2>
                    <button onClick={startEdit} className="text-xs text-primary hover:underline shrink-0">Edit</button>
                </div>
                {currentLevelLabel && (
                    <span className="badge bg-primary/10 text-primary">{currentLevelLabel}</span>
                )}
                {article.excerpt && <p className="text-sm text-fgmuted italic">{article.excerpt}</p>}
                <p className="text-sm text-fg/90 whitespace-pre-wrap">{article.body}</p>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <input className="input font-semibold" required minLength={3} maxLength={500} value={title} onChange={e => setTitle(e.target.value)} />
            <input className="input text-sm" value={excerpt} onChange={e => setExcerpt(e.target.value)} placeholder="Excerpt (optional)" />
            <textarea className="input min-h-[200px] text-sm font-mono" required minLength={10} value={body} onChange={e => setBody(e.target.value)} />
            <label className="block space-y-1 max-w-xs">
                <span className="text-xs font-medium text-fgmuted uppercase tracking-wide">Visibility</span>
                <select className="select text-sm" value={visibility} onChange={e => setVisibility(e.target.value)}>
                    {VISIBILITIES.map(v => <option key={v} value={v}>{v.replace(/_/g, ' ')}</option>)}
                </select>
            </label>
            <label className="block space-y-1 max-w-md">
                <span className="text-xs font-medium text-fgmuted uppercase tracking-wide">Access level</span>
                <AccessLevelField
                    value={accessLevel}
                    onChange={setAccessLevel}
                    productId={productId}
                    onProductChange={setProductId}
                />
            </label>
            {error && <ErrorBanner message={error.message} />}
            <div className="flex items-center gap-2">
                <button onClick={save} disabled={saving || (needsProduct && !productId)} className="btn-primary text-xs py-1.5">{saving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setEditing(false)} disabled={saving} className="btn-ghost text-xs py-1.5">Cancel</button>
            </div>
        </div>
    )
}
