/**
 * useChatSocket — manages the Socket.IO connection and all handoff real-time events.
 *
 * Returns: { socketRef, emitUserEndSession, emitUserTyping }
 * The caller keeps all state setters; this hook just wires socket events to them.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

export function useChatSocket({
    senderId,
    ADMIN_API_URL,
    handoffState,
    handoffStateRef,
    // state setters
    setHandoffState,
    setQueuePosition,
    setWaitMins,
    setOperatorName,
    setOperatorTyping,
    setTimeoutChoice,
    setMessages,
    setFeedbackRating,
    setFeedbackHover,
    setFeedbackComment,
    setFeedbackDone,
    setPendingFeedback,
}) {
    const socketRef        = useRef(null);
    const opTypingTimer    = useRef(null);
    const userTypingTimer  = useRef(null);
    const isUserTypingRef  = useRef(false);

    // ── Main socket setup ─────────────────────────────────────────────────────
    useEffect(() => {
        const socket = io(ADMIN_API_URL, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join_user', { sender_id: senderId });

            // Restore handoff state after reconnect / page refresh
            fetch(`${ADMIN_API_URL}/handoff/status/${encodeURIComponent(senderId)}`)
                .then(r => r.json())
                .then(d => {
                    const state = d.handoff_state || 'bot_active';
                    if (state === 'queued') {
                        setHandoffState('queued');
                        setQueuePosition(d.queue_position || 1);
                        setWaitMins(d.wait_mins || null);
                    } else if (state === 'assigned') {
                        setHandoffState('assigned');
                        setOperatorName(d.operator_name || 'an agent');
                    }
                })
                .catch(() => {});
        });

        socket.on('handoff_queued', (d) => {
            setHandoffState('queued');
            setQueuePosition(d.queue_position || 1);
            setWaitMins(d.wait_estimate_mins || null);
            setTimeoutChoice(null);
        });

        socket.on('wait_update', (d) => {
            setQueuePosition(d.queue_position);
            setWaitMins(d.wait_estimate_mins);
        });

        socket.on('handoff_assigned', (d) => {
            setHandoffState('assigned');
            setOperatorName(d.operator_name || 'an agent');
            setQueuePosition(null);
            setWaitMins(null);
            setTimeoutChoice(null);
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: d.message || `✅ **${d.operator_name || 'An agent'}** has joined the conversation.`,
                type: 'system',
            }]);
        });

        socket.on('operator_message', (d) => {
            if (d.sender_id && d.sender_id !== senderId) return;
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'operator',
                text: d.text, timestamp: d.timestamp,
            }]);
            setOperatorTyping(false);
            clearTimeout(opTypingTimer.current);
        });

        socket.on('operator_typing', (d) => {
            setOperatorTyping(d.typing);
            if (d.typing) {
                clearTimeout(opTypingTimer.current);
                opTypingTimer.current = setTimeout(() => setOperatorTyping(false), 5000);
            } else {
                clearTimeout(opTypingTimer.current);
            }
        });

        socket.on('handoff_resolved', (d) => {
            setHandoffState('bot_active');
            setOperatorName('');
            setOperatorTyping(false);
            setTimeoutChoice(null);
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: d.message || "✅ The agent session has ended. I'm back to assist you.",
                type: 'system',
            }]);
            if (d.request_feedback) {
                setFeedbackRating(0);
                setFeedbackHover(0);
                setFeedbackComment('');
                setFeedbackDone(false);
                setPendingFeedback({ queueId: d.queue_id || null, conversationId: d.conversation_id || null });
            }
        });

        socket.on('handoff_abandoned', (d) => {
            setHandoffState('bot_active');
            setQueuePosition(null);
            setWaitMins(null);
            setTimeoutChoice(null);
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: d.message || "⚠️ The queue wait exceeded our limit. I'm back to assist you.",
                type: 'system',
            }]);
        });

        socket.on('handoff_timeout_choice', (d) => {
            setTimeoutChoice({ message: d.message, options: d.options });
        });

        return () => {
            clearTimeout(opTypingTimer.current);
            clearTimeout(userTypingTimer.current);
            socket.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senderId]);

    // ── Emit helpers ─────────────────────────────────────────────────────────

    const emitUserEndSession = useCallback(() => {
        if (handoffStateRef.current === 'bot_active') return;
        socketRef.current?.emit('user_end_session', { sender_id: senderId });
        fetch(`${ADMIN_API_URL}/handoff/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender_id: senderId }),
        }).catch(() => {});
        setHandoffState('bot_active');
        setOperatorName('');
        setQueuePosition(null);
        setWaitMins(null);
        setTimeoutChoice(null);
    }, [senderId, ADMIN_API_URL]);

    const emitUserTyping = useCallback((typing) => {
        if (!socketRef.current || handoffState !== 'assigned') return;
        if (typing === isUserTypingRef.current) return;
        isUserTypingRef.current = typing;
        socketRef.current.emit('user_typing', { sender_id: senderId, typing });
    }, [handoffState, senderId]);

    return { socketRef, opTypingTimer, userTypingTimer, emitUserEndSession, emitUserTyping };
}
