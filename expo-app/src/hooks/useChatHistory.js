/**
 * useChatHistory — conversation history fetching for the mobile chat screen.
 */
import { useState, useCallback } from 'react';
import { getAdminBaseUrl } from '../config';

export function useChatHistory({ authUser, appIdRef }) {
    const [historyList,     setHistoryList]     = useState([]);
    const [historyLoading,  setHistoryLoading]  = useState(false);
    const [sessionLoading,  setSessionLoading]  = useState(false);
    const [selectedSession, setSelectedSession] = useState(null);
    const [historyView,     setHistoryView]     = useState('list');

    const fetchUserHistory = useCallback(async () => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const adminBase = await getAdminBaseUrl();
            const res  = await fetch(
                `${adminBase}/api/user/conversations?user_name=${encodeURIComponent(authUser)}&app_id=${encodeURIComponent(appIdRef.current)}`
            );
            const resp = await res.json();
            if (resp.success) setHistoryList(resp.data);
        } catch (e) { console.error('Failed to fetch history', e); }
        finally { setHistoryLoading(false); }
    }, [authUser, appIdRef]);

    const fetchSessionMessages = useCallback(async (session) => {
        setSessionLoading(true);
        try {
            const adminBase = await getAdminBaseUrl();
            const res  = await fetch(
                `${adminBase}/api/user/conversation/${encodeURIComponent(session.sender_id)}/messages`
            );
            const resp = await res.json();
            if (resp.success) {
                setSelectedSession({ ...session, messages: resp.data });
                setHistoryView('session');
            }
        } catch (e) { console.error('Failed to fetch session', e); }
        finally { setSessionLoading(false); }
    }, []);

    return {
        historyList, setHistoryList,
        historyLoading, sessionLoading,
        selectedSession, setSelectedSession,
        historyView, setHistoryView,
        fetchUserHistory, fetchSessionMessages,
    };
}
