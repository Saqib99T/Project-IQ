import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { ErrorBanner } from '../../shared/itsm/primitives'

function formatDate(d) {
    if (!d) return '—'
    return new Date(d).toLocaleDateString()
}

function riskLabel(score) {
    if (score >= 0.7) return { text: 'High risk', cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' }
    if (score >= 0.4) return { text: 'Medium risk', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' }
    return { text: 'Low risk', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' }
}

/**
 * Surfaces the AI predictive-maintenance forecast for an asset — produced by a
 * nightly background task (app/api/v1/assets.py ai-maintenance-prediction).
 * Returns null (renders nothing) when no prediction has been generated yet.
 */
export default function AiMaintenancePredictionSection({ assetId }) {
    const { get, post } = useItsmApi()
    const { isAgent } = useItsmPermissions()
    const [acking, setAcking] = useState(false)
    const [error, setError] = useState(null)

    const { data: prediction, loading, reload } = useItsmResource(
        () => get(`/assets/${assetId}/ai-maintenance-prediction`).catch(err => err.status === 404 ? null : Promise.reject(err)),
        [get, assetId]
    )

    if (loading || !prediction) return null

    const risk = riskLabel(prediction.risk_score)

    const acknowledge = async () => {
        setAcking(true); setError(null)
        try { await post(`/assets/${assetId}/ai-maintenance-prediction/acknowledge`, {}); reload() }
        catch (err) { setError(err) } finally { setAcking(false) }
    }

    return (
        <div className="card p-6 space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">✨ AI maintenance forecast</h3>
                <span className={`badge ${risk.cls}`}>{risk.text} · {Math.round(prediction.risk_score * 100)}%</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300">{prediction.reason}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Predicted due</p>
                    <p className="text-slate-800 dark:text-slate-200">{formatDate(prediction.predicted_due_date)}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Model</p>
                    <p className="text-slate-800 dark:text-slate-200 font-mono text-xs">{prediction.model_version}</p>
                </div>
                <div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide">Generated</p>
                    <p className="text-slate-800 dark:text-slate-200">{formatDate(prediction.created_at)}</p>
                </div>
            </div>
            {error && <ErrorBanner message={error.message} />}
            {prediction.acknowledged ? (
                <p className="text-xs text-slate-400 dark:text-slate-500">✓ Acknowledged</p>
            ) : isAgent && (
                <button onClick={acknowledge} disabled={acking} className="btn-ghost text-xs py-1.5">
                    {acking ? 'Acknowledging…' : 'Acknowledge'}
                </button>
            )}
        </div>
    )
}
