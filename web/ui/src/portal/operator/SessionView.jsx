import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { usePortalSocket } from './usePortalSocket'

const TRIGGER_LABEL = { user_request: 'User Request', low_confidence: 'Low Confidence', frustration: 'Frustration' }

function waitingLabel(secs) {
    if (secs == null) return '—'
    const m = Math.floor(secs / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
}

function MessageBubble({ msg }) {
    const isOperator = msg.role === 'operator' || msg.sender === 'operator'
    const isBot      = msg.role === 'bot' || msg.sender === 'bot'
    return (
        <div className={`flex ${isOperator ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                isOperator
                    ? 'bg-primary text-primary-fg rounded-br-sm'
                    : isBot
                        ? 'bg-surface2 text-fgmuted rounded-bl-sm'
                        : 'bg-surface border border-bordc text-fg rounded-bl-sm'
            }`}>
                {!isOperator && (
                    <p className="text-xs font-semibold mb-0.5 opacity-60">{isBot ? 'Bot' : 'User'}</p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                <p className={`text-xs mt-1 opacity-60 ${isOperator ? 'text-right' : ''}`}>
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </p>
            </div>
        </div>
    )
}

export default function SessionView() {
    const { conversationId } = useParams()
    const navigate           = useNavigate()
    const { call }           = useApi()

    const [messages, setMessages]     = useState([])
    const [meta, setMeta]             = useState(null)
    const [loading, setLoading]       = useState(true)
    const [error, setError]           = useState(null)
    const [input, setInput]           = useState('')
    const [sending, setSending]       = useState(false)
    const [resolving, setResolving]   = useState(false)
    const [releasing, setReleasing]   = useState(false)
    const [userTyping, setUserTyping] = useState(false)
    const [resolved, setResolved]     = useState(false)

    const [drafting, setDrafting]     = useState(false)
    const [note, setNote]             = useState('')
    const [history, setHistory]       = useState(null)
    const [showTransfer, setShowTransfer] = useState(false)
    const [operators, setOperators]   = useState([])
    const [transferring, setTransferring] = useState(false)

    const bottomRef   = useRef(null)
    const typingTimer = useRef(null)

    const noteKey = `op-note-${conversationId}`

    const fetchConversation = useCallback(async () => {
        try {
            const data = await call(`/portal/api/conversation/${conversationId}`)
            setMessages(data.messages || [])
            setMeta(data.meta || null)
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, conversationId])

    useEffect(() => { fetchConversation() }, [fetchConversation])

    // Restore client-side private note for this session
    useEffect(() => {
        setNote(sessionStorage.getItem(noteKey) || '')
    }, [noteKey])

    // Load interaction history once we know the sender
    useEffect(() => {
        const sid = meta?.sender_id
        if (!sid) return
        call(`/portal/api/user-history/${encodeURIComponent(sid)}?limit=11`)
            .then(d => setHistory(d.history || []))
            .catch(() => setHistory([]))
    }, [meta?.sender_id, call])

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const { emit } = usePortalSocket({
        onEvent: (evt, data) => {
            if (!data) return
            if ((evt === 'operator_message' || evt === 'live_message') &&
                String(data.conversation_id) === String(conversationId)) {
                setMessages(prev => {
                    const role = data.role || data.sender || 'operator'
                    if (role === 'operator' && prev.some(m => m._optimistic && m.text === data.text)) {
                        return prev.map(m => (m._optimistic && m.text === data.text ? { ...m, _optimistic: false } : m))
                    }
                    return [...prev, { role, text: data.text, timestamp: data.timestamp || new Date().toISOString() }]
                })
            }
            if (evt === 'user_message' && String(data.conversation_id) === String(conversationId)) {
                setMessages(prev => [...prev, { role: 'user', text: data.text, timestamp: data.timestamp || new Date().toISOString() }])
            }
            if (evt === 'user_typing' && String(data.conversation_id) === String(conversationId)) {
                setUserTyping(data.typing)
                clearTimeout(typingTimer.current)
                if (data.typing) typingTimer.current = setTimeout(() => setUserTyping(false), 4000)
            }
            if (evt === 'user_left' && String(data.conversation_id) === String(conversationId)) {
                setMessages(prev => [...prev, { role: 'system', text: 'The user has left the conversation.', timestamp: new Date().toISOString() }])
            }
            if (evt === 'handoff_resolved' && String(data.conversation_id) === String(conversationId)) {
                setResolved(true)
            }
        },
    })

    const sendMessage = async () => {
        const text = input.trim()
        if (!text || sending || resolved) return
        setSending(true)
        setMessages(prev => [...prev, { role: 'operator', text, timestamp: new Date().toISOString(), _optimistic: true }])
        setInput('')
        try {
            await call('/portal/api/chat/send', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, text }),
            })
        } catch (e) {
            setMessages(prev => prev.filter(m => !(m._optimistic && m.text === text)))
            alert(`Send failed: ${e.message}`)
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
    }

    const handleTyping = (e) => {
        setInput(e.target.value)
        if (meta?.sender_id) {
            emit('operator_typing', { conversation_id: conversationId, sender_id: meta.sender_id, typing: true })
        }
    }

    const suggestReply = async () => {
        setDrafting(true)
        try {
            const d = await call('/portal/api/ai-draft', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId }),
            })
            if (d.draft) setInput(prev => (prev ? `${prev} ${d.draft}` : d.draft))
            else if (d.no_message) alert('No user message to draft a reply for yet.')
            else alert('No suggestion available for this message.')
        } catch (e) {
            alert(`Suggest reply failed: ${e.message}`)
        } finally {
            setDrafting(false)
        }
    }

    const saveNote = (v) => {
        setNote(v)
        sessionStorage.setItem(noteKey, v)
    }

    const handleResolve = async () => {
        if (!window.confirm('Mark this conversation as resolved?')) return
        setResolving(true)
        try {
            await call('/portal/api/queue/resolve', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, closing_note: note }),
            })
            sessionStorage.removeItem(noteKey)
            setResolved(true)
        } catch (e) {
            alert(`Resolve failed: ${e.message}`)
        } finally {
            setResolving(false)
        }
    }

    const handleRelease = async () => {
        if (!window.confirm('Release this session back to the queue?')) return
        setReleasing(true)
        try {
            await call('/portal/api/queue/release', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, note }),
            })
            navigate('/operator/sessions')
        } catch (e) {
            alert(`Release failed: ${e.message}`)
            setReleasing(false)
        }
    }

    const openTransfer = async () => {
        setShowTransfer(true)
        try {
            const d = await call('/portal/api/operators/online')
            setOperators(d.operators || [])
        } catch {
            setOperators([])
        }
    }

    const doTransfer = async (targetId) => {
        setTransferring(true)
        try {
            await call('/portal/api/queue/transfer', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, target_operator_id: targetId }),
            })
            setShowTransfer(false)
            navigate('/operator/sessions')
        } catch (e) {
            alert(`Transfer failed: ${e.message}`)
        } finally {
            setTransferring(false)
        }
    }

    const senderName = meta?.sender_id || conversationId

    return (
        <div className="flex h-full -m-6">
            {/* ── Chat column ─────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                <div className="flex items-center gap-3 px-6 py-3 bg-surface border-b border-bordc shrink-0">
                    <button onClick={() => navigate('/operator/sessions')} className="text-fgsubtle hover:text-fgmuted transition-colors text-sm">← Back</button>
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-fg text-sm truncate">{senderName}</p>
                        {meta?.app_id && <p className="text-xs text-fgmuted">{meta.app_id}</p>}
                    </div>
                    {resolved && <span className="badge bg-success/15 text-success">Resolved</span>}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-bg">
                    {loading && (
                        <div className="flex justify-center py-12">
                            <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                    {error && <div className="card p-4 bg-danger/10 border-danger/30 text-danger text-sm">{error}</div>}
                    {messages.map((msg, i) => (
                        msg.role === 'system'
                            ? <p key={i} className="text-center text-xs text-fgsubtle py-1">{msg.text}</p>
                            : <MessageBubble key={i} msg={msg} />
                    ))}
                    {userTyping && (
                        <div className="flex justify-start">
                            <div className="bg-surface border border-bordc rounded-2xl rounded-bl-sm px-4 py-2.5">
                                <span className="text-xs text-fgsubtle italic">User is typing…</span>
                            </div>
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>

                <div className="px-6 py-3 bg-surface border-t border-bordc shrink-0">
                    {resolved ? (
                        <p className="text-center text-sm text-fgsubtle py-2">This session is resolved.</p>
                    ) : (
                        <>
                            <div className="flex items-end gap-3">
                                <textarea
                                    value={input}
                                    onChange={handleTyping}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Type a message… (Enter to send)"
                                    rows={2}
                                    className="flex-1 resize-none rounded-xl border border-bordc bg-bg text-fg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                                <button onClick={sendMessage} disabled={sending || !input.trim()} className="btn-primary px-5 py-2.5 text-sm shrink-0 disabled:opacity-50">
                                    {sending ? '…' : 'Send'}
                                </button>
                            </div>
                            <button onClick={suggestReply} disabled={drafting} className="mt-1.5 text-xs text-primary hover:underline disabled:opacity-50">
                                {drafting ? '✨ Thinking…' : '✨ Suggest reply'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Context & Info panel ────────────────────────────────── */}
            <aside className="w-80 shrink-0 border-l border-bordc bg-surface overflow-y-auto">
                <div className="p-5 space-y-6">
                    <section>
                        <h3 className="text-xs font-semibold tracking-wider text-fgsubtle uppercase mb-3">Context &amp; Info</h3>
                        <div className="card p-4 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold text-sm text-fg break-all">{senderName}</p>
                                {meta?.priority != null && (
                                    <span className="badge bg-amber-100 text-amber-700 shrink-0">P{meta.priority}</span>
                                )}
                            </div>
                            <div className="space-y-1.5 text-sm text-fgmuted pt-1">
                                {meta?.product_id && <p>🗂️ {meta.product_id}</p>}
                                {meta?.trigger_reason && <p>⚡ {TRIGGER_LABEL[meta.trigger_reason] || meta.trigger_reason}</p>}
                                {meta?.waiting_secs != null && <p>⏱️ Waiting {waitingLabel(meta.waiting_secs)}</p>}
                                {meta?.app_id && <p>💬 {meta.app_id}</p>}
                                {meta?.user_org_id && <p>🏢 {meta.user_org_id}</p>}
                            </div>
                        </div>
                    </section>

                    {meta?.ai_summary && (
                        <section>
                            <h3 className="text-xs font-semibold tracking-wider text-fgsubtle uppercase mb-3">AI Summary</h3>
                            <div className="card p-4 bg-primary/5 border-primary/20">
                                <p className="text-sm text-fgmuted whitespace-pre-wrap">{meta.ai_summary}</p>
                            </div>
                        </section>
                    )}

                    <section>
                        <h3 className="text-xs font-semibold tracking-wider text-fgsubtle uppercase mb-3">Notes</h3>
                        <textarea
                            value={note}
                            onChange={e => saveNote(e.target.value)}
                            placeholder="Private notes (not sent to user)…"
                            rows={3}
                            className="w-full resize-none rounded-xl border border-bordc bg-bg text-fg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </section>

                    {!resolved && (
                        <section className="space-y-2">
                            <div className="flex gap-2">
                                <button onClick={handleResolve} disabled={resolving} className="btn-primary flex-1 text-sm py-2 disabled:opacity-50">
                                    {resolving ? 'Resolving…' : '✓ Resolve'}
                                </button>
                                <button onClick={handleRelease} disabled={releasing} className="btn-ghost flex-1 text-sm py-2 border border-bordc disabled:opacity-50">
                                    {releasing ? 'Releasing…' : '↩ Release'}
                                </button>
                            </div>
                            <button onClick={openTransfer} className="w-full btn-ghost text-sm py-2 border border-bordc">
                                ⇄ Transfer to Operator
                            </button>
                        </section>
                    )}

                    <section>
                        <h3 className="text-xs font-semibold tracking-wider text-fgsubtle uppercase mb-3">Interaction History</h3>
                        {history == null ? (
                            <p className="text-sm text-fgsubtle">Loading…</p>
                        ) : history.length === 0 ? (
                            <p className="text-sm text-fgsubtle">No previous sessions</p>
                        ) : (
                            <div className="space-y-2">
                                {history.map(h => (
                                    <div key={h.queue_id} className="card p-3 text-xs space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium text-fg">{h.app_id}</span>
                                            <span className={`badge ${h.handoff_status === 'resolved' ? 'bg-success/15 text-success' : 'bg-bg text-fgmuted'}`}>
                                                {h.handoff_status}
                                            </span>
                                        </div>
                                        {h.first_user_msg && <p className="text-fgmuted truncate">“{h.first_user_msg}”</p>}
                                        <p className="text-fgsubtle">{h.queued_at ? new Date(h.queued_at).toLocaleString() : ''}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </aside>

            {/* ── Transfer modal ──────────────────────────────────────── */}
            {showTransfer && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowTransfer(false)}>
                    <div className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={e => e.stopPropagation()}>
                        <h3 className="font-semibold text-fg">Transfer to operator</h3>
                        {operators.length === 0 ? (
                            <p className="text-sm text-fgmuted">No other operators are online.</p>
                        ) : (
                            <div className="space-y-2 max-h-72 overflow-y-auto">
                                {operators.map(o => (
                                    <button
                                        key={o.id}
                                        disabled={transferring}
                                        onClick={() => doTransfer(o.id)}
                                        className="w-full flex items-center justify-between gap-2 card p-3 text-left hover:border-primary disabled:opacity-50"
                                    >
                                        <span className="text-sm text-fg">{o.display_name}</span>
                                        <span className="text-xs text-fgmuted">{o.current_load}/{o.max_concurrent} · {o.status}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <button onClick={() => setShowTransfer(false)} className="w-full btn-ghost text-sm border border-bordc">Cancel</button>
                    </div>
                </div>
            )}
        </div>
    )
}
