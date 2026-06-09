import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { StatusBadge, PriorityBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'

export default function AssetImpactAnalysisSection({ assetId }) {
    const { get } = useItsmApi()
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const run = async () => {
        setLoading(true); setError(null)
        try { setResult(await get(`/assets/${assetId}/impact-analysis`)) }
        catch (err) { setError(err) } finally { setLoading(false) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Impact analysis</h3>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Traverses the CMDB relationship graph up to 3 hops to find what would be affected if this asset went down.</p>
                </div>
                <button onClick={run} disabled={loading} className="btn-ghost text-xs py-1.5 shrink-0">
                    {loading ? 'Analyzing…' : result ? '↻ Re-run' : 'Run analysis'}
                </button>
            </div>

            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}

            {result && (
                <div className="space-y-3">
                    <div className="flex gap-4 text-sm text-slate-600 dark:text-slate-300">
                        <span><strong>{result.total_affected_assets}</strong> affected asset{result.total_affected_assets === 1 ? '' : 's'}</span>
                        <span><strong>{result.total_affected_tickets}</strong> open ticket{result.total_affected_tickets === 1 ? '' : 's'}</span>
                    </div>

                    {result.affected_assets.length > 0 && (
                        <div>
                            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Affected assets</p>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {result.affected_assets.map(a => (
                                    <li key={a.id} className="py-1.5 text-sm">
                                        <Link to={`/assets/${a.id}`} className="text-slate-800 dark:text-slate-200 hover:underline">{a.name}</Link>
                                        <span className="ml-2 text-xs font-mono text-slate-400 dark:text-slate-500">{a.asset_tag}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.affected_tickets.length > 0 && (
                        <div>
                            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Affected open tickets</p>
                            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                                {result.affected_tickets.map(t => (
                                    <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                                        <Link to={`/tickets/${t.id}`} className="text-slate-800 dark:text-slate-200 hover:underline truncate">{t.title}</Link>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <StatusBadge status={t.status} />
                                            <PriorityBadge priority={t.priority} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.total_affected_assets === 0 && result.total_affected_tickets === 0 && (
                        <p className="text-sm text-slate-400 dark:text-slate-500">No downstream impact found.</p>
                    )}
                </div>
            )}
        </div>
    )
}
