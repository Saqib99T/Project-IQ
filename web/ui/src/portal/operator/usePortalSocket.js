import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { useIam } from '../../widget/hooks/useIam'

/**
 * Socket.IO hook for portal operators.
 * Connects with the IAM Bearer token, joins the operator room, and
 * returns helpers for listening to / emitting events.
 */
export function usePortalSocket({ onEvent } = {}) {
    const { token } = useIam()
    const socketRef = useRef(null)
    const [connected, setConnected] = useState(false)
    const onEventRef = useRef(onEvent)
    onEventRef.current = onEvent

    useEffect(() => {
        if (!token) return

        const socket = io('/', {
            transports:        ['websocket', 'polling'],
            reconnectionDelay: 2000,
            auth:              { token },
        })
        socketRef.current = socket

        socket.on('connect', () => {
            setConnected(true)
            socket.emit('join_portal_operator', { token })
        })

        socket.on('disconnect', () => setConnected(false))

        // Forward all named events to the caller's handler
        const EVENTS = [
            'queue_item_updated',
            'queue_item_removed',
            'operator_message',
            'live_message',
            'user_message',
            'user_typing',
            'user_left',
            'handoff_resolved',
            'capacity_update',
        ]
        EVENTS.forEach(evt => {
            socket.on(evt, data => onEventRef.current?.(evt, data))
        })

        // Self-heal a stale/zombie socket. A tab left open a long time can lose
        // its ping/pong (firewall drops idle WS) and stay "connected"
        // client-side while the server dropped it from the operator room — every
        // user_message then lands in an empty room (members=0) and is lost. On
        // focus/visibility, reconnect if needed and re-join the operator room.
        const rejoin = () => {
            if (!socket.connected) { try { socket.connect() } catch { /* noop */ } }
            try { socket.emit('join_portal_operator', { token }) } catch { /* noop */ }
        }
        const onVisible = () => { if (document.visibilityState === 'visible') rejoin() }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', rejoin)

        return () => {
            document.removeEventListener('visibilitychange', onVisible)
            window.removeEventListener('focus', rejoin)
            socket.disconnect()
            socketRef.current = null
            setConnected(false)
        }
    }, [token])

    const emit = useCallback((event, data) => {
        socketRef.current?.emit(event, data)
    }, [])

    return { connected, emit }
}
