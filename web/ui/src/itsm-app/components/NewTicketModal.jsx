import { useState } from 'react'
import { useItsmApi } from '../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../shared/itsm/primitives'

const TYPES = ['incident', 'service_request', 'problem', 'change']
const PRIORITIES = ['low', 'medium', 'high', 'critical']

export default function NewTicketModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [type, setType] = useState('incident')
    const [priority, setPriority] = useState('medium')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => {
        setTitle(''); setDescription(''); setType('incident'); setPriority('medium'); setError(null)
    }

    const close = () => { if (!submitting) { reset(); onClose() } }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
            const ticket = await post('/tickets', { title, description, type, priority })
            reset()
            onCreated(ticket)
        } catch (err) {
            setError(err)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal open={open} onClose={close} title="New ticket">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Title">
                    <input
                        className="input" required minLength={3} maxLength={500}
                        value={title} onChange={e => setTitle(e.target.value)}
                        placeholder="Short summary of the issue or request"
                    />
                </FormField>
                <FormField label="Description">
                    <textarea
                        className="input min-h-[120px]" required minLength={10} maxLength={50000}
                        value={description} onChange={e => setDescription(e.target.value)}
                        placeholder="Describe the issue or request in detail…"
                    />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                    <FormField label="Type">
                        <select className="select" value={type} onChange={e => setType(e.target.value)}>
                            {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                    </FormField>
                    <FormField label="Priority">
                        <select className="select" value={priority} onChange={e => setPriority(e.target.value)}>
                            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </FormField>
                </div>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting}>
                        {submitting ? 'Creating…' : 'Create ticket'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
