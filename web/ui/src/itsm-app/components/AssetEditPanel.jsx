import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { ErrorBanner } from '../../shared/itsm/primitives'

const STATUSES = ['in_stock', 'in_use', 'in_maintenance', 'retired', 'disposed', 'lost']
const CONDITIONS = ['new', 'good', 'fair', 'poor']

/**
 * Inline-editable asset fields — each control auto-saves via PATCH /assets/{id}
 * on blur/change. Backend's UpdateAssetRequest also drops null fields
 * (exclude_none-style), so date/vendor clears can't be sent as null here either.
 */
export default function AssetEditPanel({ asset, onUpdated }) {
    const { get, patch } = useItsmApi()
    const [saving, setSaving] = useState(null)
    const [error, setError] = useState(null)
    const [location, setLocation] = useState(asset.location || '')
    const [warranty, setWarranty] = useState(asset.warranty_expiry_date || '')

    const { data: vendors } = useItsmResource(() => get('/vendors'), [get])
    const vendorList = vendors || []

    const patchField = async (field, value) => {
        setSaving(field)
        setError(null)
        try {
            const updated = await patch(`/assets/${asset.id}`, { [field]: value })
            onUpdated(updated)
        } catch (err) {
            setError(err)
        } finally {
            setSaving(null)
        }
    }

    return (
        <div className="space-y-3">
            {error && <ErrorBanner message={error.message} />}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</span>
                    <select
                        className="select text-sm" value={asset.status} disabled={saving === 'status'}
                        onChange={e => patchField('status', e.target.value)}
                    >
                        {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Condition</span>
                    <select
                        className="select text-sm" value={asset.condition} disabled={saving === 'condition'}
                        onChange={e => patchField('condition', e.target.value)}
                    >
                        {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Vendor</span>
                    <select
                        className="select text-sm" value={asset.vendor_id || ''} disabled={saving === 'vendor_id'}
                        onChange={e => e.target.value && patchField('vendor_id', e.target.value)}
                    >
                        <option value="">—</option>
                        {vendorList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Warranty expiry</span>
                    <input
                        type="date" className="input text-sm" value={warranty} disabled={saving === 'warranty_expiry_date'}
                        onChange={e => setWarranty(e.target.value)}
                        onBlur={() => warranty && warranty !== asset.warranty_expiry_date && patchField('warranty_expiry_date', warranty)}
                    />
                </label>
            </div>
            <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Location</span>
                <input
                    className="input text-sm" value={location} disabled={saving === 'location'}
                    onChange={e => setLocation(e.target.value)}
                    onBlur={() => location !== (asset.location || '') && patchField('location', location)}
                    placeholder="e.g. HQ — 3rd floor"
                />
            </label>
        </div>
    )
}
