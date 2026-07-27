import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View, Text, FlatList, TouchableOpacity,
    StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../config';
import { getAdminBaseUrl } from '../config';
import { createItsmApi } from '../services/itsmApi';

const TYPE_ICONS = {
    ticket_created:   'ticket-outline',
    handoff_queued:   'time-outline',
    handoff_assigned: 'chatbubble-ellipses-outline',
    handoff_ended:    'checkmark-circle-outline',
    ticket_update:    'refresh-circle-outline',
    // itsm-service notifications (specs/08 RCA governance + support recordings
    // — same 14 types shown on web's NotificationsPage; these aren't
    // deep-linkable there either, so tapping just marks read, matching web).
    ticket_assigned:             'ticket-outline',
    ticket_updated:               'refresh-circle-outline',
    ticket_commented:             'chatbubble-outline',
    ticket_sla_warning:           'warning-outline',
    ticket_sla_breached:         'alert-circle-outline',
    asset_maintenance_due:       'construct-outline',
    kb_article_published:        'book-outline',
    mention:                     'at-outline',
    system:                      'information-circle-outline',
    recording_linked:            'videocam-outline',
    recording_required_missing:  'videocam-off-outline',
    recording_inaccessible:      'alert-circle-outline',
    recording_consent_missing:   'shield-outline',
    recording_summary_ready:     'document-text-outline',
    rca_required:                'flag-outline',
    rca_due_soon:                'time-outline',
    rca_overdue:                 'warning-outline',
    rca_submitted:               'paper-plane-outline',
    rca_rejected:                'close-circle-outline',
    rca_approved:                'checkmark-done-outline',
    rca_action_assigned:         'person-add-outline',
    rca_action_overdue:          'warning-outline',
    rca_completed:               'checkmark-circle-outline',
};

// Notifications fetched from itsm-service (RCA/recordings/tickets) are kept
// in the same merged feed as the chatbot/handoff notifications above, but
// namespaced by id so mark-read can be routed to the right backend.
const ITSM_PREFIX = 'itsm-';

function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

const NotificationsScreen = ({ navigation, route }) => {
    const { userId, getToken } = route.params || {};
    const itsmApi = useMemo(() => (getToken ? createItsmApi(getToken) : null), [getToken]);
    const [notifications, setNotifications] = useState([]);
    const [unread, setUnread]               = useState(0);
    const [loading, setLoading]             = useState(true);
    const [refreshing, setRefreshing]       = useState(false);

    const fetchNotifications = useCallback(async (silent = false) => {
        if (!userId) { setLoading(false); return; }
        if (!silent) setLoading(true);
        try {
            const base = await getAdminBaseUrl();
            const res  = await fetch(`${base}/notifications?sender_id=${encodeURIComponent(userId)}`);
            const data = await res.json();
            const chatbotItems = data.success ? data.data : [];
            const chatbotUnread = data.success ? data.unread_count : 0;

            let itsmItems = [];
            let itsmUnread = 0;
            if (itsmApi) {
                try {
                    const itsmData = await itsmApi.get('/notifications', { limit: 50 });
                    itsmItems = (itsmData.items || []).map(n => ({
                        id: `${ITSM_PREFIX}${n.id}`,
                        type: n.type,
                        title: n.title,
                        body: n.body,
                        created_at: n.created_at,
                        read: n.is_read,
                    }));
                    itsmUnread = itsmItems.filter(n => !n.read).length;
                } catch (e) {
                    console.warn('[Notifications] itsm-service fetch error', e.message);
                }
            }

            const merged = [...chatbotItems, ...itsmItems]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            setNotifications(merged);
            setUnread(chatbotUnread + itsmUnread);
        } catch (e) {
            console.warn('[Notifications] fetch error', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [userId, itsmApi]);

    // Fetch on mount, then poll while the screen is open so it stays current
    // without a manual pull (the always-mounted header badge is socket-live;
    // this keeps the drill-in list fresh too).
    useEffect(() => {
        fetchNotifications();
        const id = setInterval(() => fetchNotifications(true), 20000);
        return () => clearInterval(id);
    }, [fetchNotifications]);

    const markRead = async (id) => {
        try {
            if (String(id).startsWith(ITSM_PREFIX)) {
                if (!itsmApi) return;
                await itsmApi.patch('/notifications/mark-read', { ids: [String(id).slice(ITSM_PREFIX.length)] });
            } else {
                const base = await getAdminBaseUrl();
                await fetch(`${base}/notifications/${id}/read`, { method: 'POST' });
            }
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
            setUnread(prev => Math.max(0, prev - 1));
        } catch {}
    };

    const markAllRead = async () => {
        try {
            const base = await getAdminBaseUrl();
            await Promise.all([
                fetch(`${base}/notifications/read-all`, { method: 'POST' }),
                itsmApi ? itsmApi.patch('/notifications/mark-read', { all: true }) : Promise.resolve(),
            ]);
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnread(0);
        } catch {}
    };

    const onRefresh = () => {
        setRefreshing(true);
        fetchNotifications(true);
    };

    const renderItem = ({ item }) => (
        <TouchableOpacity
            style={[styles.item, !item.read && styles.itemUnread]}
            onPress={() => !item.read && markRead(item.id)}
            activeOpacity={0.7}
        >
            <View style={styles.iconBox}>
                <Ionicons
                    name={TYPE_ICONS[item.type] || 'notifications-outline'}
                    size={22}
                    color={item.read ? THEME.textSecondary : THEME.primary}
                />
            </View>
            <View style={styles.content}>
                <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={2}>
                    {item.title}
                </Text>
                {item.body ? (
                    <Text style={styles.body} numberOfLines={1}>{item.body}</Text>
                ) : null}
                <Text style={styles.time}>{relativeTime(item.created_at)}</Text>
            </View>
            {!item.read && <View style={styles.dot} />}
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.backBtn}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <Ionicons name="arrow-back" size={22} color={THEME.text} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                {unread > 0 && (
                    <TouchableOpacity onPress={markAllRead} style={styles.readAllBtn}>
                        <Text style={styles.readAllText}>Mark all read</Text>
                    </TouchableOpacity>
                )}
                {unread === 0 && <View style={{ width: 80 }} />}
            </View>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={THEME.primary} />
                </View>
            ) : (
                <FlatList
                    data={notifications}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.primary} />
                    }
                    ListEmptyComponent={
                        <View style={styles.centered}>
                            <Ionicons name="notifications-off-outline" size={48} color="#d1d5db" />
                            <Text style={styles.emptyText}>No notifications yet</Text>
                        </View>
                    }
                    contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : { paddingBottom: 16 }}
                    showsVerticalScrollIndicator={false}
                />
            )}
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f3f4f6' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        paddingVertical: 12,
        minHeight: 56,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    backBtn: { padding: 8, borderRadius: 20 },
    headerTitle: { fontSize: 17, fontWeight: '600', color: THEME.text },
    readAllBtn: { paddingHorizontal: 8, paddingVertical: 4 },
    readAllText: { fontSize: 13, color: THEME.primary, fontWeight: '500' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    emptyContainer: { flex: 1 },
    emptyText: { fontSize: 14, color: THEME.textSecondary },
    item: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        gap: 12,
    },
    itemUnread: { backgroundColor: '#eff6ff' },
    iconBox: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f3f4f6',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
    },
    content: { flex: 1 },
    title: { fontSize: 14, color: THEME.text, lineHeight: 20 },
    titleUnread: { fontWeight: '600' },
    body: { fontSize: 12, color: THEME.textSecondary, marginTop: 2 },
    time: { fontSize: 11, color: '#9ca3af', marginTop: 4 },
    dot: {
        width: 8, height: 8,
        borderRadius: 4,
        backgroundColor: THEME.primary,
        marginTop: 6,
        flexShrink: 0,
    },
});

export default NotificationsScreen;
