import { useMemo, useState } from 'react'
import { useNavigate, useParams, useOutletContext } from 'react-router-dom'
import {
    ArrowLeft, ArrowUpCircle, Trash2, RefreshCw, MessageSquare, History,
    Paperclip, MonitorSmartphone, Eye, Tag, Video, BookOpen,
} from 'lucide-react'
import {
    useItsmApi, useItsmResource, useTenantDirectory, useUserDirectory,
    triggerKbCurationFromTicket,
} from '../../shared/itsm/useItsmApi'
import { useItsmTenant, ItsmTenantScope } from '../../shared/itsm/ItsmTenantContext'
import { StatusBadge, PriorityBadge, TenantBadge, LoadingSpinner, ErrorBanner } from '../../shared/itsm/primitives'
import { Button, IconButton, Badge, Breadcrumb, Tabs, useConfirm } from '../../shared/itsm/ui'
import TicketEditPanel from '../../shared/itsm/TicketEditPanel'
import TicketSlaPanel from '../../shared/itsm/TicketSlaPanel'
import { useItsmPermissions } from '../../shared/itsm/useItsmPermissions'
import CommentsSection from '../../shared/itsm/CommentsSection'
import WatchersSection from '../components/WatchersSection'
import AttachmentsSection from '../components/AttachmentsSection'
import EscalateModal from '../components/EscalateModal'
import TicketTagsSection from '../components/TicketTagsSection'
import LinkedAssetsSection from '../components/LinkedAssetsSection'
import TicketHistorySection from '../components/TicketHistorySection'
import AiAssistSection from '../components/AiAssistSection'
import RecordingsSection from '../components/RecordingsSection'

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

function TitleDescriptionEditor({ ticket, onSaved }) {
    const { patch } = useItsmApi()
    const [editing, setEditing] = useState(false)
    const [title, setTitle] = useState(ticket.title)
    const [description, setDescription] = useState(ticket.description)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState(null)

    const startEdit = () => { setTitle(ticket.title); setDescription(ticket.description); setEditing(true) }

    const save = async () => {
        setSaving(true); setError(null)
        try {
            const updated = await patch(`/tickets/${ticket.id}`, { title, description })
            onSaved(updated)
            setEditing(false)
        } catch (err) { setError(err) } finally { setSaving(false) }
    }

    if (!editing) {
        return (
            <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{ticket.title}</h2>
                    <button onClick={startEdit} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0">Edit</button>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{ticket.description || 'No description provided.'}</p>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <input className="input font-semibold" required minLength={3} maxLength={500} value={title} onChange={e => setTitle(e.target.value)} />
            <textarea className="input min-h-[100px] text-sm" required minLength={10} value={description} onChange={e => setDescription(e.target.value)} />
            {error && <ErrorBanner message={error.message} />}
            <div className="flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            </div>
        </div>
    )
}

// Drafts a KB article from this ticket right now, instead of waiting for the
// nightly auto_draft_kb_from_tickets batch (03:30 UTC). Only shown once the
// ticket is resolved — the backend rejects earlier states. Idempotent: a
// second click (or an earlier nightly-batch draft) just returns the existing
// draft rather than erroring or duplicating it.
function KbDraftButton({ ticketId }) {
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

function MetaRow({ label, children }) {
    return (
        <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
            <span className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide shrink-0">{label}</span>
            <span className="text-sm text-slate-700 dark:text-slate-300 text-right min-w-0 truncate">{children}</span>
        </div>
    )
}

export default function TicketDetailPage() {
    const { ticketId } = useParams()
    const navigate = useNavigate()
    const { get } = useItsmApi()
    const { isManager: canManage } = useItsmPermissions()
    const { tenantId } = useItsmTenant()
    const { isPlatformOrg } = useOutletContext() || {}
    const confirm = useConfirm()
    const tenantNames = useTenantDirectory(isPlatformOrg && tenantId === null)
    const userNames = useUserDirectory()
    const [showEscalate, setShowEscalate] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState(null)
    const [tab, setTab] = useState('comments')

    const { data: ticket, loading, error, reload } = useItsmResource(
        () => get(`/tickets/${ticketId}`),
        [get, ticketId]
    )
    // Once the ticket is loaded, scope mutations (delete) to its own tenant so
    // platform "All tenants" users aren't rejected with "Tenant context required".
    const { remove } = useItsmApi(ticket?.tenant_id)

    const { data: catData } = useItsmResource(() => get('/tenant/ticket-categories').catch(() => []), [get])
    const catName = useMemo(() => Object.fromEntries((catData || []).map(c => [c.id, c.name])), [catData])

    const resolveUser = (id) => id ? (userNames[id] || `${id.slice(0, 8)}…`) : '—'

    const deleteTicket = async () => {
        const ok = await confirm({ title: 'Delete ticket?', message: `${ticket.ticket_number} will be permanently deleted.`, danger: true, confirmLabel: 'Delete' })
        if (!ok) return
        setDeleting(true); setDeleteError(null)
        try {
            await remove(`/tickets/${ticketId}`)
            navigate('/')
        } catch (err) { setDeleteError(err); setDeleting(false) }
    }

    const TABS = [
        { id: 'comments', label: 'Comments', icon: MessageSquare },
        { id: 'history', label: 'History', icon: History },
        { id: 'attachments', label: 'Attachments', icon: Paperclip },
        { id: 'recordings', label: 'Recordings', icon: Video },
        { id: 'assets', label: 'Linked Assets', icon: MonitorSmartphone },
        { id: 'watchers', label: 'Watchers', icon: Eye },
        { id: 'tags', label: 'Tags', icon: Tag },
    ]

    return (
        <ItsmTenantScope tenantId={ticket?.tenant_id}>
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <Breadcrumb items={[{ label: 'Tickets', onClick: () => navigate('/') }, { label: ticket?.ticket_number || 'Ticket' }]} />
                {ticket && (
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" icon={ArrowUpCircle} onClick={() => setShowEscalate(true)}>Escalate</Button>
                        <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={deleteTicket} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
                    </div>
                )}
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorBanner message={error.message} />}
            {deleteError && <ErrorBanner message={deleteError.message} />}

            {!loading && !error && ticket && (
                <div className="flex gap-4 items-start flex-col lg:flex-row">
                    {/* Main column */}
                    <div className="flex-1 min-w-0 space-y-4 w-full">
                        <div className="card p-6 space-y-4">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono text-slate-400 dark:text-slate-500">{ticket.ticket_number || ticket.id}</span>
                                {ticket.category_id && catName[ticket.category_id] && <Badge tone="gray">{catName[ticket.category_id]}</Badge>}
                                {isPlatformOrg && tenantId === null && <TenantBadge tenantId={ticket.tenant_id} tenantNames={tenantNames} />}
                            </div>
                            <TitleDescriptionEditor ticket={ticket} onSaved={reload} />
                        </div>

                        <AiAssistSection ticketId={ticket.id} />

                        <div className="card p-6 space-y-4">
                            <Tabs tabs={TABS} value={tab} onChange={setTab} />
                            <div className="pt-1">
                                {tab === 'comments' && <CommentsSection ticketId={ticket.id} />}
                                {tab === 'history' && <TicketHistorySection ticketId={ticket.id} />}
                                {tab === 'attachments' && <AttachmentsSection ticketId={ticket.id} />}
                                {tab === 'recordings' && <RecordingsSection ticketId={ticket.id} />}
                                {tab === 'assets' && <LinkedAssetsSection ticketId={ticket.id} />}
                                {tab === 'watchers' && <WatchersSection ticketId={ticket.id} />}
                                {tab === 'tags' && <TicketTagsSection ticketId={ticket.id} />}
                            </div>
                        </div>
                    </div>

                    {/* Sticky summary rail */}
                    <aside className="w-full lg:w-80 shrink-0 space-y-4 lg:sticky lg:top-0">
                        <div className="card p-5 space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Details</h3>
                                <IconButton icon={RefreshCw} label="Refresh" size="sm" onClick={reload} />
                            </div>
                            <div className="flex items-center gap-2">
                                <StatusBadge status={ticket.status} />
                                <PriorityBadge priority={ticket.priority} />
                            </div>
                            <div>
                                <MetaRow label="Type">{(ticket.type || '—').replace(/_/g, ' ')}</MetaRow>
                                <MetaRow label="Product">{ticket.product_name || '—'}</MetaRow>
                                <MetaRow label="Requester"><span title={ticket.requester_id}>{ticket.requester_name || resolveUser(ticket.requester_id)}</span></MetaRow>
                                <MetaRow label="Assignee"><span title={ticket.assignee_id}>{ticket.assignee_name || resolveUser(ticket.assignee_id)}</span></MetaRow>
                                <MetaRow label="SLA">
                                    <span className={ticket.sla_breached ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                                        {ticket.sla_breached ? 'Breached' : 'Within SLA'}
                                    </span>
                                </MetaRow>
                                <MetaRow label="SLA due">{formatDate(ticket.sla_resolve_due)}</MetaRow>
                                <MetaRow label="Created">{formatDate(ticket.created_at)}</MetaRow>
                                <MetaRow label="Updated">{formatDate(ticket.updated_at)}</MetaRow>
                            </div>
                        </div>

                        <div className="card p-5">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Manage</h3>
                            <TicketEditPanel ticket={ticket} onUpdated={reload} />
                        </div>

                        {ticket.status === 'resolved' && (
                            <div className="card p-5">
                                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">Knowledge Base</h3>
                                <KbDraftButton ticketId={ticket.id} />
                            </div>
                        )}

                        <TicketSlaPanel ticketId={ticket.id} canManage={canManage} />
                    </aside>
                </div>
            )}

            {ticket && (
                <EscalateModal
                    open={showEscalate}
                    onClose={() => setShowEscalate(false)}
                    ticketId={ticket.id}
                    onEscalated={() => { setShowEscalate(false); reload() }}
                />
            )}
        </div>
        </ItsmTenantScope>
    )
}
