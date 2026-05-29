/**
 * Offline message queue for the web widget.
 * Messages typed while offline are stored in sessionStorage and
 * replayed automatically when the connection is restored.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const QUEUE_KEY = 'projectiq_offline_queue';

export function useOfflineQueue(onSend) {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const onSendRef = useRef(onSend);
    useEffect(() => { onSendRef.current = onSend; }, [onSend]);

    const drainQueue = useCallback(async () => {
        try {
            const raw   = sessionStorage.getItem(QUEUE_KEY);
            const queue = raw ? JSON.parse(raw) : [];
            if (!queue.length) return;
            sessionStorage.removeItem(QUEUE_KEY);
            for (const text of queue) {
                await onSendRef.current(text);
            }
        } catch {}
    }, []);

    useEffect(() => {
        const goOnline = () => {
            setIsOnline(true);
            drainQueue();
        };
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online',  goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online',  goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, [drainQueue]);

    const enqueue = useCallback((text) => {
        try {
            const raw   = sessionStorage.getItem(QUEUE_KEY);
            const queue = raw ? JSON.parse(raw) : [];
            queue.push(text);
            sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch {}
    }, []);

    return { isOnline, enqueue };
}
