import { useState, useEffect } from 'react'
import { useItsmApi, useItsmResource, useTenantDirectory, loadKbArticles } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { useItsmPermissions } from '../../../shared/itsm/useItsmPermissions'
import { KbArticleCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import Pagination from '../../../shared/itsm/Pagination'
import KbPendingReviewPanel from './KbPendingReviewPanel'

const ARTICLES_PAGE_SIZE = 20

function ArticlesTab() {
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const tenantNames = useTenantDirectory(tenantId === null)
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)

    const { data, loading, error, reload } = useItsmResource(
        () => loadKbArticles(get, search),
        [get, search]
    )
    const articles = data?.articles || []
    const pageCount = Math.max(1, Math.ceil(articles.length / ARTICLES_PAGE_SIZE))
    const pageArticles = articles.slice((page - 1) * ARTICLES_PAGE_SIZE, page * ARTICLES_PAGE_SIZE)

    // loadKbArticles already fetches the full matching set (no server-side
    // paging on /kb/search or the merged cross-space browse) — paginate
    // client-side over what's already in memory. Reset to page 1 whenever
    // the result set changes underneath it.
    useEffect(() => { setPage(1) }, [search, articles.length])

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search knowledge base…"
                    className="input text-sm py-1.5 max-w-xs"
                />
                <button onClick={reload} className="btn-ghost text-xs">↻ Refresh</button>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}

            {!loading && !error && (
                articles.length === 0
                    ? <EmptyState>No knowledge base articles found{search ? ` for "${search}"` : ''}.</EmptyState>
                    : (
                        <div className="space-y-2.5">
                            {pageArticles.map(a => <KbArticleCard key={a.id} article={a} tenantNames={tenantId === null ? tenantNames : null} />)}
                            <Pagination page={page} pageCount={pageCount} onChange={setPage} total={articles.length} pageSize={ARTICLES_PAGE_SIZE} />
                        </div>
                    )
            )}
        </div>
    )
}

export default function ItsmKnowledgeBasePage() {
    const { isAgent } = useItsmPermissions()
    const [tab, setTab] = useState('articles')

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-700">
                <button
                    onClick={() => setTab('articles')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'articles' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}
                >
                    Articles
                </button>
                {isAgent && (
                    <button
                        onClick={() => setTab('pending')}
                        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'pending' ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}
                    >
                        Pending Review
                    </button>
                )}
            </div>

            {tab === 'articles' ? <ArticlesTab /> : <KbPendingReviewPanel />}
        </div>
    )
}
