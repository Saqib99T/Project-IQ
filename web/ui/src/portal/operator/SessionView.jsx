import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '../useApi'
import { usePortalSocket } from './usePortalSocket'

function MessageBubble({ msg }) {
    const isOperator = msg.role === 'operator'
    const isBot      = msg.role === 'bot'
    return (
        <div className={`flex ${isOperator ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 text-sm ${
                isOperator
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : isBot
                        ? 'bg-gray-200 text-gray-700 rounded-bl-sm'
                        : 'bg-white border border-gray-200 text-gray-900 rounded-bl-sm'
            }`}>
                {!isOperator && (
                    <p className="text-xs font-semibold mb-0.5 opacity-60">
                        {isBot ? 'Bot' : 'User'}
                    </p>
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

    const [messages, setMessages]   = useState([])
    const [senderMeta, setSenderMeta] = useState(null)
    const [loading, setLoading]     = useState(true)
    const [error, setError]         = useState(null)
    const [input, setInput]         = useState('')
    const [sending, setSending]     = useState(false)
    const [resolving, setResolving] = useState(false)
    const [releasing, setReleasing] = useState(false)
    const [userTyping, setUserTyping] = useState(false)
    const [resolved, setResolved]   = useState(false)

    const bottomRef = useRef(null)
    const typingTimer = useRef(null)

    const fetchConversation = useCallback(async () => {
        try {
            const data = await call(`/portal/api/conversation/${conversationId}`)
            setMessages(data.messages || [])
            setSenderMeta(data.meta || null)
            setError(null)
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [call, conversationId])

    useEffect(() => {
        fetchConversation()
    }, [fetchConversation])

    // Scroll to bottom whenever messages change
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const { emit } = usePortalSocket({
        onEvent: (evt, data) => {
            if (!data) return
            if ((evt === 'operator_message' || evt === 'live_message') &&
                String(data.conversation_id) === String(conversationId)) {
                setMessages(prev => [...prev, {
                    role:      data.role || 'operator',
                    text:      data.text,
                    timestamp: data.timestamp || new Date().toISOString(),
                }])
            }
            if (evt === 'user_typing' && String(data.conversation_id) === String(conversationId)) {
                setUserTyping(data.typing)
                clearTimeout(typingTimer.current)
                if (data.typing) {
                    typingTimer.current = setTimeout(() => setUserTyping(false), 4000)
                }
            }
            if (evt === 'user_left' && String(data.conversation_id) === String(conversationId)) {
                setMessages(prev => [...prev, {
                    role: 'system',
                    text: 'The user has left the conversation.',
                    timestamp: new Date().toISOString(),
                }])
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
        try {
            await call('/portal/api/chat/send', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId, text }),
            })
            setInput('')
        } catch (e) {
            alert(`Send failed: ${e.message}`)
        } finally {
            setSending(false)
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const handleTyping = (e) => {
        setInput(e.target.value)
        if (senderMeta?.sender_id) {
            emit('operator_typing', {
                conversation_id: conversationId,
                sender_id:       senderMeta.sender_id,
                typing:          true,
            })
        }
    }

    const handleResolve = async () => {
        if (!window.confirm('Mark this conversation as resolved?')) return
        setResolving(true)
        try {
            await call('/portal/api/queue/resolve', {
                method: 'POST',
                body: JSON.stringify({ conversation_id: conversationId }),
            })
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
                body: JSON.stringify({ conversation_id: conversationId }),
            })
            navigate('/operator/sessions')
        } catch (e) {
            alert(`Release failed: ${e.message}`)
            setReleasing(false)
        }
    }

    return (
        <div className="flex flex-col h-full -m-6">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-gray-200 shrink-0">
                <button
                    onClick={() => navigate('/operator/sessions')}
                    className="text-gray-400 hover:text-gray-600 transition-colors text-sm"
                >
                    ← Back
                </button>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                        {senderMeta?.sender_id || conversationId}
                    </p>
                    {senderMeta?.app_id && (
                        <p className="text-xs text-gray-500">{senderMeta.app_id}</p>
                    )}
                </div>
                {resolved ? (
                    <span className="badge bg-green-100 text-green-700">Resolved</span>
                ) : (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRelease}
                            disabled={releasing}
                            className="btn-ghost text-xs"
                        >
                            {releasing ? 'Releasing…' : 'Release'}
                        </button>
                        <button
                            onClick={handleResolve}
                            disabled={resolving}
                            className="btn-primary text-xs"
                        >
                            {resolving ? 'Resolving…' : 'Resolve'}
                        </button>
                    </div>
                )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-gray-50">
                {loading && (
                    <div className="flex justify-center py-12">
                        <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
                {error && (
                    <div className="card p-4 bg-red-50 border-red-200 text-red-700 text-sm">{error}</div>
                )}
                {messages.map((msg, i) => (
                    msg.role === 'system'
                        ? <p key={i} className="text-center text-xs text-gray-400 py-1">{msg.text}</p>
                        : <MessageBubble key={i} msg={msg} />
                ))}
                {userTyping && (
                    <div className="flex justify-start">
                        <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-2.5">
                            <span className="text-xs text-gray-400 italic">User is typing…</span>
                        </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-6 py-3 bg-white border-t border-gray-200 shrink-0">
                {resolved ? (
                    <p className="text-center text-sm text-gray-400 py-2">This session is resolved.</p>
                ) : (
                    <div className="flex items-end gap-3">
                        <textarea
                            value={input}
                            onChange={handleTyping}
                            onKeyDown={handleKeyDown}
                            placeholder="Type a message… (Enter to send)"
                            rows={2}
                            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                            onClick={sendMessage}
                            disabled={sending || !input.trim()}
                            className="btn-primary px-5 py-2.5 text-sm shrink-0 disabled:opacity-50"
                        >
                            {sending ? '…' : 'Send'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
