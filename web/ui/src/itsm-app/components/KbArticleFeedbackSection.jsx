import { useMemo, useState } from 'react'
import { ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'

function fmt(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString()
}

/**
 * Read view of reader feedback on an article (agent+). Surfaces the
 * kb_article_feedback rows that previously had no UI — helpful/not-helpful
 * counts plus individual comments, with a filter.
 */
export default function KbArticleFeedbackSection({ articleId }) {
    const { get } = useItsmApi()
    const { isAgent } = useItsmPermissions()
    const [filter, setFilter] = useState('all') // all | helpful | not

    const { data, loading, error } = useItsmResource(
        () => isAgent ? get(`/kb/articles/${articleId}/feedback`) : Promise.resolve([]),
        [get, articleId, isAgent]
    )
    const all = useMemo(() => data || [], [data])
    const helpful = all.filter(f => f.is_helpful).length
    const notHelpful = all.length - helpful
    const shown = all.filter(f => filter === 'all' ? true : filter === 'helpful' ? f.is_helpful : !f.is_helpful)

    if (!isAgent) return null

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <MessageSquare className="w-4 h-4 text-slate-400" /> Reader feedback
                </h3>
                <div className="flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-emerald-400"><ThumbsUp className="w-3.5 h-3.5" /> {helpful}</span>
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400"><ThumbsDown className="w-3.5 h-3.5" /> {notHelpful}</span>
                </div>
            </div>

            <div className="flex items-center gap-1.5">
                {['all', 'helpful', 'not'].map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                            filter === f ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}`}>
                        {f === 'not' ? 'Not helpful' : f}
                    </button>
                ))}
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                shown.length === 0
                    ? <EmptyState>No feedback{filter !== 'all' ? ' in this category' : ''} yet.</EmptyState>
                    : (
                        <ul className="space-y-1.5">
                            {shown.map(f => (
                                <li key={f.id} className="flex items-start gap-2 text-sm p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                                    {f.is_helpful
                                        ? <ThumbsUp className="w-4 h-4 mt-0.5 text-green-600 dark:text-emerald-400 shrink-0" />
                                        : <ThumbsDown className="w-4 h-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />}
                                    <div className="min-w-0">
                                        <p className="text-slate-700 dark:text-slate-300">{f.comment || <span className="text-slate-400 italic">No comment</span>}</p>
                                        <p className="text-xs text-slate-400 dark:text-slate-500">{fmt(f.created_at)}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )
            )}
        </div>
    )
}
