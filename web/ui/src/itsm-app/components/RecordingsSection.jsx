import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'

const SOURCE_LABEL = { teams: 'Teams', sharepoint: 'SharePoint', onedrive: 'OneDrive', manual_upload: 'Upload' }

function ConsentPill({ status }) {
    const tone = status === 'missing' || status === 'disputed'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${tone}`}>{status.replace(/_/g, ' ')}</span>
}

function SummaryStatusPill({ status }) {
    if (status === 'completed') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 font-medium">summarized</span>
    if (status === 'pending') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 font-medium">summarizing…</span>
    if (status === 'failed') return <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-medium">summary failed</span>
    return null
}

function RecordingCard({ ticketId, rec, onChanged }) {
    const { post, patch } = useItsmApi()
    const [busy, setBusy] = useState(false)

    const generateSummary = async () => {
        setBusy(true)
        try { await post(`/support-recordings/${rec.id}/generate-summary`, {}); onChanged() }
        catch { /* ignore */ } finally { setBusy(false) }
    }
    const toggleEvidence = async () => {
        setBusy(true)
        const next = rec.evidence_weight === 'required_for_rca' ? 'none' : 'required_for_rca'
        try { await patch(`/tickets/${ticketId}/recordings/${rec.id}`, { evidence_weight: next }); onChanged() }
        catch { /* ignore */ } finally { setBusy(false) }
    }

    return (
        <li className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{rec.title}</p>
                    <p className="text-xs text-slate-400">
                        {SOURCE_LABEL[rec.source_type] || rec.source_type}
                        {rec.started_at ? ` · ${new Date(rec.started_at).toLocaleString()}` : ''}
                        {rec.organizer_email ? ` · ${rec.organizer_email}` : ''}
                    </p>
                </div>
                <a href={rec.recording_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline shrink-0">Open</a>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <ConsentPill status={rec.consent_status} />
                <SummaryStatusPill status={rec.ai_summary_status} />
                {rec.evidence_weight === 'required_for_rca' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium">RCA evidence</span>
                )}
                {rec.status === 'inaccessible' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 font-medium">inaccessible</span>
                )}
            </div>
            {rec.ai_summary && <p className="text-xs text-slate-500 italic">{rec.ai_summary}</p>}
            <div className="flex items-center gap-3 pt-0.5">
                {rec.ai_summary_status === 'not_requested' || rec.ai_summary_status === 'failed' ? (
                    <button onClick={generateSummary} disabled={busy} className="text-xs text-blue-600 hover:underline">Generate summary</button>
                ) : null}
                <button onClick={toggleEvidence} disabled={busy} className="text-xs text-slate-500 hover:underline">
                    {rec.evidence_weight === 'required_for_rca' ? 'Unmark as RCA evidence' : 'Use as RCA evidence'}
                </button>
            </div>
        </li>
    )
}

function AddRecordingForm({ ticketId, onAdded }) {
    const { post } = useItsmApi()
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)

    const submit = async () => {
        if (!url.trim() || !title.trim() || busy) return
        setBusy(true); setError(null)
        try {
            await post(`/tickets/${ticketId}/recordings/from-url`, { url: url.trim(), title: title.trim() })
            setUrl(''); setTitle(''); onAdded()
        } catch (e) { setError(e) } finally { setBusy(false) }
    }

    return (
        <div className="space-y-1.5">
            <div className="flex flex-wrap items-end gap-2">
                <input className="input text-xs flex-1 min-w-[220px]" placeholder="Paste a Teams / SharePoint / OneDrive recording link"
                       value={url} onChange={e => setUrl(e.target.value)} />
                <input className="input text-xs w-48" placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
                <button className="btn-primary text-xs" onClick={submit} disabled={busy || !url.trim() || !title.trim()}>
                    {busy ? 'Linking…' : '+ Link recording'}
                </button>
            </div>
            {error && <ErrorBanner message={error.message} />}
        </div>
    )
}

export default function RecordingsSection({ ticketId }) {
    const { get } = useItsmApi()
    const { data, loading, error, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}/recordings`), [get, ticketId]
    )
    const recordings = data?.items || []

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recordings</h3>
            </div>
            <AddRecordingForm ticketId={ticketId} onAdded={reload} />
            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && (recordings.length === 0
                ? <EmptyState>No recordings linked to this ticket.</EmptyState>
                : <ul className="space-y-1.5">{recordings.map(r => <RecordingCard key={r.id} ticketId={ticketId} rec={r} onChanged={reload} />)}</ul>
            )}
        </div>
    )
}
