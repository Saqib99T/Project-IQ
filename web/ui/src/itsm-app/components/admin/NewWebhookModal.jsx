import { useState } from 'react'
import { useItsmApi } from '../../../shared/itsm/useItsmApi'
import { Modal, FormField, ErrorBanner } from '../../../shared/itsm/primitives'

const EVENTS = ['ticket.created', 'ticket.updated', 'ticket.resolved', 'ticket.closed', 'asset.created', 'asset.updated']

export default function NewWebhookModal({ open, onClose, onCreated }) {
    const { post } = useItsmApi()
    const [name, setName] = useState('')
    const [url, setUrl] = useState('')
    const [secret, setSecret] = useState('')
    const [events, setEvents] = useState([])
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState(null)

    const reset = () => { setName(''); setUrl(''); setSecret(''); setEvents([]); setError(null) }
    const close = () => { if (!submitting) { reset(); onClose() } }

    const toggleEvent = (ev) => {
        setEvents(prev => prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev])
    }

    const submit = async (e) => {
        e.preventDefault()
        setSubmitting(true); setError(null)
        try {
            const endpoint = await post('/webhooks-config/endpoints', { name, url, secret, events })
            reset()
            onCreated(endpoint)
        } catch (err) { setError(err) } finally { setSubmitting(false) }
    }

    return (
        <Modal open={open} onClose={close} title="New webhook endpoint" maxWidth="max-w-xl">
            <form onSubmit={submit} className="space-y-4">
                <FormField label="Name">
                    <input className="input" required maxLength={255} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Slack notifications" />
                </FormField>
                <FormField label="URL">
                    <input className="input" required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://hooks.example.com/…" />
                </FormField>
                <FormField label="Signing secret (min. 16 chars)">
                    <input className="input font-mono text-sm" required minLength={16} value={secret} onChange={e => setSecret(e.target.value)} placeholder="Used to sign HMAC payloads" />
                </FormField>
                <FormField label="Events">
                    <div className="grid grid-cols-2 gap-1.5">
                        {EVENTS.map(ev => (
                            <label key={ev} className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
                                {ev}
                            </label>
                        ))}
                    </div>
                </FormField>

                {error && <ErrorBanner message={error.message} />}

                <div className="flex items-center justify-end gap-2 pt-2">
                    <button type="button" onClick={close} className="btn-ghost text-sm" disabled={submitting}>Cancel</button>
                    <button type="submit" className="btn-primary text-sm" disabled={submitting || !name.trim() || !url.trim() || secret.length < 16}>
                        {submitting ? 'Creating…' : 'Create endpoint'}
                    </button>
                </div>
            </form>
        </Modal>
    )
}
