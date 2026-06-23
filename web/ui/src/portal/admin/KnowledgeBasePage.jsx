import { useState, useEffect, useRef, useCallback } from 'react'
import { useApi } from '../useApi'

function StatusBadge({ ok }) {
    return ok
        ? <span className="badge bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400">healthy</span>
        : <span className="badge bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400">error</span>
}

const SOURCE_META = {
    glpi: { label: 'Project IQ KB (GLPI)', icon: '🌐', cls: 'bg-green-100 dark:bg-emerald-500/10', detail: 'Live from GLPI API' },
    itsm: { label: 'Project IQ ITSM', icon: '🛠️', cls: 'bg-blue-100 dark:bg-blue-500/10', detail: 'Live from itsm-service' },
    json: { label: 'Local JSON', icon: '📄', cls: 'bg-yellow-100', detail: 'Fallback mode' },
}

function sourceMeta(source) {
    return SOURCE_META[source] || { label: source || 'Unknown', icon: '❓', cls: 'bg-gray-100 dark:bg-slate-800', detail: 'Unknown source' }
}

function formatRelativeTime(iso) {
    if (!iso) return '—'
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    return date.toLocaleDateString()
}

function ScoreBadge({ score }) {
    let cls = 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300'
    if (score >= 0.7) cls = 'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400'
    else if (score >= 0.4) cls = 'bg-yellow-100 text-yellow-700'
    return <span className={`text-xs px-2 py-1 rounded font-semibold ${cls}`}>Score: {score.toFixed(3)}</span>
}

function SearchResultCard({ result, index }) {
    const { article, scores } = result
    return (
        <div className="border border-gray-200 dark:border-slate-700 rounded-lg p-4 hover:border-blue-300 hover:dark:border-blue-500/20 transition-colors">
            <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                    <h4 className="font-semibold text-gray-800 dark:text-slate-200">{index + 1}. {article.title}</h4>
                    <div className="flex gap-2 mt-1">
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded">{article.category}</span>
                        {article.is_faq && <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded">FAQ</span>}
                        <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded">{article.source || 'unknown'}</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-1 ml-4">
                    <ScoreBadge score={scores.final_score ?? 0} />
                </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-3 line-clamp-3">{article.content}</p>
            <div className="flex gap-4 text-xs text-gray-500 dark:text-slate-400">
                <span>🧠 Semantic: {(scores.semantic_score ?? 0).toFixed(3)}</span>
                <span>🔤 Keyword: {(scores.keyword_score ?? 0).toFixed(3)}</span>
                {article.glpi_id && <span>📋 Ticket ID: {article.glpi_id}</span>}
                {article.itsm_id && <span>🛠️ Article ID: {article.itsm_id}</span>}
            </div>
        </div>
    )
}

function ArticleModal({ article, onClose }) {
    if (!article) return null
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold text-gray-800 dark:text-slate-200">{article.title}</h3>
                    <button onClick={onClose} className="text-gray-400 dark:text-slate-500 hover:text-gray-600 hover:dark:text-slate-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded">{article.category}</span>
                        {article.is_faq && <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded">FAQ</span>}
                        <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 rounded">{article.source || 'unknown'}</span>
                        {article.glpi_id && <span className="text-xs px-2 py-1 bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400 rounded">Ticket #{article.glpi_id}</span>}
                        {article.itsm_id && <span className="text-xs px-2 py-1 bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400 rounded">Article #{article.itsm_id}</span>}
                    </div>
                    {article.question && (
                        <div className="bg-yellow-50 p-3 rounded text-sm"><strong>Question:</strong> {article.question}</div>
                    )}
                    <div className="prose max-w-none text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap">
                        {article.answer || article.content || 'No content available'}
                    </div>
                    {article.keywords && article.keywords.length > 0 && (
                        <div className="mt-4">
                            <strong className="text-sm text-gray-600 dark:text-slate-400">Keywords:</strong>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {article.keywords.map((kw, i) => (
                                    <span key={i} className="text-xs px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 rounded">{kw}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function DistributionBars({ counts, variant }) {
    const entries = Object.entries(counts)
    if (entries.length === 0) return <p className="text-gray-400 dark:text-slate-500 text-center py-4 text-sm">No data</p>
    if (variant === 'category') {
        const sorted = entries.sort((a, b) => b[1] - a[1]).slice(0, 10)
        const max = sorted[0]?.[1] || 1
        return (
            <div className="space-y-2">
                {sorted.map(([label, count]) => (
                    <div key={label} className="flex-1">
                        <div className="flex justify-between mb-1">
                            <span className="text-sm text-gray-700 dark:text-slate-300">{label}</span>
                            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{count}</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                            <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        )
    }
    const total = entries.reduce((sum, [, c]) => sum + c, 0) || 1
    return (
        <div className="space-y-2">
            {entries.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800/60 rounded">
                    <div>
                        <span className="font-semibold text-gray-800 dark:text-slate-200">{label.toUpperCase()}</span>
                        <span className="text-sm text-gray-500 dark:text-slate-400 ml-2">{count} articles</span>
                    </div>
                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{((count / total) * 100).toFixed(1)}%</span>
                </div>
            ))}
        </div>
    )
}

export default function KnowledgeBasePage() {
    const { call } = useApi()
    const [status, setStatus]         = useState(null)
    const [loading, setLoading]       = useState(true)
    const [error, setError]           = useState(null)
    const [refreshing, setRefreshing] = useState(false)

    // Search tester
    const [query, setQuery]         = useState('')
    const [results, setResults]     = useState(null)
    const [searching, setSearching] = useState(false)

    // Article browser
    const [articles, setArticles]       = useState([])
    const [page, setPage]               = useState(1)
    const [totalPages, setTotalPages]   = useState(1)
    const [total, setTotal]             = useState(0)
    const [count, setCount]             = useState(0)
    const [filter, setFilter]           = useState('')
    const [articlesLoading, setArticlesLoading] = useState(true)
    const [activeArticle, setActiveArticle]     = useState(null)
    const [gaps, setGaps]                       = useState([])
    const filterDebounce = useRef(null)
    const pollRef = useRef(null)

    const loadStatus = useCallback(async () => {
        try {
            const d = await call('/admin/kb/status')
            setStatus(d?.status || d)
        } catch (e) {
            setError(e.message)
        }
    }, [call])

    const loadGaps = useCallback(async () => {
        try {
            const d = await call('/admin/kb/gaps?days=7&limit=15')
            if (d?.success) setGaps(d.data || [])
        } catch { /* non-fatal — gaps are advisory */ }
    }, [call])

    const loadArticles = useCallback(async (p = 1, f = '') => {
        setArticlesLoading(true)
        try {
            const d = await call(`/admin/kb/articles?page=${p}&limit=50&filter=${encodeURIComponent(f)}`)
            setArticles(d?.articles || [])
            setTotalPages(d?.total_pages || 1)
            setTotal(d?.total || 0)
            setCount(d?.count || 0)
            setPage(p)
        } catch (e) {
            setError(e.message)
        } finally {
            setArticlesLoading(false)
        }
    }, [call])

    useEffect(() => {
        Promise.all([loadStatus(), loadArticles(1, ''), loadGaps()])
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))

        pollRef.current = setInterval(loadStatus, 30000)
        return () => clearInterval(pollRef.current)
    }, [loadStatus, loadArticles])

    const handleRefresh = async () => {
        setRefreshing(true)
        try {
            const d = await call('/admin/kb/refresh', { method: 'POST', body: JSON.stringify({}) })
            if (!d?.success) setError(d?.message || d?.error || 'KB refresh failed')
            await Promise.all([loadStatus(), loadArticles(page, filter)])
        } catch (e) {
            setError(e.message)
        } finally {
            setRefreshing(false)
        }
    }

    const handleSearch = async (e) => {
        e.preventDefault()
        if (!query.trim()) return
        setSearching(true)
        setResults(null)
        try {
            const d = await call('/admin/kb/search', {
                method: 'POST',
                body: JSON.stringify({ query: query.trim() }),
            })
            setResults(d?.results || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setSearching(false)
        }
    }

    const handleFilterChange = (val) => {
        setFilter(val)
        if (filterDebounce.current) clearTimeout(filterDebounce.current)
        filterDebounce.current = setTimeout(() => loadArticles(1, val), 350)
    }

    if (loading) return (
        <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )

    const src = sourceMeta(status?.source)
    const lastRefresh = status?.last_refresh
    const nextRefresh = (lastRefresh && status?.refresh_interval)
        ? Math.max(0, Math.round((new Date(lastRefresh).getTime() + status.refresh_interval * 1000 - Date.now()) / 60000))
        : null

    const categoryCounts = {}
    const sourceCounts = {}
    for (const a of articles) {
        const cat = a.category || 'Uncategorized'
        const src2 = a.source || 'unknown'
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
        sourceCounts[src2] = (sourceCounts[src2] || 0) + 1
    }

    return (
        <div className="max-w-5xl space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Knowledge Base</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">Manage KB cache, monitor semantic search, and test article retrieval</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} className="btn-primary">
                    {refreshing ? 'Refreshing…' : '↻ Refresh index'}
                </button>
            </div>

            {error && (
                <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm flex items-center justify-between">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 hover:dark:text-red-400">✕</button>
                </div>
            )}

            {/* Status cards */}
            {status && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Total Articles</p>
                                <p className="text-3xl font-semibold text-blue-600 dark:text-blue-400">{status.article_count ?? '—'}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center text-2xl">📚</div>
                        </div>
                        <div className="pt-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
                            <p className="text-xs text-gray-500 dark:text-slate-400">Cached articles</p>
                            <StatusBadge ok={!!status.article_count} />
                        </div>
                    </div>

                    <div className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Data Source</p>
                                <p className="text-base font-semibold text-gray-700 dark:text-slate-300">{src.label}</p>
                            </div>
                            <div className={`w-12 h-12 rounded-full ${src.cls} flex items-center justify-center text-2xl`}>{src.icon}</div>
                        </div>
                        <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
                            <p className="text-xs text-gray-500 dark:text-slate-400">{src.detail}</p>
                        </div>
                    </div>

                    <div className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Last Refresh</p>
                                <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">{formatRelativeTime(lastRefresh)}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-500/10 flex items-center justify-center text-2xl">⏱️</div>
                        </div>
                        <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
                            <p className="text-xs text-gray-500 dark:text-slate-400">{nextRefresh !== null ? `Next: in ${nextRefresh} min` : 'Next: —'}</p>
                        </div>
                    </div>

                    <div className="card p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-sm text-gray-500 dark:text-slate-400">Semantic Model</p>
                                <p className="text-xs font-semibold text-gray-700 dark:text-slate-300">{status.model_info?.model_name || '—'}</p>
                            </div>
                            <div className="w-12 h-12 rounded-full bg-orange-100 dark:bg-orange-500/10 flex items-center justify-center text-2xl">🧠</div>
                        </div>
                        <div className="pt-3 border-t border-gray-100 dark:border-slate-800 space-y-1">
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500 dark:text-slate-400">Dimensions</span>
                                <span className="font-medium text-gray-700 dark:text-slate-300">{status.model_info?.embedding_dimension || '—'}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500 dark:text-slate-400">Cache Size</span>
                                <span className="font-medium text-gray-700 dark:text-slate-300">{status.cache_size_mb != null ? `${status.cache_size_mb.toFixed(1)} MB` : '—'}</span>
                            </div>
                            <div className="flex justify-between items-center text-xs">
                                <span className="text-gray-500 dark:text-slate-400">Search backend</span>
                                <span className={`font-medium ${status.vector_backend === 'keyword-only' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-slate-300'}`}>
                                    {status.vector_backend || '—'}{status.vector_backend === 'keyword-only' ? ' ⚠️' : ''}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Knowledge gaps — top unanswered user queries (writers' to-do list) */}
            {gaps.length > 0 && (
                <div className="card p-5">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">Knowledge Gaps</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">Top user queries that returned no answer (last 7 days) — candidates for new articles.</p>
                    <div className="divide-y divide-gray-100 dark:divide-slate-800">
                        {gaps.map((g, i) => (
                            <div key={i} className="flex items-center gap-3 py-1.5">
                                <span className="text-sm text-gray-800 dark:text-slate-200 truncate flex-1">{g.query}</span>
                                <span className="text-[11px] text-gray-400 dark:text-slate-500 shrink-0">{g.count}× · last {g.last_seen ? new Date(g.last_seen).toLocaleDateString() : ''}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Search tester */}
            <div className="card p-5 space-y-4">
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300">Test Knowledge Base Search</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Test semantic + keyword hybrid search with detailed score breakdown</p>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Enter a test query (e.g. 'password reset', 'printer not working')…"
                        className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                    />
                    <button type="submit" disabled={searching} className="btn-primary">
                        {searching ? '…' : 'Search'}
                    </button>
                </form>
                {results && (
                    <div className="space-y-3">
                        {results.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-4">No results found.</p>}
                        {results.length > 0 && (
                            <p className="text-sm text-gray-600 dark:text-slate-400">Found {results.length} results for "<strong>{query}</strong>"</p>
                        )}
                        {results.map((r, i) => <SearchResultCard key={i} result={r} index={i} />)}
                    </div>
                )}
            </div>

            {/* Article browser */}
            <div className="card overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-200">Knowledge Base Articles ({total})</h3>
                    <div className="flex gap-2">
                        <input
                            value={filter}
                            onChange={e => handleFilterChange(e.target.value)}
                            placeholder="Filter by title, category, keywords…"
                            className="px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:dark:ring-blue-400/40"
                        />
                        <button onClick={() => loadArticles(1, filter)} className="btn-secondary text-sm">Reload</button>
                    </div>
                </div>

                {articlesLoading ? (
                    <p className="text-gray-400 dark:text-slate-500 text-center py-8 text-sm">Loading articles…</p>
                ) : articles.length === 0 ? (
                    <p className="text-gray-400 dark:text-slate-500 text-center py-8 text-sm">No articles found</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full table-auto text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">ID</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Title</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Category</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Source</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Modified</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                {articles.map((a, i) => (
                                    <tr key={a.id || i} className="hover:bg-gray-50 hover:dark:bg-slate-800/60">
                                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{a.id || '—'}</td>
                                        <td className="px-4 py-3 font-medium text-gray-800 dark:text-slate-200">
                                            {a.title || 'Untitled'}
                                            {a.is_faq && <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded ml-2">FAQ</span>}
                                        </td>
                                        <td className="px-4 py-3"><span className="px-2 py-1 bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded text-xs">{a.category || 'Uncategorized'}</span></td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">
                                            {a.source || 'unknown'}{a.glpi_id ? ` #${a.glpi_id}` : ''}{a.itsm_id ? ` #${a.itsm_id}` : ''}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{a.date_modified ? new Date(a.date_modified).toLocaleDateString() : '—'}</td>
                                        <td className="px-4 py-3">
                                            <button onClick={() => setActiveArticle(a)} className="text-blue-600 dark:text-blue-400 hover:text-blue-800 hover:dark:text-blue-400">
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="px-5 py-3 flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-slate-400">
                        {total > 0 ? `Showing ${((page - 1) * 50) + 1}-${Math.min((page - 1) * 50 + count, total)} of ${total} articles` : 'Showing 0 articles'}
                    </span>
                    <div className="flex gap-2">
                        {page > 1 && <button onClick={() => loadArticles(page - 1, filter)} className="px-3 py-1 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 hover:dark:bg-slate-800/60">Previous</button>}
                        {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                            const start = Math.max(1, Math.min(page - 2, totalPages - 4))
                            const p = start + idx
                            if (p > totalPages) return null
                            return (
                                <button key={p} onClick={() => loadArticles(p, filter)}
                                        className={`px-3 py-1 rounded border ${p === page ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 hover:bg-gray-50 hover:dark:bg-slate-800/60'}`}>
                                    {p}
                                </button>
                            )
                        })}
                        {page < totalPages && <button onClick={() => loadArticles(page + 1, filter)} className="px-3 py-1 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 rounded hover:bg-gray-50 hover:dark:bg-slate-800/60">Next</button>}
                    </div>
                </div>
            </div>

            {/* Statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Articles by Category (current page)</h3>
                    <DistributionBars counts={categoryCounts} variant="category" />
                </div>
                <div className="card p-6">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-4">Source Distribution (current page)</h3>
                    <DistributionBars counts={sourceCounts} variant="source" />
                </div>
            </div>

            <ArticleModal article={activeArticle} onClose={() => setActiveArticle(null)} />
        </div>
    )
}
