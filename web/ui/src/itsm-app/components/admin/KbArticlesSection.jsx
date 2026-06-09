import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Search, BookOpen } from 'lucide-react'
import { useItsmApi } from '../../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../../shared/itsm/primitives'
import Pagination from '../../../shared/itsm/Pagination'

const PAGE_SIZE = 20

const ACCESS_LABELS = {
    global: 'Global',
    product: 'Product',
    tenant: 'Tenant',
    tenant_product: 'Tenant + Product',
}
const STATUS_STYLES = {
    published: 'bg-success/15 text-success',
    draft: 'bg-surface2 text-fgmuted',
    under_review: 'bg-warning/15 text-warning',
    archived: 'bg-danger/10 text-danger',
}

// Admin-side article browser: aggregates articles across every visible space
// (the per-space list endpoint is the only article listing the API exposes),
// so admins get one flat, searchable table of all KB articles.
export default function KbArticlesSection() {
    const { get } = useItsmApi()
    const navigate = useNavigate()
    const [rows, setRows] = useState([])
    const [spaces, setSpaces] = useState([])
    const [spaceFilter, setSpaceFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [nonce, setNonce] = useState(0)
    const [page, setPage] = useState(1)

    useEffect(() => {
        let cancelled = false
        setLoading(true); setError(null)
        ;(async () => {
            try {
                const spaceList = (await get('/kb/spaces')) || []
                if (cancelled) return
                setSpaces(spaceList)
                // Fetch each space's articles in parallel and flatten.
                const perSpace = await Promise.all(spaceList.map(async (s) => {
                    const headers = s.tenant_id ? { 'X-Tenant-ID': s.tenant_id } : undefined
                    const out = []
                    let cursor = null
                    try {
                        // Page through the whole space (cursor-paginated endpoint).
                        do {
                            const params = { limit: 100, ...(cursor ? { cursor } : {}) }
                            const page = await get(`/kb/spaces/${s.slug}/articles`, params, { headers })
                            out.push(...(page.items || []).map(a => ({ ...a, _spaceName: s.name, _spaceSlug: s.slug })))
                            cursor = page.next_cursor
                        } while (cursor)
                    } catch { /* skip unreadable space */ }
                    return out
                }))
                if (cancelled) return
                const all = perSpace.flat().sort((a, b) =>
                    new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
                setRows(all)
            } catch (err) {
                if (!cancelled) setError(err)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [get, nonce])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return rows.filter(a =>
            (spaceFilter === 'all' || a._spaceSlug === spaceFilter) &&
            (statusFilter === 'all' || a.status === statusFilter) &&
            (!q || a.title.toLowerCase().includes(q)))
    }, [rows, search, spaceFilter, statusFilter])

    // Reset to page 1 when filters change; slice the current page client-side.
    useEffect(() => { setPage(1) }, [search, spaceFilter, statusFilter])
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    return (
        <div className="card">
            <div className="card-header flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 mr-auto">
                    <BookOpen className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-fg">Articles</h3>
                    <span className="badge bg-surface2 text-fgmuted">{filtered.length}</span>
                </div>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-fgsubtle" />
                    <input className="input pl-8 w-56 py-1.5" placeholder="Search titles…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="select w-auto py-1.5" value={spaceFilter} onChange={e => setSpaceFilter(e.target.value)}>
                    <option value="all">All spaces</option>
                    {spaces.map(s => <option key={s.id} value={s.slug}>{s.name}</option>)}
                </select>
                <select className="select w-auto py-1.5" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                    {['all', 'published', 'draft', 'under_review', 'archived'].map(s =>
                        <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>)}
                </select>
                <button onClick={() => setNonce(n => n + 1)} className="btn-ghost p-2" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
            </div>

            {loading ? (
                <div className="p-10"><LoadingSpinner /></div>
            ) : error ? (
                <div className="p-5"><ErrorBanner message={error.message} /></div>
            ) : filtered.length === 0 ? (
                <div className="p-10"><EmptyState title="No articles" message="No KB articles match the current filters." /></div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="table-base">
                        <thead>
                            <tr>
                                <th>Title</th><th>Space</th><th>Access</th><th>Status</th><th>Visibility</th><th>Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.map(a => (
                                <tr key={a.id} onClick={() => navigate(`/kb/${a.id}`)} className="cursor-pointer">
                                    <td className="text-fg font-medium">{a.title}</td>
                                    <td>{a._spaceName}</td>
                                    <td><span className="badge bg-primary/10 text-primary">{ACCESS_LABELS[a.access_level] || a.access_level}</span></td>
                                    <td><span className={`badge ${STATUS_STYLES[a.status] || 'bg-surface2 text-fgmuted'}`}>{a.status.replace(/_/g, ' ')}</span></td>
                                    <td>{a.visibility.replace(/_/g, ' ')}</td>
                                    <td>{new Date(a.updated_at || a.created_at).toLocaleDateString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="px-4 pb-3">
                        <Pagination page={page} pageCount={pageCount} onChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
                    </div>
                </div>
            )}
        </div>
    )
}
