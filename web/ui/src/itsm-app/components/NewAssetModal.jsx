import { useState } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../shared/itsm/primitives'

const CONDITIONS = ['new', 'good', 'fair', 'poor']

export default function NewAssetModal({ open, onClose, onCreated }) {
    const { get, post } = useItsmApi()
    const [name, setName] = useState('')
    const [typeId, setTypeId] = useState('')
    const [condition, setCondition] = useState('new')
    const [serialNumber, setSerialNumber] = useState('')
    const [modelNumber, setModelNumber] = useState('')
    const [manufacturer, setManufacturer] = useState('')
    const [vendorId, setVendorId] = useState('')
    const [location, setLocation] = useState('')
    const [purchaseDate, setPurchaseDate] = useState('')
    const [purchaseCost, setPurchaseCost] = useState('')
    const [warrantyExpiry, setWarrantyExpiry] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const { data: types } = useItsmResource(() => (open ? get('/asset-types') : Promise.resolve(null)), [get, open])
    const { data: vendors } = useItsmResource(() => (open ? get('/vendors') : Promise.resolve(null)), [get, open])
    const typeList = types || []
    const vendorList = vendors || []

    const reset = () => {
        setName(''); setTypeId(''); setCondition('new'); setSerialNumber(''); setModelNumber('')
        setManufacturer(''); setVendorId(''); setLocation(''); setPurchaseDate('')
        setPurchaseCost(''); setWarrantyExpiry(''); setError(null)
    }

    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
            const asset = await post('/assets', {
                name,
                type_id: typeId,
                condition,
                serial_number: serialNumber || null,
                model_number: modelNumber || null,
                manufacturer: manufacturer || null,
                vendor_id: vendorId || null,
                location: location || null,
                purchase_date: purchaseDate || null,
                purchase_cost: purchaseCost ? Number(purchaseCost) : null,
                warranty_expiry_date: warrantyExpiry || null,
            })
            reset()
            onCreated(asset)
        } catch (err) {
            setError(err)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal open={open} onClose={close} title="New asset" maxWidth="max-w-2xl">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required minLength={1} maxLength={500} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Dell Latitude 5420 — Finance #12" />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Asset type">
                        <select className="select" required value={typeId} onChange={e => setTypeId(e.target.value)}>
                            <option value="">Select a type…</option>
                            {typeList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Condition">
                        <select className="select" value={condition} onChange={e => setCondition(e.target.value)}>
                            {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Serial number">
                        <input className="input" value={serialNumber} onChange={e => setSerialNumber(e.target.value)} />
                    </FormField>
                    <FormField label="Model number">
                        <input className="input" value={modelNumber} onChange={e => setModelNumber(e.target.value)} />
                    </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Manufacturer">
                        <input className="input" value={manufacturer} onChange={e => setManufacturer(e.target.value)} />
                    </FormField>
                    <FormField label="Vendor">
                        <select className="select" value={vendorId} onChange={e => setVendorId(e.target.value)}>
                            <option value="">No vendor</option>
                            {vendorList.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                    </FormField>
                </div>
                <FormField label="Location">
                    <input className="input" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. HQ — 3rd floor" />
                </FormField>
                <div className="grid grid-cols-3 gap-3">
                    <FormField label="Purchase date">
                        <input type="date" className="input" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} />
                    </FormField>
                    <FormField label="Purchase cost">
                        <input type="number" step="0.01" min="0" className="input" value={purchaseCost} onChange={e => setPurchaseCost(e.target.value)} />
                    </FormField>
                    <FormField label="Warranty expiry">
                        <input type="date" className="input" value={warrantyExpiry} onChange={e => setWarrantyExpiry(e.target.value)} />
                    </FormField>
                </div>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim() || !typeId}>
                        {submitting ? 'Creating…' : 'Create asset'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
