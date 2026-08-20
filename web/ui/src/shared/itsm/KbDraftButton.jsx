import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useItsmApi, triggerKbCurationFromTicket } from './useItsmApi'
import { ErrorBanner } from './primitives'
import { Button } from './ui'

// Drafts a KB article from a resolved ticket right now, instead of waiting
// for the nightly auto_draft_kb_from_tickets batch (03:30 UTC). Shown by
// callers only once the ticket is resolved — the backend rejects earlier
// states. Idempotent: a second click (or an earlier nightly-batch draft)
// just returns the existing draft rather than erroring or duplicating it.
//
// Shared by both ticket-detail pages (itsm-app's TicketDetailPage and the
// portal's ItsmTicketDetailPage) — keep it here rather than duplicating so
// they can't drift out of sync again.
export default function KbDraftButton({ ticketId }) {
    const { post } = useItsmApi()
    const [state, setState] = useState('idle') // idle | working | done | error
    const [result, setResult] = useState(null)
    const [error, setError] = useState(null)

    const trigger = async () => {
        setState('working'); setError(null)
        try {
            const draft = await triggerKbCurationFromTicket(post, ticketId)
            setResult(draft)
            setState('done')
        } catch (err) {
            setError(err)
            setState('error')
        }
    }

    if (state === 'done' && result) {
        const already = result.curation_source?.state && result.curation_source.state !== 'running'
        return (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {already ? 'Already drafted' : 'KB draft created'} — see Knowledge Base → Pending Review.
            </p>
        )
    }

    return (
        <div className="space-y-1">
            <Button size="sm" variant="secondary" icon={BookOpen} onClick={trigger} disabled={state === 'working'}>
                {state === 'working' ? 'Drafting…' : 'Draft KB Article'}
            </Button>
            {state === 'error' && <ErrorBanner message={error.message} />}
        </div>
    )
}
