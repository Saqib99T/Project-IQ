import { useState } from 'react'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { ErrorBanner } from '../../shared/itsm/primitives'
import { useConfirm } from '../../shared/itsm/ui'

/**
 * Workflow transitions mirror itsm-service's role gates: submit (author or
 * agent+), publish/archive (team_lead+), delete/archive (manager+). The
 * backend enforces these server-side — this only hides actions the caller
 * can't take, to avoid confusing 403s.
 */
export default function ArticleWorkflowControls({ article, onUpdated, onDeleted }) {
    const { post, remove } = useItsmApi()
    const { isAgent, isTeamLead, isManager } = useItsmPermissions()
    const confirm = useConfirm()
    const [busy, setBusy] = useState(null)
    const [error, setError] = useState(null)

    const canSubmit = isAgent
    const canPublishOrArchive = isTeamLead
    const canDelete = isManager

    const transition = async (action, fn) => {
        setBusy(action); setError(null)
        try {
            const updated = await fn()
            onUpdated(updated)
        } catch (err) { setError(err) } finally { setBusy(null) }
    }

    const submit = () => transition('submit', () => post(`/kb/articles/${article.id}/submit`, {}))
    const publish = () => transition('publish', () => post(`/kb/articles/${article.id}/publish`, {}))
    const archive = () => transition('archive', () => post(`/kb/articles/${article.id}/archive`, {}))

    const del = async () => {
        if (!(await confirm({ title: 'Archive article?', message: `Archive (delete) article "${article.title}"? This cannot be undone.`, danger: true, confirmLabel: 'Archive' }))) return
        setBusy('delete'); setError(null)
        try {
            await remove(`/kb/articles/${article.id}`)
            onDeleted()
        } catch (err) { setError(err); setBusy(null) }
    }

    const actions = []
    if (article.status === 'draft' && canSubmit) actions.push(['submit', 'Submit for review', submit])
    if ((article.status === 'draft' || article.status === 'under_review') && canPublishOrArchive) actions.push(['publish', 'Publish', publish])
    if (article.status !== 'archived' && canPublishOrArchive) actions.push(['archive', 'Archive', archive])
    if (canDelete) actions.push(['delete', 'Delete', del])

    if (actions.length === 0) return null

    return (
        <div className="space-y-2">
            {error && <ErrorBanner message={error.message} />}
            <div className="flex items-center gap-2 flex-wrap">
                {actions.map(([key, label, fn]) => (
                    <button
                        key={key}
                        onClick={fn}
                        disabled={busy !== null}
                        className={`text-xs py-1.5 ${key === 'delete' ? 'btn-ghost text-red-600 dark:text-red-400' : 'btn-ghost'}`}
                    >
                        {busy === key ? 'Working…' : label}
                    </button>
                ))}
            </div>
        </div>
    )
}
