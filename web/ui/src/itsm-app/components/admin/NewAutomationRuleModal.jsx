import { useState } from 'react'
import { useItsmApi } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../../shared/itsm/primitives'

const TRIGGERS = ['ticket.created', 'ticket.updated', 'ticket.status_changed', 'ticket.assigned', 'asset.created', 'asset.updated']

function parseJsonArray(text, label) {
    if (!text.trim()) return []
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error(`${label} must be valid JSON`) }
    if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`)
    return parsed
}

export default function NewAutomationRuleModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [trigger, setTrigger] = useState(TRIGGERS[0])
    const [conditions, setConditions] = useState('[]')
    const [actions, setActions] = useState('[]')
    const [runOrder, setRunOrder] = useState('0')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => {
        setName(''); setDescription(''); setTrigger(TRIGGERS[0])
        setConditions('[]'); setActions('[]'); setRunOrder('0'); setError(null)
    }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setError(null)
        let parsedConditions, parsedActions
        try {
            parsedConditions = parseJsonArray(conditions, 'Conditions')
            parsedActions = parseJsonArray(actions, 'Actions')
        } catch (err) { setError(err); return }

        setSubmitting(true)
        try {
            const rule = await post('/automation/rules', {
                name,
                description: description || null,
                trigger,
                conditions: parsedConditions,
                actions: parsedActions,
                run_order: Number(runOrder) || 0,
            })
            reset()
            onCreated(rule)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New automation rule" maxWidth="max-w-2xl">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Auto-assign critical incidents" />
                </FormField>
                <FormField label="Description (optional)">
                    <input className="input" value={description} onChange={e => setDescription(e.target.value)} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Trigger">
                        <select className="select" value={trigger} onChange={e => setTrigger(e.target.value)}>
                            {TRIGGERS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Run order">
                        <input type="number" className="input" value={runOrder} onChange={e => setRunOrder(e.target.value)} />
                    </FormField>
                </div>
                <FormField label="Conditions (JSON array)">
                    <textarea className="input min-h-[90px] text-xs font-mono" value={conditions} onChange={e => setConditions(e.target.value)} placeholder='[{"field": "priority", "op": "eq", "value": "critical"}]' />
                </FormField>
                <FormField label="Actions (JSON array)">
                    <textarea className="input min-h-[90px] text-xs font-mono" value={actions} onChange={e => setActions(e.target.value)} placeholder='[{"type": "assign_team", "team_id": "..."}]' />
                </FormField>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim() || !trigger}>
                        {submitting ? 'Creating…' : 'Create rule'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
