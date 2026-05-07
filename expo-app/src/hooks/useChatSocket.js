/**
 * useChatSocket — Socket.IO handoff event management for the mobile chat screen.
 * Mirrors web/ui/src/widget/hooks/useChatSocket.js but uses getAdminBaseUrl() async pattern.
 */
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import { getAdminBaseUrl } from '../config';

export function useChatSocket({
    senderId,
    operatorName,
    setHandoffState,
    setQueuePosition,
    setWaitMins,
    setOperatorName,
    setOperatorTyping,
    setTimeoutChoice,
    setMessages,
    setPendingFeedbackQueueId,
    setShowFeedback,
}) {
    const socketRef      = useRef(null);
    const opTypingTimer  = useRef(null);

    useEffect(() => {
        if (!senderId) return;
        let cancelled = false;

        (async () => {
            const adminBase = await getAdminBaseUrl();
            if (cancelled) return;

            const socket = io(adminBase, { transports: ['websocket', 'polling'] });
            socketRef.current = socket;

            socket.on('connect', () => {
                socket.emit('join_user', { sender_id: senderId });
                fetch(`${adminBase}/handoff/status/${encodeURIComponent(senderId)}`)
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
                    text: d.text,
                    operator_name: d.operator_name || operatorName,
                    timestamp: d.timestamp,
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
                    setPendingFeedbackQueueId(d.queue_id || null);
                    setShowFeedback(true);
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
                setTimeoutChoice({ message: d.message, options: d.options || [] });
            });
        })();

        return () => {
            cancelled = true;
            clearTimeout(opTypingTimer.current);
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [senderId]);

    return { socketRef, opTypingTimer };
}
