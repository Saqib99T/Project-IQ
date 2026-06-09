import { useNavigate, useParams } from 'react-router-dom'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { TenantBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import ArticleEditPanel from '../components/ArticleEditPanel'
import ArticleWorkflowControls from '../components/ArticleWorkflowControls'
import KbArticleVersionsSection from '../components/KbArticleVersionsSection'
import KbLinkedTicketsSection from '../components/KbLinkedTicketsSection'
import KbArticleTagsSection from '../components/KbArticleTagsSection'
import KbArticleAttachmentsSection from '../components/KbArticleAttachmentsSection'
import KbArticleFeedbackSection from '../components/KbArticleFeedbackSection'

const STATUS_STYLE = {
    draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    under_review: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    published: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300',
    archived: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

export default function KbArticleDetailPage() {
    const { articleId } = useParams()
    const navigate = useNavigate()
    const { get } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const tenantNames = useTenantDirectory(tenantId === null)

    const { data: article, loading, error, reload } = useItsmResource(
        () => get(`/kb/articles/${articleId}`),
        [get, articleId]
    )

    return (
        <div className="max-w-3xl space-y-4">
            <button onClick={() => navigate('/kb')} className="btn-ghost text-xs">← Back to knowledge base</button>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && article && (
                <div className="card p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{article.slug}</p>
                                {tenantId === null && <TenantBadge tenantId={article.tenant_id} tenantNames={tenantNames} />}
                            </div>
                            <ArticleEditPanel article={article} onUpdated={reload} />
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize shrink-0 ${STATUS_STYLE[article.status] || STATUS_STYLE.draft}`}>
                            {(article.status || 'draft').replace(/_/g, ' ')}
                        </span>
                    </div>

                    <ArticleWorkflowControls
                        article={article}
                        onUpdated={reload}
                        onDeleted={() => navigate('/kb')}
                    />

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800 text-sm">
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Visibility</p>
                            <p className="text-slate-800 dark:text-slate-200 capitalize">{(article.visibility || '—').replace(/_/g, ' ')}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Version</p>
                            <p className="text-slate-800 dark:text-slate-200">{article.version}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Helpful / not</p>
                            <p className="text-slate-800 dark:text-slate-200">{article.helpful_count} / {article.not_helpful_count}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Views</p>
                            <p className="text-slate-800 dark:text-slate-200">{article.view_count}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Published</p>
                            <p className="text-slate-800 dark:text-slate-200">{formatDate(article.published_at)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Created</p>
                            <p className="text-slate-800 dark:text-slate-200">{formatDate(article.created_at)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Updated</p>
                            <p className="text-slate-800 dark:text-slate-200">{formatDate(article.updated_at)}</p>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
                    </div>
                </div>
            )}

            {!loading && !error && article && (
                <>
                    <div className="card p-6">
                        <KbArticleTagsSection articleId={article.id} />
                    </div>
                    <div className="card p-6">
                        <KbArticleAttachmentsSection articleId={article.id} />
                    </div>
                    <div className="card p-6">
                        <KbArticleFeedbackSection articleId={article.id} />
                    </div>
                    <div className="card p-6">
                        <KbArticleVersionsSection articleId={article.id} onRestored={reload} />
                    </div>
                    <div className="card p-6">
                        <KbLinkedTicketsSection articleId={article.id} />
                    </div>
                </>
            )}
        </div>
    )
}
