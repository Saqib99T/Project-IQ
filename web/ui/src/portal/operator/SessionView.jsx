import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { usePortalSocket } from './usePortalSocket'
import { productLabel } from './productLabels'

const TRIGGER_LABEL = { user_request: 'User Request', low_confidence: 'Low Confidence', frustration: 'Frustration' }

// Map Rasa /intent payloads to friendly labels so the transcript reads naturally.
const PAYLOAD_MAP = {
    '/create_ticket': 'Create a ticket', '/list_tickets': 'List my tickets',
    '/check_status': 'Check ticket status', '/help': 'Help',
    '/request_human_agent': 'Talk to a human agent', '/confirm_gdpr_consent': 'I agree to the terms',
    '/deny_gdpr_consent': 'I do not agree', '/login': 'Login', '/logout': 'Logout',
    '/greet': 'Hello', '/hi': 'Hello', '/affirm': 'Yes', '/deny': 'No', '/restart': 'Start over',
    '/out_of_scope': 'Other', '/ask_knowledge': 'Search Knowledge Base',
    '/submit_ticket_form': 'Ticket submitted', '/show_ticket_graph': 'View ticket graph',
    '/show_chart': 'View chart', '/accept_ticket_fallback': 'Create a support ticket',
    '/confirm_handoff': 'Wait in queue', '/cancel_handoff': 'Cancel handoff',
    '/kb_not_helpful': 'Not helpful', '/kb_show_full_answer': 'Show full answer',
    '/kb_show_full_article': 'Show full article', '/feedback_positive': 'Positive feedback',
    '/feedback_negative': 'Negative feedback', '/inform': 'Option selected',
    '/update_ticket': 'Update ticket', '/stop': 'Cancel', '/verify_resolution': 'Mark as resolved',
    '/list_attachments': 'List attachments', '/upload_file': 'Upload file',
    '/rating_1': 'Rating: 1★', '/rating_2': 'Rating: 2★', '/rating_3': 'Rating: 3★',
    '/rating_4': 'Rating: 4★', '/rating_5': 'Rating: 5★',
}
function fmtPayload(text) {
    if (!text || !text.startsWith('/')) return text
    const key = text.split('{')[0].trim().toLowerCase()
    return PAYLOAD_MAP[key] || (text.slice(1).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()))
}

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
    const isUser     = !isOperator && !isBot
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
                <p className="whitespace-pre-wrap break-words">{isUser ? fmtPayload(msg.text) : msg.text}</p>
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
    const [endedReason, setEndedReason] = useState(null)   // resolved | abandoned | closed
    const [histModal, setHistModal]   = useState(null)     // { title, sub, messages, loading }
    const [canned, setCanned]         = useState(null)     // null = not loaded yet
    const [showCanned, setShowCanned] = useState(false)

    const bottomRef   = useRef(null)
    const typingTimer = useRef(null)

    const noteKey = `op-note-${conversationId}`

    // A session is read-only once it has left the 'assigned'/'waiting' lifecycle.
    const ENDED_STATES = ['resolved', 'abandoned', 'closed', 'timeout']
    const ended = resolved || ENDED_STATES.includes(meta?.status)
    const ENDED_LABEL = {
        resolved: 'Session closed', abandoned: 'User left the queue',
        closed: 'Session closed', timeout: 'Session timed out',
    }
    const endedLabel = ENDED_LABEL[endedReason] || ENDED_LABEL[meta?.status] || 'Session ended'

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

    // Re-pull authoritative messages whenever this tab regains focus/visibility.
    // The socket can miss user_message events while the operator's tab is
    // backgrounded (browser suspends the WebSocket); re-fetching the DB truth on
    // return guarantees nothing typed by the user is silently dropped.
    useEffect(() => {
        const onVisible = () => { if (document.visibilityState === 'visible') fetchConversation() }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', fetchConversation)
        return () => {
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', fetchConversation)
        }
    }, [fetchConversation])

    // Restore client-side private note for this session
    useEffect(() => {
        setNote(sessionStorage.getItem(noteKey) || '')
    }, [noteKey])

    // Load interaction history once we know the sender — PREVIOUS sessions only
    // (exclude the one currently open).
    useEffect(() => {
        const sid = meta?.sender_id
        if (!sid) return
        call(`/portal/api/user-history/${encodeURIComponent(sid)}?limit=11`)
            .then(d => setHistory((d.history || []).filter(
                h => String(h.conversation_id) !== String(conversationId)
            )))
            .catch(() => setHistory([]))
    }, [meta?.sender_id, call, conversationId])

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
                setMessages(prev => [...prev, { role: 'system', text: data.message || 'The user has left the conversation.', timestamp: new Date().toISOString() }])
                // The user ending the session closes the handoff — go read-only.
                setResolved(true)
                setEndedReason('abandoned')
            }
            if ((evt === 'handoff_resolved' || evt === 'queue_item_removed') &&
                String(data.conversation_id) === String(conversationId)) {
                setResolved(true)
                setEndedReason(data.status || 'resolved')
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

    const loadCanned = useCallback(async () => {
        try { const d = await call('/portal/api/canned'); setCanned(d.data || []) }
        catch { setCanned([]) }
    }, [call])

    const toggleCanned = () => {
        const next = !showCanned
        setShowCanned(next)
        if (next && canned === null) loadCanned()
    }

    const insertCanned = (body) => {
        setInput(prev => (prev ? `${prev} ${body}` : body))
        setShowCanned(false)
    }

    const saveCanned = async () => {
        const body = input.trim()
        if (!body) { alert('Type a reply first, then save it as a canned reply.'); return }
        const title = prompt('Name this canned reply:')
        if (!title) return
        try {
            await call('/portal/api/canned', { method: 'POST', body: JSON.stringify({ title, body }) })
            setCanned(null); loadCanned()
        } catch (e) { alert(`Save failed: ${e.message}`) }
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

    const openHistory = async (h) => {
        setHistModal({
            title: `${h.app_id || 'Session'} · ${h.handoff_status || ''}`.trim(),
            sub: h.queued_at ? new Date(h.queued_at).toLocaleString() : '',
            messages: [], loading: true,
        })
        try {
            const params = new URLSearchParams()
            if (h.queued_at)   params.set('from_time', h.queued_at)
            if (h.resolved_at) params.set('to_time', h.resolved_at)
            const d = await call(`/portal/api/conversation/${h.conversation_id}/transcript?${params.toString()}`)
            setHistModal(m => m && ({ ...m, messages: d.messages || [], loading: false }))
        } catch {
            setHistModal(m => m && ({ ...m, messages: [], loading: false }))
        }
    }

    const _short = (sid) => sid ? String(sid).replace(/^(iam-|id-)/, '').slice(0, 8) : ''
    const senderName = meta?.user_name || (meta?.sender_id ? `User ${_short(meta.sender_id)}` : conversationId)

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
                    {ended && (
                        <span className="badge bg-success/15 text-success">
                            {endedReason === 'abandoned' ? 'Abandoned'
                                : endedReason === 'timeout' ? 'Timed out'
                                : 'Resolved'}
                        </span>
                    )}
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
                    {ended ? (
                        <div className="text-center py-1.5">
                            <span className="inline-block bg-amber-50 border border-amber-200 text-amber-700 text-xs px-4 py-1.5 rounded-full font-medium">
                                🔒 {endedLabel} — no further messages can be posted
                            </span>
                        </div>
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
                            <div className="mt-1.5 flex items-center gap-4">
                                <button onClick={suggestReply} disabled={drafting} className="text-xs text-primary hover:underline disabled:opacity-50">
                                    {drafting ? '✨ Thinking…' : '✨ Suggest reply'}
                                </button>
                                <div className="relative">
                                    <button onClick={toggleCanned} className="text-xs text-primary hover:underline">
                                        📋 Canned replies
                                    </button>
                                    {showCanned && (
                                        <div className="absolute bottom-6 left-0 z-10 w-72 max-h-64 overflow-y-auto rounded-lg border border-bordc bg-surface shadow-lg p-1">
                                            <button onClick={saveCanned}
                                                className="block w-full text-left px-2 py-1.5 rounded hover:bg-bg text-xs font-medium text-primary border-b border-bordc mb-1">
                                                + Save current reply…
                                            </button>
                                            {canned === null && <div className="px-2 py-1.5 text-xs text-fgsubtle">Loading…</div>}
                                            {canned && canned.length === 0 && <div className="px-2 py-1.5 text-xs text-fgsubtle">No saved replies yet.</div>}
                                            {canned && canned.map(c => (
                                                <button key={c.id} onClick={() => insertCanned(c.body)}
                                                    title={c.body}
                                                    className="block w-full text-left px-2 py-1.5 rounded hover:bg-bg">
                                                    <span className="block text-xs font-medium text-fg">{c.title}</span>
                                                    <span className="block text-[11px] text-fgsubtle truncate">{c.body}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Context & Info panel ────────────────────────────────── */}
            <aside className="w-72 shrink-0 border-l border-bordc bg-surface overflow-y-auto">
                <div className="px-3.5 py-4 space-y-4">
                    <section>
                        <h3 className="text-[11px] font-semibold tracking-wider text-fgsubtle uppercase mb-1.5">Context &amp; Info</h3>
                        <div className="card p-3 space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold text-xs text-fg break-all leading-snug">{senderName}</p>
                                {meta?.priority != null && (
                                    <span className="badge bg-amber-100 text-amber-700 shrink-0">P{meta.priority}</span>
                                )}
                            </div>
                            <div className="space-y-1 text-xs text-fgmuted">
                                {meta?.product_id && <p>🗂️ {productLabel(meta.product_id)}</p>}
                                {meta?.trigger_reason && <p>⚡ {TRIGGER_LABEL[meta.trigger_reason] || meta.trigger_reason}</p>}
                                {meta?.waiting_secs != null && <p>⏱️ Waiting {waitingLabel(meta.waiting_secs)}</p>}
                                {meta?.app_id && <p>💬 {meta.app_id}</p>}
                                {meta?.user_org_id && <p>🏢 {meta.user_org_id}</p>}
                            </div>
                        </div>
                    </section>

                    {meta?.ai_summary && (
                        <section>
                            <h3 className="text-[11px] font-semibold tracking-wider text-fgsubtle uppercase mb-1.5">AI Summary</h3>
                            <div className="card p-3 bg-primary/5 border-primary/20">
                                <p className="text-xs text-fgmuted whitespace-pre-wrap leading-snug">{meta.ai_summary}</p>
                            </div>
                        </section>
                    )}

                    <section>
                        <h3 className="text-[11px] font-semibold tracking-wider text-fgsubtle uppercase mb-1.5">Notes</h3>
                        <textarea
                            value={note}
                            onChange={e => saveNote(e.target.value)}
                            placeholder="Private notes (not sent to user)…"
                            rows={2}
                            className="w-full resize-none rounded-lg border border-bordc bg-bg text-fg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </section>

                    {!ended && (
                        <section className="space-y-1.5">
                            <div className="flex gap-1.5">
                                <button onClick={handleResolve} disabled={resolving} className="btn-primary flex-1 text-xs py-1.5 disabled:opacity-50">
                                    {resolving ? 'Resolving…' : '✓ Resolve'}
                                </button>
                                <button onClick={handleRelease} disabled={releasing} className="btn-ghost flex-1 text-xs py-1.5 border border-bordc disabled:opacity-50">
                                    {releasing ? 'Releasing…' : '↩ Release'}
                                </button>
                            </div>
                            <button onClick={openTransfer} className="w-full btn-ghost text-xs py-1.5 border border-bordc">
                                ⇄ Transfer to Operator
                            </button>
                        </section>
                    )}

                    <section>
                        <h3 className="text-[11px] font-semibold tracking-wider text-fgsubtle uppercase mb-1.5">Interaction History</h3>
                        {history == null ? (
                            <p className="text-xs text-fgsubtle">Loading…</p>
                        ) : history.length === 0 ? (
                            <p className="text-xs text-fgsubtle">No previous sessions</p>
                        ) : (
                            <div className="space-y-1.5">
                                {history.map(h => (
                                    <button
                                        key={h.queue_id}
                                        onClick={() => openHistory(h)}
                                        className="w-full text-left card p-2.5 text-xs space-y-0.5 hover:border-primary transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-medium text-fg truncate">{h.app_id}</span>
                                            <span className={`badge shrink-0 ${h.handoff_status === 'resolved' ? 'bg-success/15 text-success' : 'bg-bg text-fgmuted'}`}>
                                                {h.handoff_status}
                                            </span>
                                        </div>
                                        {h.first_user_msg && <p className="text-fgmuted truncate">“{h.first_user_msg}”</p>}
                                        <p className="text-fgsubtle flex items-center justify-between">
                                            <span>{h.queued_at ? new Date(h.queued_at).toLocaleString() : ''}</span>
                                            <span className="text-primary">View →</span>
                                        </p>
                                    </button>
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

            {/* ── Past-session transcript modal ───────────────────────── */}
            {histModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setHistModal(null)}>
                    <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-4 border-b border-bordc shrink-0">
                            <div>
                                <h3 className="font-semibold text-fg text-sm">{histModal.title || 'Past Conversation'}</h3>
                                <p className="text-xs text-fgsubtle mt-0.5">{histModal.sub}</p>
                            </div>
                            <button onClick={() => setHistModal(null)} className="text-fgsubtle hover:text-fg text-lg leading-none px-1">×</button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">
                            {histModal.loading ? (
                                <div className="flex justify-center py-10">
                                    <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : histModal.messages.length === 0 ? (
                                <p className="text-center text-fgsubtle text-xs py-10">No messages in this session</p>
                            ) : (
                                histModal.messages.map((m, i) => <MessageBubble key={i} msg={m} />)
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
