import React, { useState, useEffect, useCallback } from 'react';
import {
    View, Text, FlatList, TouchableOpacity,
    StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../config';
import { getAdminBaseUrl } from '../config';

const TYPE_ICONS = {
    ticket_created:   'ticket-outline',
    handoff_queued:   'time-outline',
    handoff_assigned: 'chatbubble-ellipses-outline',
    handoff_ended:    'checkmark-circle-outline',
    ticket_update:    'refresh-circle-outline',
};

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
    const { userId } = route.params || {};
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
            if (data.success) {
                setNotifications(data.data);
                setUnread(data.unread_count);
            }
        } catch (e) {
            console.warn('[Notifications] fetch error', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [userId]);

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
            const base = await getAdminBaseUrl();
            await fetch(`${base}/notifications/${id}/read`, { method: 'POST' });
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, read: true } : n)
            );
            setUnread(prev => Math.max(0, prev - 1));
        } catch {}
    };

    const markAllRead = async () => {
        try {
            const base = await getAdminBaseUrl();
            await fetch(`${base}/notifications/read-all`, { method: 'POST' });
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
