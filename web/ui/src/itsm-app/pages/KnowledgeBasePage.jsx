import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { BookOpen, Plus, RefreshCw, FolderTree, Folder, Layers } from 'lucide-react'
import { useItsmApi, useItsmResource, useTenantDirectory } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { KbArticleCard, LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'
import { PageHeader, Button, IconButton, SearchInput, FilterBar } from '../../shared/itsm/ui'
import { cn } from '../../shared/itsm/cn'
import Pagination from '../../shared/itsm/Pagination'
import NewArticleModal from '../components/NewArticleModal'

const STATUSES = ['all', 'draft', 'under_review', 'published', 'archived']
const VISIBILITIES = ['all', 'public', 'internal', 'agents_only']

// Build a parent→children ordered, depth-tagged list from flat categories
function orderTree(cats) {
    const byParent = new Map()
    for (const c of cats) {
        const p = c.parent_id || '__root__'
        if (!byParent.has(p)) byParent.set(p, [])
        byParent.get(p).push(c)
    }
    const out = []
    const walk = (key, depth) => {
        const kids = (byParent.get(key) || []).sort((a, b) => (a.display_order - b.display_order) || a.name.localeCompare(b.name))
        for (const k of kids) { out.push({ ...k, depth }); walk(k.id, depth + 1) }
    }
    walk('__root__', 0)
    for (const c of cats) if (!out.find(o => o.id === c.id)) out.push({ ...c, depth: 0 })
    return out
}

export default function KnowledgeBasePage() {
    const navigate = useNavigate()
    const { get } = useItsmApi()
    const { tenantId } = useItsmTenant()
    const { isPlatformOrg } = useOutletContext() || {}
    const tenantNames = useTenantDirectory(isPlatformOrg && tenantId === null)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('all')
    const [visibility, setVisibility] = useState('all')
    const [showNew, setShowNew] = useState(false)
    const [spaceId, setSpaceId] = useState('')
    const [categoryId, setCategoryId] = useState(null)

    const { data: spaces } = useItsmResource(() => get('/kb/spaces'), [get])
    const spaceList = useMemo(() => spaces || [], [spaces])
    const space = useMemo(() => spaceList.find(s => s.id === spaceId) || spaceList[0], [spaceList, spaceId])

    // Categories for the selected space (best-effort; manager+ scope)
    const { data: catData } = useItsmResource(
        () => space ? get(`/kb/spaces/${space.id}/categories`).catch(() => []) : Promise.resolve([]),
        [get, space?.id]
    )
    const categories = useMemo(() => orderTree(catData || []), [catData])

    const searching = !!search.trim()
    const PAGE_SIZE = 20

    // Standard page-numbered pagination. Search returns a flat ranked list (no
    // paging); the per-space list endpoint supports ?page=&limit= + a total.
    const [page, setPage] = useState(1)
    const [articles, setArticles] = useState([])
    const [total, setTotal] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [refreshTick, setRefreshTick] = useState(0)
    const reload = useCallback(() => setRefreshTick(t => t + 1), [])

    // Reset to page 1 whenever the query/filters/space change.
    useEffect(() => { setPage(1) }, [search, status, visibility, space?.id, categoryId])

    const fetchData = useCallback(async () => {
        if (search.trim()) {
            const r = await get('/kb/search', { q: search.trim(), limit: 30 })
            const items = r.map(x => x.article)
            return { items, total: items.length }
        }
        if (!space) return { items: [], total: 0 }
        const headers = space.tenant_id ? { 'X-Tenant-ID': space.tenant_id } : undefined
        const p = await get(`/kb/spaces/${space.slug}/articles`, {
            ...(status !== 'all' ? { status } : {}),
            ...(visibility !== 'all' ? { visibility } : {}),
            ...(categoryId ? { category_id: categoryId } : {}),
            page, limit: PAGE_SIZE,
        }, { headers })
        return {
            items: (p.items || []).map(a => ({ ...a, _spaceTenantId: space.tenant_id })),
            total: p.total ?? (p.items || []).length,
        }
    }, [get, search, status, visibility, space?.id, space?.slug, categoryId, page])

    useEffect(() => {
        let cancelled = false
        setLoading(true); setError(null)
        fetchData()
            .then(({ items, total }) => { if (!cancelled) { setArticles(items); setTotal(total) } })
            .catch(err => { if (!cancelled) { setError(err); setArticles([]); setTotal(0) } })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [fetchData, refreshTick])

    const pageCount = searching ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE))

    return (
        <div className="space-y-5">
            <PageHeader
                title="Knowledge Base"
                subtitle="Browse and manage help articles by space and category."
                icon={BookOpen}
                actions={
                    <>
                        <IconButton icon={RefreshCw} label="Refresh" onClick={reload} />
                        <Button icon={Plus} onClick={() => setShowNew(true)}>New article</Button>
                    </>
                }
            />

            <FilterBar>
                <SearchInput value={search} onChange={setSearch} placeholder="Search all articles…" className="w-72" />
                <select value={status} onChange={e => setStatus(e.target.value)} className="select w-auto" disabled={searching}>
                    {STATUSES.map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
                </select>
                <select value={visibility} onChange={e => setVisibility(e.target.value)} className="select w-auto" disabled={searching}>
                    {VISIBILITIES.map(v => <option key={v} value={v}>{v === 'all' ? 'All visibilities' : v.replace(/_/g, ' ')}</option>)}
                </select>
            </FilterBar>

            <NewArticleModal
                open={showNew}
                onClose={() => setShowNew(false)}
                onCreated={(article) => { setShowNew(false); navigate(`/kb/${article.id}`) }}
            />

            <div className="flex gap-4 items-start flex-col lg:flex-row">
                {/* Space + category tree nav */}
                {!searching && (
                    <aside className="w-full lg:w-60 shrink-0 space-y-3">
                        <div>
                            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">Space</label>
                            <select value={space?.id || ''} onChange={e => { setSpaceId(e.target.value); setCategoryId(null) }} className="select mt-1">
                                {spaceList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                        <div className="card p-2">
                            <button
                                onClick={() => setCategoryId(null)}
                                className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
                                    categoryId === null ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 font-medium' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')}
                            >
                                <Layers className="w-4 h-4 shrink-0" /> All articles
                            </button>
                            {categories.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => setCategoryId(c.id)}
                                    style={{ paddingLeft: `${10 + c.depth * 14}px` }}
                                    className={cn('w-full flex items-center gap-2 pr-2.5 py-1.5 rounded-lg text-sm transition-colors',
                                        categoryId === c.id ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 font-medium' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800')}
                                >
                                    {c.depth > 0 ? <FolderTree className="w-3.5 h-3.5 shrink-0 text-slate-400" /> : <Folder className="w-4 h-4 shrink-0" />}
                                    <span className="truncate">{c.name}</span>
                                </button>
                            ))}
                            {categories.length === 0 && (
                                <p className="px-2.5 py-2 text-xs text-slate-400 dark:text-slate-500">No categories in this space.</p>
                            )}
                        </div>
                    </aside>
                )}

                {/* Article list */}
                <div className="flex-1 min-w-0 w-full">
                    {loading && <LoadingSpinner />}
                    {error && <ErrorBanner message={error.message} />}
                    {!loading && !error && (
                        articles.length === 0
                            ? <EmptyState>No articles found{search ? ` for "${search}"` : ''}.</EmptyState>
                            : (
                                <div className="space-y-2.5">
                                    {articles.map(a => <KbArticleCard key={a.id} article={a} onClick={() => navigate(`/kb/${a.id}`)} tenantNames={isPlatformOrg && tenantId === null ? tenantNames : null} />)}
                                    {!searching && (
                                        <Pagination page={page} pageCount={pageCount} onChange={setPage} total={total} pageSize={PAGE_SIZE} />
                                    )}
                                </div>
                            )
                    )}
                </div>
            </div>
        </div>
    )
}
