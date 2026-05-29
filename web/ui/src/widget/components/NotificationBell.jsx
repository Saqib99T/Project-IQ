import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';

const ADMIN_API_URL = window.location.origin;

const TYPE_LABELS = {
    ticket_created:   'Ticket created',
    handoff_queued:   'In the queue',
    handoff_assigned: 'Agent connected',
    handoff_ended:    'Session closed',
    ticket_update:    'Ticket updated',
};

const TYPE_ICONS = {
    ticket_created:   '🎫',
    handoff_queued:   '⏳',
    handoff_assigned: '💬',
    handoff_ended:    '✅',
    ticket_update:    '🔄',
};

function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const NotificationBell = ({ userId, socket, primaryColor = '#3b82f6', onUnreadChange }) => {
    const [open, setOpen]         = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unread, setUnread]     = useState(0);
    const [loading, setLoading]   = useState(false);
    const dropdownRef             = useRef(null);

    // Notify parent whenever unread count changes (for tab title / PWA badge)
    useEffect(() => {
        onUnreadChange?.(unread);
    }, [unread, onUnreadChange]);

    const fetchNotifications = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const res  = await fetch(`${ADMIN_API_URL}/notifications?sender_id=${encodeURIComponent(userId)}`);
            const data = await res.json();
            if (data.success) {
                setNotifications(data.data);
                setUnread(data.unread_count);
            }
        } catch (e) {
            console.warn('[NotificationBell] fetch error', e);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    // Load on mount and when userId changes
    useEffect(() => {
        fetchNotifications();
    }, [fetchNotifications]);

    // Live updates via Socket.IO
    useEffect(() => {
        if (!socket) return;
        const onNew   = (payload) => {
            setUnread(payload.unread_count ?? 0);
            setNotifications(prev => [{
                id:         payload.id,
                type:       payload.type,
                title:      payload.title,
                body:       payload.body,
                payload:    payload.payload,
                read:       false,
                created_at: new Date().toISOString(),
            }, ...prev].slice(0, 50));
        };
        const onCount = (payload) => setUnread(payload.unread_count ?? 0);
        socket.on('new_notification',  onNew);
        socket.on('notification_count', onCount);
        return () => {
            socket.off('new_notification',  onNew);
            socket.off('notification_count', onCount);
        };
    }, [socket]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleOpen = () => {
        setOpen(v => !v);
        if (!open) fetchNotifications();
    };

    const markRead = async (id) => {
        try {
            await fetch(`${ADMIN_API_URL}/notifications/${id}/read`, { method: 'POST' });
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
            setUnread(prev => Math.max(0, prev - 1));
        } catch {}
    };

    const markAllRead = async () => {
        try {
            await fetch(`${ADMIN_API_URL}/notifications/read-all`, { method: 'POST' });
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnread(0);
        } catch {}
    };

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell button */}
            <button
                onClick={handleOpen}
                className="p-2 rounded-full hover:bg-gray-100 transition-colors relative"
                title="Notifications"
            >
                <Bell size={18} className="text-gray-600" />
                {unread > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full
                                   text-white text-[9px] font-bold flex items-center justify-center px-0.5"
                        style={{ backgroundColor: primaryColor }}
                    >
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    className="absolute right-0 top-10 w-80 rounded-xl shadow-2xl z-[80] overflow-hidden"
                    style={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.08)' }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <span className="text-sm font-semibold text-gray-800">Notifications</span>
                        {unread > 0 && (
                            <button
                                onClick={markAllRead}
                                className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* List */}
                    <div className="max-h-72 overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                                Loading…
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-400 gap-2">
                                <Bell size={24} strokeWidth={1.2} />
                                <span className="text-sm">No notifications yet</span>
                            </div>
                        ) : (
                            notifications.map(n => (
                                <div
                                    key={n.id}
                                    onClick={() => !n.read && markRead(n.id)}
                                    className={`flex gap-3 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors ${
                                        n.read ? 'bg-white' : 'bg-blue-50 hover:bg-blue-100'
                                    }`}
                                >
                                    <span className="text-xl flex-shrink-0 mt-0.5">
                                        {TYPE_ICONS[n.type] || '🔔'}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm leading-snug ${n.read ? 'text-gray-700' : 'text-gray-900 font-medium'}`}>
                                            {n.title}
                                        </p>
                                        {n.body && (
                                            <p className="text-xs text-gray-400 mt-0.5 truncate">{n.body}</p>
                                        )}
                                        <p className="text-xs text-gray-400 mt-1">{relativeTime(n.created_at)}</p>
                                    </div>
                                    {!n.read && (
                                        <span
                                            className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                                            style={{ backgroundColor: primaryColor }}
                                        />
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
