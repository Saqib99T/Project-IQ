import { useMemo, useState } from 'react'
import { Hash, Plus, X } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { ErrorBanner } from '../../shared/itsm/primitives'
import { Badge, Button } from '../../shared/itsm/ui'

/**
 * Manages tags on a KB article. Unlike ticket tags, the KB API exposes the
 * article's *assigned* tags, so this shows current tags with remove chips plus
 * an "add" picker drawn from the tenant tag palette.
 */
export default function KbArticleTagsSection({ articleId }) {
    const { isAgent } = useItsmPermissions()
    const { get, post, remove } = useItsmApi()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [adding, setAdding] = useState(false)

    const canEdit = isAgent

    const { data: assigned, reload } = useItsmResource(() => get(`/kb/articles/${articleId}/tags`), [get, articleId])
    const { data: allTags } = useItsmResource(() => get('/kb/tags').catch(() => []), [get])

    const assignedTags = useMemo(() => assigned || [], [assigned])
    const assignedIds = useMemo(() => new Set(assignedTags.map(t => t.id)), [assignedTags])
    const available = useMemo(() => (allTags || []).filter(t => !assignedIds.has(t.id)), [allTags, assignedIds])

    const assign = async (tagId) => {
        setBusy(true); setError(null)
        try { await post(`/kb/articles/${articleId}/tags`, { tag_id: tagId }); setAdding(false); reload() }
        catch (err) { setError(err) } finally { setBusy(false) }
    }
    const unassign = async (tagId) => {
        setBusy(true); setError(null)
        try { await remove(`/kb/articles/${articleId}/tags/${tagId}`); reload() }
        catch (err) { setError(err) } finally { setBusy(false) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Hash className="w-4 h-4 text-slate-400" /> Tags
                </h3>
                {canEdit && available.length > 0 && (
                    <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAdding(a => !a)}>Add tag</Button>
                )}
            </div>

            {error && <ErrorBanner message={error.message} />}

            {adding && (
                <div className="flex flex-wrap gap-1.5 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                    {available.map(t => (
                        <button key={t.id} disabled={busy} onClick={() => assign(t.id)}
                            className="px-2 py-0.5 rounded-md text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-slate-600 dark:text-slate-300">
                            + {t.name}
                        </button>
                    ))}
                </div>
            )}

            {assignedTags.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">No tags on this article.</p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {assignedTags.map(t => (
                        <span key={t.id} className="inline-flex items-center gap-1">
                            <Badge tone="indigo">{t.name}{canEdit && (
                                <button onClick={() => unassign(t.id)} disabled={busy} className="ml-0.5 hover:text-red-500" title="Remove tag">
                                    <X className="w-3 h-3" />
                                </button>
                            )}</Badge>
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}
