import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Ticket, MonitorSmartphone, BookOpen, Loader2, type LucideIcon } from 'lucide-react'
import { useItsmApi } from './useItsmApi'
import { StatusBadge } from './primitives'

interface SearchTicket { id: string; title?: string; ticket_number?: string; status?: string }
interface SearchAsset { id: string; name?: string; asset_tag?: string; serial_number?: string }
interface SearchArticle { id: string; title?: string; excerpt?: string; slug?: string }
interface SearchResults { tickets: SearchTicket[]; assets: SearchAsset[]; articles: SearchArticle[] }

/**
 * Top-bar global search across tickets, assets and KB articles. Debounced;
 * results grouped by type in a dropdown. Each backend search is best-effort —
 * a 403/empty for one type just omits that group.
 */
export default function GlobalSearch() {
    const { get } = useItsmApi()
    const navigate = useNavigate()
    const [q, setQ] = useState('')
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [results, setResults] = useState<SearchResults>({ tickets: [], assets: [], articles: [] })
    const boxRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
        window.addEventListener('mousedown', onClick)
        return () => window.removeEventListener('mousedown', onClick)
    }, [])

    useEffect(() => {
        const term = q.trim()
        // All state updates happen inside the (async) timeout callback, never
        // synchronously in the effect body, to avoid cascading-render warnings.
        const handle = setTimeout(async () => {
            if (term.length < 2) {
                setResults({ tickets: [], assets: [], articles: [] })
                setLoading(false)
                return
            }
            setLoading(true)
            const [tickets, assets, articles] = await Promise.all([
                get<{ tickets?: SearchTicket[]; items?: SearchTicket[] }>('/tickets', { search: term, page_size: 5 })
                    .then(d => d?.tickets || d?.items || []).catch(() => [] as SearchTicket[]),
                get<{ assets?: SearchAsset[]; items?: SearchAsset[] }>('/assets', { search: term, page_size: 5 })
                    .then(d => d?.assets || d?.items || []).catch(() => [] as SearchAsset[]),
                get<{ article: SearchArticle }[]>('/kb/search', { q: term, limit: 5 })
                    .then(r => (r || []).map(x => x.article)).catch(() => [] as SearchArticle[]),
            ])
            setResults({ tickets: tickets.slice(0, 5), assets: assets.slice(0, 5), articles: articles.slice(0, 5) })
            setLoading(false)
        }, term.length < 2 ? 0 : 280)
        return () => clearTimeout(handle)
    }, [q, get])

    const go = (path: string) => { setOpen(false); setQ(''); navigate(path) }
    const total = results.tickets.length + results.assets.length + results.articles.length

    return (
        <div ref={boxRef} className="relative w-72">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" strokeWidth={2} />
                <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setOpen(true) }}
                    onFocus={() => setOpen(true)}
                    placeholder="Search tickets, assets, KB…"
                    className="input pl-9 py-1.5"
                />
                {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />}
            </div>

            {open && q.trim().length >= 2 && (
                <div className="absolute z-50 mt-1.5 w-[26rem] right-0 card p-2 max-h-[70vh] overflow-y-auto shadow-xl">
                    {!loading && total === 0 && (
                        <p className="px-3 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No matches for “{q.trim()}”.</p>
                    )}

                    {results.tickets.length > 0 && (
                        <Group label="Tickets" icon={Ticket}>
                            {results.tickets.map(t => (
                                <Row key={t.id} onClick={() => go(`/tickets/${t.id}`)}
                                    primary={t.title}
                                    secondary={t.ticket_number || t.id.slice(0, 8)}
                                    trailing={<StatusBadge status={t.status} />} />
                            ))}
                        </Group>
                    )}
                    {results.assets.length > 0 && (
                        <Group label="Assets" icon={MonitorSmartphone}>
                            {results.assets.map(a => (
                                <Row key={a.id} onClick={() => go(`/assets/${a.id}`)}
                                    primary={a.name}
                                    secondary={a.asset_tag || a.serial_number || a.id.slice(0, 8)} />
                            ))}
                        </Group>
                    )}
                    {results.articles.length > 0 && (
                        <Group label="Knowledge Base" icon={BookOpen}>
                            {results.articles.map(a => (
                                <Row key={a.id} onClick={() => go(`/kb/${a.id}`)}
                                    primary={a.title}
                                    secondary={a.excerpt || a.slug} />
                            ))}
                        </Group>
                    )}
                </div>
            )}
        </div>
    )
}

function Group({ label, icon: Icon, children }: { label: ReactNode; icon?: LucideIcon; children?: ReactNode }) {
    return (
        <div className="mb-1 last:mb-0">
            <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {Icon && <Icon className="w-3.5 h-3.5" />} {label}
            </div>
            {children}
        </div>
    )
}

function Row({ onClick, primary, secondary, trailing }: {
    onClick?: () => void
    primary?: ReactNode
    secondary?: ReactNode
    trailing?: ReactNode
}) {
    return (
        <button onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left transition-colors">
            <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{primary}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{secondary}</p>
            </div>
            {trailing && <span className="shrink-0">{trailing}</span>}
        </button>
    )
}
