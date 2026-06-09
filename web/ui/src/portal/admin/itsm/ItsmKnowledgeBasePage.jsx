import { useState } from 'react'
import { useItsmApi, useItsmResource, useTenantDirectory, loadKbArticles } from '../../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../../shared/itsm/ItsmTenantContext'
import { KbArticleCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'

export default function ItsmKnowledgeBasePage() {
    const { tenantId } = useItsmTenant()
    const { get } = useItsmApi(tenantId)
    const tenantNames = useTenantDirectory(tenantId === null)
    const [search, setSearch] = useState('')

    const { data, loading, error, reload } = useItsmResource(
        () => loadKbArticles(get, search),
        [get, search]
    )
    const articles = data?.articles || []

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
                            {articles.map(a => <KbArticleCard key={a.id} article={a} tenantNames={tenantId === null ? tenantNames : null} />)}
                        </div>
                    )
            )}
        </div>
    )
}
