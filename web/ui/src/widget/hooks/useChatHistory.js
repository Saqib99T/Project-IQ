/**
 * useChatHistory — fetches conversation history list and individual session messages.
 *
 * Returns: { sessions, historyLoading, sessionLoading, selectedSession,
 *             historyView, fetchUserHistory, fetchSessionMessages, setHistoryView,
 *             setSelectedSession }
 */
import { useState, useCallback } from 'react';

export function useChatHistory({ authUser, appId, ADMIN_API_URL }) {
    const [sessions,        setSessions]       = useState([]);
    const [historyLoading,  setHistoryLoading] = useState(false);
    const [sessionLoading,  setSessionLoading] = useState(false);
    const [selectedSession, setSelectedSession] = useState(null);
    const [historyView,     setHistoryView]    = useState('list'); // 'list' | 'session'

    const fetchUserHistory = useCallback(async () => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const res  = await fetch(
                `${ADMIN_API_URL}/api/user/conversations?user_name=${encodeURIComponent(authUser)}&app_id=${encodeURIComponent(appId)}`
            );
            const data = await res.json();
            if (data.success) setSessions(data.data);
        } catch (e) {
            console.error('Failed to fetch history', e);
        } finally {
            setHistoryLoading(false);
        }
    }, [authUser, appId, ADMIN_API_URL]);

    const fetchSessionMessages = useCallback(async (session) => {
        setSessionLoading(true);
        try {
            const res  = await fetch(
                `${ADMIN_API_URL}/api/user/conversation/${encodeURIComponent(session.sender_id)}/messages`
            );
            const data = await res.json();
            if (data.success) {
                setSelectedSession({ ...session, messages: data.data });
                setHistoryView('session');
            }
        } catch (e) {
            console.error('Failed to fetch session messages', e);
        } finally {
            setSessionLoading(false);
        }
    }, [ADMIN_API_URL]);

    return {
        sessions, historyLoading, sessionLoading,
        selectedSession, setSelectedSession,
        historyView, setHistoryView,
        fetchUserHistory, fetchSessionMessages,
    };
}
