import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'

const NOTIFICATION_TYPES = [
    { value: 'ticket_assigned', label: 'Ticket assigned' },
    { value: 'ticket_updated', label: 'Ticket updated' },
    { value: 'ticket_commented', label: 'Ticket commented' },
    { value: 'ticket_sla_warning', label: 'Ticket SLA warning' },
    { value: 'ticket_sla_breached', label: 'Ticket SLA breached' },
    { value: 'asset_maintenance_due', label: 'Asset maintenance due' },
    { value: 'kb_article_published', label: 'KB article published' },
    { value: 'mention', label: 'Mention' },
    { value: 'system', label: 'System' },
]

const ENTITY_ROUTES = { ticket: '/tickets', asset: '/assets', kb_article: '/kb' }

function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

function entityLink(notification) {
    const base = ENTITY_ROUTES[notification.entity_type]
    if (!base || !notification.entity_id) return null
    return `${base}/${notification.entity_id}`
}

function NotificationsInbox() {
    const { get, patch, remove } = useItsmApi()
    const [unreadOnly, setUnreadOnly] = useState(false)
    const [busyId, setBusyId] = useState(null)
    const [error, setError] = useState(null)

    const { data, loading, reload } = useItsmResource(
        () => get('/notifications', { unread: unreadOnly, limit: 50 }),
        [get, unreadOnly]
    )
    const notifications = data?.items || []

    const markRead = async (ids, all = false) => {
        setError(null)
        try { await patch('/notifications/mark-read', all ? { all: true } : { ids }); reload() }
        catch (err) { setError(err) }
    }
    const del = async (id) => {
        setBusyId(id); setError(null)
        try { await remove(`/notifications/${id}`); reload() }
        catch (err) { setError(err) } finally { setBusyId(null) }
    }

    const unreadCount = notifications.filter(n => !n.is_read).length

    return (
        <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />
                    Unread only
                </label>
                <div className="flex items-center gap-2">
                    <button onClick={reload} className="btn-ghost text-xs py-1.5">↻ Refresh</button>
                    <button onClick={() => markRead(null, true)} disabled={unreadCount === 0} className="btn-ghost text-xs py-1.5">Mark all read</button>
                </div>
            </div>

            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}
            {!loading && notifications.length === 0 && <EmptyState>No notifications{unreadOnly ? ' to review' : ''}.</EmptyState>}

            {notifications.length > 0 && (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.map(n => {
                        const link = entityLink(n)
                        const content = (
                            <>
                                <p className="text-sm text-slate-800 dark:text-slate-200">{n.title}</p>
                                {n.body && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{n.body}</p>}
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatDate(n.created_at)}</p>
                            </>
                        )
                        return (
                            <li key={n.id} className={`flex items-start justify-between gap-3 py-2.5 text-sm ${!n.is_read ? 'bg-blue-50/50 dark:bg-blue-500/5 -mx-2 px-2 rounded' : ''}`}>
                                <div className="min-w-0 flex items-start gap-2">
                                    {!n.is_read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                                    <div className="min-w-0">
                                        {link ? <Link to={link} className="hover:underline" onClick={() => !n.is_read && markRead([n.id])}>{content}</Link> : content}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {!n.is_read && <button onClick={() => markRead([n.id])} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Mark read</button>}
                                    <button onClick={() => del(n.id)} disabled={busyId === n.id} className="text-xs text-red-600 dark:text-red-400 hover:underline">
                                        {busyId === n.id ? '…' : 'Delete'}
                                    </button>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}

function NotificationPreferences() {
    const { get, patch } = useItsmApi()
    const [busyType, setBusyType] = useState(null)
    const [error, setError] = useState(null)

    const { data: prefs, loading, reload } = useItsmResource(() => get('/notifications/preferences'), [get])
    const prefByType = new Map((prefs || []).map(p => [p.type, p]))

    const update = async (type, field, value) => {
        const current = prefByType.get(type) || { email_enabled: true, in_app_enabled: true }
        setBusyType(type); setError(null)
        try {
            await patch('/notifications/preferences', { type, ...current, [field]: value })
            reload()
        } catch (err) { setError(err) } finally { setBusyType(null) }
    }

    return (
        <div className="space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Notification preferences</h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">Types without an explicit preference default to both email and in-app enabled.</p>

            {error && <ErrorBanner message={error.message} />}
            {loading && <LoadingSpinner />}

            {!loading && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-slate-400 dark:text-slate-500 uppercase tracking-wide text-left">
                            <th className="font-medium pb-2">Type</th>
                            <th className="font-medium pb-2 text-center w-20">Email</th>
                            <th className="font-medium pb-2 text-center w-20">In-app</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {NOTIFICATION_TYPES.map(({ value, label }) => {
                            const pref = prefByType.get(value) || { email_enabled: true, in_app_enabled: true }
                            const busy = busyType === value
                            return (
                                <tr key={value}>
                                    <td className="py-2 text-slate-700 dark:text-slate-300">{label}</td>
                                    <td className="py-2 text-center">
                                        <input type="checkbox" disabled={busy} checked={pref.email_enabled} onChange={e => update(value, 'email_enabled', e.target.checked)} />
                                    </td>
                                    <td className="py-2 text-center">
                                        <input type="checkbox" disabled={busy} checked={pref.in_app_enabled} onChange={e => update(value, 'in_app_enabled', e.target.checked)} />
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
        </div>
    )
}

export default function NotificationsPage() {
    const [tab, setTab] = useState('inbox')

    return (
        <div className="max-w-2xl space-y-4">
            <div className="flex items-center gap-1.5">
                {[{ id: 'inbox', label: 'Inbox' }, { id: 'preferences', label: 'Preferences' }].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            tab === t.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div className="card p-6">
                {tab === 'inbox' ? <NotificationsInbox /> : <NotificationPreferences />}
            </div>
        </div>
    )
}
