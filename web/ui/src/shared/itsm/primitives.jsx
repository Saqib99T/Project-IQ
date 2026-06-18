/**
 * Shared ITSM UI primitives — used by both the embedded admin-portal pages
 * and the standalone ITSM app. Styling matches the existing portal's
 * Tailwind + dark-mode conventions (see admin/OperatorsPage.jsx).
 */

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
    if (!open) return null
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={onClose} />
            <div className={`relative card w-full ${maxWidth} max-h-[90vh] overflow-y-auto p-6 space-y-4`}>
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">×</button>
                </div>
                {children}
            </div>
        </div>
    )
}

export function FormField({ label, children }) {
    return (
        <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</span>
            {children}
        </label>
    )
}

const STATUS_STYLE = {
    open:             'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    in_progress:      'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    pending:          'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
    pending_approval: 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400',
    approved:         'bg-teal-100 dark:bg-teal-500/10 text-teal-700 dark:text-teal-400',
    rejected:         'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400',
    resolved:         'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400',
    closed:           'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
    cancelled:        'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
}

const PRIORITY_STYLE = {
    low:      'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
    medium:   'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    high:     'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    critical: 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400',
}

function pillClass(map, key) {
    return `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        map[key] || 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
    }`
}

export function StatusBadge({ status }) {
    return <span className={pillClass(STATUS_STYLE, status)}>{(status || 'unknown').replace(/_/g, ' ')}</span>
}

export function PriorityBadge({ priority }) {
    return <span className={pillClass(PRIORITY_STYLE, priority)}>{priority || 'unknown'}</span>
}

export function LoadingSpinner({ className = '' }) {
    return (
        <div className={`flex justify-center py-16 ${className}`}>
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
    )
}

export function ErrorBanner({ message }) {
    if (!message) return null
    return (
        <div className="card p-4 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 text-sm">
            {message}
        </div>
    )
}

export function EmptyState({ children }) {
    return (
        <div className="card p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {children}
        </div>
    )
}

/**
 * Shows which tenant a row belongs to — rendered on list cards in the
 * platform-org "All tenants" cross-tenant view (see useTenantDirectory).
 * Resolves the display name from the tenant directory map; falls back to
 * a truncated id while the directory is still loading.
 */
export function TenantBadge({ tenantId, tenantNames }) {
    if (!tenantId) return null
    const name = tenantNames?.[tenantId] || `${tenantId.slice(0, 8)}…`
    return (
        <span className="badge bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" title={tenantId}>
            🏢 {name}
        </span>
    )
}

export function TicketCard({ ticket, onClick, tenantNames }) {
    return (
        <button
            onClick={onClick}
            className="card w-full text-left p-4 hover:border-blue-400 dark:hover:border-blue-500/50 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{ticket.ticket_number || ticket.id}</p>
                        {ticket.product_name && (
                            <span className="badge bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300">{ticket.product_name}</span>
                        )}
                        {tenantNames && <TenantBadge tenantId={ticket.tenant_id} tenantNames={tenantNames} />}
                    </div>
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{ticket.title}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{ticket.description}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusBadge status={ticket.status} />
                    <PriorityBadge priority={ticket.priority} />
                </div>
            </div>
        </button>
    )
}

const ASSET_STATUS_STYLE = {
    in_use:         'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
    in_stock:       'bg-green-100 dark:bg-emerald-500/10 text-green-700 dark:text-emerald-400',
    in_maintenance: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    retired:        'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
    disposed:       'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500',
    lost:           'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400',
}

export function AssetCard({ asset, onClick, tenantNames }) {
    return (
        <button
            onClick={onClick}
            className="card w-full text-left p-4 hover:border-blue-400 dark:hover:border-blue-500/50 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{asset.asset_tag || asset.id}</p>
                        {tenantNames && <TenantBadge tenantId={asset.tenant_id} tenantNames={tenantNames} />}
                    </div>
                    <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{asset.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{asset.manufacturer || asset.model_number || asset.location || '—'}</p>
                </div>
                <span className={pillClass(ASSET_STATUS_STYLE, asset.status)}>{(asset.status || 'unknown').replace(/_/g, ' ')}</span>
            </div>
        </button>
    )
}

export function KbArticleCard({ article, onClick, tenantNames }) {
    const tenantId = article.tenant_id || article._spaceTenantId
    return (
        <button
            onClick={onClick}
            className="card w-full text-left p-4 hover:border-blue-400 dark:hover:border-blue-500/50 transition-colors"
        >
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <p className="font-medium text-slate-900 dark:text-slate-100 truncate">{article.title}</p>
                {tenantNames && <TenantBadge tenantId={tenantId} tenantNames={tenantNames} />}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2">{article.excerpt || 'No excerpt available.'}</p>
        </button>
    )
}
