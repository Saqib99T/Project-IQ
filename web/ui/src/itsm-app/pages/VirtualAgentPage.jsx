import { useState, useEffect, useRef } from 'react'
import { useItsmApi, useItsmResource } from '../../shared/itsm/useItsmApi'
import { useItsmTenant } from '../../shared/itsm/ItsmTenantContext'
import { LoadingSpinner, ErrorBanner, EmptyState } from '../../shared/itsm/primitives'

function formatTime(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function SessionListItem({ session, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                    ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300'
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{session.intent || 'New conversation'}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    session.status === 'active'
                        ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}>{session.status}</span>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatTime(session.created_at)} · {session.channel}</p>
        </button>
    )
}

function MessageBubble({ message }) {
    const isUser = message.role === 'user'
    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
                isUser
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : message._error
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 rounded-bl-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-sm'
            }`}>
                {message.content}
                {!isUser && message.sources?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-0.5">
                        <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Sources</p>
                        {message.sources.map((s, i) => (
                            <p key={i} className="text-xs text-slate-500 dark:text-slate-400 truncate">📄 {s.title || s.id || JSON.stringify(s)}</p>
                        ))}
                    </div>
                )}
                <p className={`mt-1 text-[10px] ${isUser ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'}`}>{formatTime(message.created_at)}</p>
            </div>
        </div>
    )
}

export default function VirtualAgentPage() {
    const { tenantId } = useItsmTenant()

    // The virtual agent is tenant-scoped — itsm-service raises "Tenant context
    // is required" with no tenant in the JWT/header. A platform-org user must
    // pick one tenant from the switcher before chatting (same exception as Reports).
    if (tenantId === null) {
        return (
            <div className="max-w-5xl">
                <EmptyState>Select a tenant from the switcher above to chat with its virtual agent.</EmptyState>
            </div>
        )
    }

    return <VirtualAgentChat />
}

function VirtualAgentChat() {
    const { get, post } = useItsmApi()
    const [activeSessionId, setActiveSessionId] = useState(null)
    const { data: sessionsData, loading, error, reload } = useItsmResource(() => get('/virtual-agent/sessions'), [get])
    const sessions = sessionsData?.items || []
    const activeSession = sessions.find(s => s.id === activeSessionId) || null

    const [messages, setMessages] = useState([])
    const [historyLoading, setHistoryLoading] = useState(false)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [starting, setStarting] = useState(false)
    const scrollRef = useRef(null)

    useEffect(() => {
        if (!activeSessionId) { setMessages([]); return }
        let cancelled = false
        setHistoryLoading(true)
        get(`/virtual-agent/sessions/${activeSessionId}/history`)
            .then(data => { if (!cancelled) setMessages(data || []) })
            .catch(() => { if (!cancelled) setMessages([]) })
            .finally(() => { if (!cancelled) setHistoryLoading(false) })
        return () => { cancelled = true }
    }, [activeSessionId, get])

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }, [messages, sending])

    async function startSession() {
        setStarting(true)
        try {
            const session = await post('/virtual-agent/sessions', { channel: 'web_widget' })
            await reload()
            setActiveSessionId(session.id)
        } finally {
            setStarting(false)
        }
    }

    async function sendMessage(e) {
        e.preventDefault()
        const text = draft.trim()
        if (!text || !activeSessionId || sending) return
        setDraft('')
        setMessages(m => [...m, { role: 'user', content: text, created_at: new Date().toISOString() }])
        setSending(true)
        try {
            const result = await post(`/virtual-agent/sessions/${activeSessionId}/messages`, { message: text })
            setMessages(m => [...m, {
                role: 'assistant',
                content: result.response,
                intent_detected: result.intent,
                sources: result.sources,
                created_at: new Date().toISOString(),
            }])
        } catch (err) {
            setMessages(m => [...m, { role: 'assistant', content: err.message || 'The virtual agent is unavailable right now.', created_at: new Date().toISOString(), _error: true }])
        } finally {
            setSending(false)
        }
    }

    async function endSession() {
        if (!activeSessionId || activeSession?.status !== 'active') return
        await post(`/virtual-agent/sessions/${activeSessionId}/close`, {})
        reload()
    }

    return (
        <div className="max-w-5xl">
            <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4 h-[calc(100vh-11rem)]">
                <div className="card p-3 flex flex-col gap-2 overflow-hidden">
                    <button onClick={startSession} disabled={starting} className="btn-primary text-xs w-full">
                        {starting ? 'Starting…' : '+ New conversation'}
                    </button>
                    <div className="flex-1 overflow-y-auto space-y-1">
                        {loading && <LoadingSpinner />}
                        {error && <ErrorBanner message={error.message} />}
                        {!loading && !error && sessions.length === 0 && (
                            <p className="text-xs text-slate-400 dark:text-slate-500 px-1 py-2">No conversations yet — start one to ask the virtual agent for help.</p>
                        )}
                        {sessions.map(s => (
                            <SessionListItem key={s.id} session={s} active={s.id === activeSessionId} onClick={() => setActiveSessionId(s.id)} />
                        ))}
                    </div>
                </div>

                <div className="card p-0 flex flex-col overflow-hidden">
                    {!activeSessionId ? (
                        <div className="flex-1 flex items-center justify-center">
                            <EmptyState>Start a new conversation or pick one from the list to chat with the virtual agent.</EmptyState>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                                <div>
                                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{activeSession?.intent || 'Conversation'}</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">{activeSession?.status === 'active' ? 'Active' : `Status: ${activeSession?.status}`}</p>
                                </div>
                                {activeSession?.status === 'active' && (
                                    <button onClick={endSession} className="btn-ghost text-xs">End conversation</button>
                                )}
                            </div>
                            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
                                {historyLoading && <LoadingSpinner />}
                                {!historyLoading && messages.length === 0 && (
                                    <EmptyState>Say hello to get started — ask about an incident, a request, or how to do something.</EmptyState>
                                )}
                                {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
                                {sending && (
                                    <div className="flex justify-start">
                                        <div className="rounded-2xl rounded-bl-sm bg-slate-100 dark:bg-slate-800 px-4 py-2 text-sm text-slate-400 dark:text-slate-500">
                                            Thinking…
                                        </div>
                                    </div>
                                )}
                            </div>
                            <form onSubmit={sendMessage} className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 dark:border-slate-800">
                                <input
                                    type="text"
                                    value={draft}
                                    onChange={e => setDraft(e.target.value)}
                                    placeholder={activeSession?.status === 'active' ? 'Type a message…' : 'This conversation is closed'}
                                    disabled={activeSession?.status !== 'active' || sending}
                                    className="input text-sm flex-1"
                                />
                                <button type="submit" disabled={!draft.trim() || activeSession?.status !== 'active' || sending} className="btn-primary text-sm">
                                    Send
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
