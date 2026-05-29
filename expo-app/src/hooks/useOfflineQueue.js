/**
 * Offline message queue for mobile.
 * Messages sent while offline are stored in AsyncStorage and
 * automatically replayed when connectivity is restored.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'projectiq_offline_queue';

export function useOfflineQueue(onSend) {
    const [isOnline, setIsOnline] = useState(true);
    const onSendRef = useRef(onSend);
    useEffect(() => { onSendRef.current = onSend; }, [onSend]);

    const drainQueue = useCallback(async () => {
        try {
            const raw   = await AsyncStorage.getItem(QUEUE_KEY);
            const queue = raw ? JSON.parse(raw) : [];
            if (!queue.length) return;
            await AsyncStorage.removeItem(QUEUE_KEY);
            for (const text of queue) {
                await onSendRef.current(text);
            }
        } catch {}
    }, []);

    useEffect(() => {
        const unsub = NetInfo.addEventListener(state => {
            const online = !!(state.isConnected && state.isInternetReachable !== false);
            setIsOnline(online);
            if (online) drainQueue();
        });
        return () => unsub();
    }, [drainQueue]);

    const enqueue = useCallback(async (text) => {
        try {
            const raw   = await AsyncStorage.getItem(QUEUE_KEY);
            const queue = raw ? JSON.parse(raw) : [];
            queue.push(text);
            await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
        } catch {}
    }, []);

    return { isOnline, enqueue };
}
