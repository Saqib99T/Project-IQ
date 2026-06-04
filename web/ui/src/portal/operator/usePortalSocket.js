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
            'user_typing',
            'user_left',
            'handoff_resolved',
            'capacity_update',
        ]
        EVENTS.forEach(evt => {
            socket.on(evt, data => onEventRef.current?.(evt, data))
        })

        return () => {
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
