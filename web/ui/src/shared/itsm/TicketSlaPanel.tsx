import { useCallback, useEffect, useState } from 'react'
import { useItsmApi } from './useItsmApi'
import { LoadingSpinner, ErrorBanner } from './primitives'

const METRIC_LABELS: Record<string, string> = {
    first_response: 'First response',
    next_response: 'Next response',
    periodic_update: 'Periodic update',
    time_to_acknowledge: 'Acknowledge',
    time_to_mitigate: 'Mitigate',
    resolution: 'Resolution',
}

interface SlaInstance {
    id: string
    metric: string
    status: string
    due_at?: string
    consumed_pct?: number
    attributed_party?: { kind: string }
}
interface SlaData { instances?: SlaInstance[] }
interface SlaAgreement { id: string; name: string; kind: string }

function fmtDuration(sec: number): string {
    const s = Math.abs(Math.round(sec))
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    if (d) return `${d}d ${h}h`
    if (h) return `${h}h ${m}m`
    if (m) return `${m}m ${s % 60}s`
    return `${s}s`
}

// Per-instance clock row. Recomputes remaining from due_at each tick so the
// countdown is accurate without re-fetching.
function ClockRow({ inst, now }: { inst: SlaInstance; now: number }) {
    const terminal = ['met', 'stopped', 'cancelled'].includes(inst.status)
    const dueMs = inst.due_at ? new Date(inst.due_at).getTime() : null
    const remaining = dueMs != null ? (dueMs - now) / 1000 : null
    const overdue = inst.status === 'breached' || (remaining != null && remaining < 0)

    let barColor = 'bg-emerald-500'
    if (overdue) barColor = 'bg-red-500'
    else if ((inst.consumed_pct ?? 0) >= 75) barColor = 'bg-amber-500'
    const pct = overdue ? 100 : Math.max(0, Math.min(100, inst.consumed_pct ?? 0))

    const statusText = inst.status === 'breached' ? 'breached'
        : inst.status === 'paused' ? 'paused'
        : terminal ? inst.status
        : overdue ? 'overdue'
        : 'on track'

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                    {METRIC_LABELS[inst.metric] || inst.metric}
                </span>
                <span className={overdue ? 'text-red-600 dark:text-red-400 font-medium'
                    : inst.status === 'paused' ? 'text-slate-400'
                    : 'text-slate-500 dark:text-slate-400'}>
                    {terminal ? statusText
                        : remaining == null ? statusText
                        : overdue ? `overdue ${fmtDuration(remaining)}`
                        : fmtDuration(remaining) + ' left'}
                </span>
            </div>
            {!terminal && (
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                </div>
            )}
            {inst.attributed_party && (
                <p className="text-[11px] text-red-500">
                    Attributed to {inst.attributed_party.kind}
                </p>
            )}
        </div>
    )
}

/**
 * Live SLA clocks for a ticket (Phase 7). Reads GET /tickets/{id}/sla and lets a
 * manager override which agreement applies. Countdown ticks locally every second.
 */
export default function TicketSlaPanel({ ticketId, canManage = false }: { ticketId: string; canManage?: boolean }) {
    const { get, post } = useItsmApi()
    const [data, setData] = useState<SlaData | null>(null)
    const [error, setError] = useState<Error | null>(null)
    const [loading, setLoading] = useState(true)
    const [now, setNow] = useState(Date.now())
    const [agreements, setAgreements] = useState<SlaAgreement[]>([])
    const [overrideId, setOverrideId] = useState('')
    const [saving, setSaving] = useState(false)

    const load = useCallback(() => {
        setLoading(true)
        get<SlaData>(`/tickets/${ticketId}/sla`)
            .then(d => { setData(d); setError(null) })
            .catch((e: Error) => setError(e))
            .finally(() => setLoading(false))
    }, [get, ticketId])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        if (!canManage) return
        get<SlaAgreement[]>('/sla/agreements').then(rows => setAgreements(rows || [])).catch(() => {})
    }, [get, canManage])
    // 1s tick for the countdown.
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(t)
    }, [])

    const applyOverride = async () => {
        if (!overrideId) return
        setSaving(true); setError(null)
        try {
            const d = await post<SlaData>(`/tickets/${ticketId}/sla/override`, { agreement_id: overrideId })
            setData(d); setOverrideId('')
        } catch (e) { setError(e as Error) } finally { setSaving(false) }
    }

    const instances = data?.instances || []

    return (
        <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">SLA</h3>
            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {!loading && instances.length === 0 && (
                <p className="text-xs text-slate-400 dark:text-slate-500">No SLA applied to this ticket.</p>
            )}
            <div className="space-y-3">
                {instances.map(inst => <ClockRow key={inst.id} inst={inst} now={now} />)}
            </div>

            {canManage && agreements.length > 0 && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                    <select
                        className="input text-xs flex-1" value={overrideId}
                        onChange={e => setOverrideId(e.target.value)} disabled={saving}
                    >
                        <option value="">Override SLA…</option>
                        {agreements.filter(a => a.kind === 'sla').map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                    <button className="btn-primary text-xs" onClick={applyOverride} disabled={!overrideId || saving}>
                        {saving ? 'Applying…' : 'Apply'}
                    </button>
                </div>
            )}
        </div>
    )
}
