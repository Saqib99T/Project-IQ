import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import { useConfirm } from '../../shared/itsm/ui'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function KbArticleVersionsSection({ articleId, onRestored }) {
    const { isAdmin } = useItsmPermissions()
    const confirm = useConfirm()
    const { get, post } = useItsmApi()
    const [busyVersion, setBusyVersion] = useState(null)
    const [error, setError] = useState(null)

    const { data: versions, loading, reload } = useItsmResource(() => get(`/kb/articles/${articleId}/versions`), [get, articleId])
    const versionList = versions || []
    const canRestore = isAdmin

    const restore = async (v) => {
        if (!(await confirm({ title: 'Restore version?', message: `Restore article to version ${v.version_number} ("${v.title}")? This will overwrite the current content.`, confirmLabel: 'Restore' }))) return
        setBusyVersion(v.version_number); setError(null)
        try {
            await post(`/kb/articles/${articleId}/versions/${v.version_number}/restore`, {})
            reload()
            onRestored?.()
        } catch (err) { setError(err) } finally { setBusyVersion(null) }
    }

    return (
        <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Version history</h3>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && versionList.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No prior versions recorded.</p>
            )}
            {versionList.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {versionList.map(v => (
                        <li key={v.id} className="flex items-center justify-between py-2 text-sm">
                            <div className="min-w-0">
                                <p className="text-slate-800 dark:text-slate-200 truncate">v{v.version_number} — {v.title}</p>
                                <p className="text-xs text-slate-400 dark:text-slate-500">
                                    {formatDate(v.created_at)}{v.change_summary ? ` · ${v.change_summary}` : ''}
                                </p>
                            </div>
                            {canRestore && (
                                <button onClick={() => restore(v)} disabled={busyVersion === v.version_number} className="btn-ghost text-xs py-1 shrink-0">
                                    {busyVersion === v.version_number ? 'Restoring…' : 'Restore'}
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
