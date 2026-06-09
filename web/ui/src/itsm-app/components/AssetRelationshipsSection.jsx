import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import { LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import { useConfirm } from '../../shared/itsm/ui'

const RELATIONSHIP_TYPES = ['runs_on', 'connected_to', 'depends_on', 'hosts', 'part_of', 'backs_up']

function NewRelationshipForm({ assetId, exclude, onCreated }) {
    const { get, post } = useItsmApi()
    const [search, setSearch] = useState('')
    const [target, setTarget] = useState(null)
    const [type, setType] = useState(RELATIONSHIP_TYPES[0])
    const [description, setDescription] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const { data: allAssets, loading } = useItsmResource(() => get('/assets'), [get])
    const candidates = (allAssets?.assets || allAssets?.items || []).filter(a =>
        a.id !== assetId && !exclude.has(a.id) &&
        (search.trim() === '' || a.name?.toLowerCase().includes(search.toLowerCase()) || a.asset_tag?.toLowerCase().includes(search.toLowerCase()))
    )

    const submit = async (e) => {
        e.preventDefault()
        if (!target) return
        setSubmitting(true); setError(null)
        try {
            await post(`/assets/${assetId}/relationships`, {
                target_asset_id: target.id,
                relationship_type: type,
                description: description.trim() || null,
            })
            setTarget(null); setSearch(''); setDescription('')
            onCreated()
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <form onSubmit={submit} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 space-y-2">
            {!target ? (
                <>
                    <input className="input text-sm" placeholder="Search target asset by name or tag…" value={search} onChange={e => setSearch(e.target.value)} />
                    {loading && <LoadingSpinner />}
                    <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                        {candidates.map(a => (
                            <li key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                                <div className="min-w-0">
                                    <p className="text-slate-800 dark:text-slate-200 truncate">{a.name}</p>
                                    <p className="text-xs font-mono text-slate-400 dark:text-slate-500">{a.asset_tag}</p>
                                </div>
                                <button type="button" onClick={() => setTarget(a)} className="btn-ghost text-xs py-1 shrink-0">Select</button>
                            </li>
                        ))}
                    </ul>
                </>
            ) : (
                <>
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-700 dark:text-slate-300">Target: <strong>{target.name}</strong> <span className="text-xs font-mono text-slate-400">({target.asset_tag})</span></span>
                        <button type="button" onClick={() => setTarget(null)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Change</button>
                    </div>
                    <select className="input text-sm" value={type} onChange={e => setType(e.target.value)}>
                        {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input className="input text-sm" placeholder="Description (optional)" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} />
                    {error && <ErrorBanner message={error.message} />}
                    <div className="flex justify-end">
                        <button type="submit" disabled={submitting} className="btn-primary text-xs py-1.5">
                            {submitting ? 'Creating…' : 'Create relationship'}
                        </button>
                    </div>
                </>
            )}
        </form>
    )
}

export default function AssetRelationshipsSection({ assetId }) {
    const { isTeamLead } = useItsmPermissions()
    const { get, remove } = useItsmApi()
    const confirm = useConfirm()
    const [showNew, setShowNew] = useState(false)
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data: relationships, loading, reload } = useItsmResource(() => get(`/assets/${assetId}/relationships`), [get, assetId])
    const rels = relationships || []
    const canManage = isTeamLead
    const relatedIds = useMemo(() => new Set(rels.map(r => r.source_asset_id === assetId ? r.target_asset_id : r.source_asset_id)), [rels, assetId])

    const del = async (rel) => {
        if (!(await confirm({ title: 'Remove relationship?', message: 'This CMDB relationship will be removed.', danger: true, confirmLabel: 'Remove' }))) return
        setBusyId(rel.id); setError(null)
        try { await remove(`/assets/${assetId}/relationships/${rel.id}`); reload() }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Relationships (CMDB)</h3>
                {canManage && (
                    <button onClick={() => setShowNew(s => !s)} className="btn-ghost text-xs py-1.5">
                        {showNew ? 'Close' : '+ New relationship'}
                    </button>
                )}
            </div>

            {error && <ErrorBanner message={error.message} />}
            {showNew && <NewRelationshipForm assetId={assetId} exclude={relatedIds} onCreated={() => { setShowNew(false); reload() }} />}

            {loading && <LoadingSpinner />}
            {!loading && rels.length === 0 && (
                <p className="text-sm text-slate-400 dark:text-slate-500">No relationships recorded.</p>
            )}
            {rels.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rels.map(rel => {
                        const outgoing = rel.source_asset_id === assetId
                        const otherId = outgoing ? rel.target_asset_id : rel.source_asset_id
                        return (
                            <li key={rel.id} className="flex items-center justify-between py-2 text-sm">
                                <div className="min-w-0">
                                    <p className="text-slate-800 dark:text-slate-200">
                                        {outgoing ? 'This asset' : 'Other asset'} <span className="font-medium">{rel.relationship_type.replace(/_/g, ' ')}</span> {outgoing ? <Link to={`/assets/${otherId}`} className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs">{otherId}</Link> : <span className="font-mono text-xs text-slate-500">this asset</span>}
                                    </p>
                                    {!outgoing && <p className="text-xs text-slate-400 dark:text-slate-500">via <Link to={`/assets/${otherId}`} className="hover:underline font-mono">{otherId}</Link></p>}
                                    {rel.description && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{rel.description}</p>}
                                </div>
                                {canManage && (
                                    <button onClick={() => del(rel)} disabled={busyId === rel.id} className="btn-ghost text-xs py-1 text-red-600 dark:text-red-400 shrink-0">
                                        {busyId === rel.id ? '…' : 'Remove'}
                                    </button>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
