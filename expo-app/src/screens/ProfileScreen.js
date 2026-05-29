import React from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { THEME, APP_ID_OPTIONS } from '../config';
import { useTheme } from '../context/ThemeContext';

const ProfileScreen = ({ navigation, route }) => {
    const { authUser = '', appId = 'IT', onLogout } = route.params || {};
    const { isDark, toggleTheme } = useTheme();

    const displayName = authUser || 'Guest';
    const initial = displayName[0]?.toUpperCase() || '?';

    const productLabel = [...APP_ID_OPTIONS, { label: 'ShipNest', value: 'shipnest' }, { label: 'GreenLoop', value: 'greenloop' }, { label: 'AccountWise', value: 'accountwise' }]
        .find(o => o.value === appId || o.label === appId)?.label || appId;

    const handleLogout = () => {
        navigation.goBack();
        if (onLogout) onLogout();
    };

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
                <Text style={styles.headerTitle}>My Profile</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                {/* Avatar */}
                <View style={styles.avatarSection}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarLetter}>{initial}</Text>
                    </View>
                    <Text style={styles.displayName}>{displayName}</Text>
                    <Text style={styles.roleText}>Support User</Text>
                </View>

                {/* Info Cards */}
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Account</Text>

                    <View style={styles.card}>
                        <InfoRow icon="person-outline" label="Username" value={authUser || '—'} />
                        <View style={styles.divider} />
                        <InfoRow icon="apps-outline" label="Active Product" value={productLabel} />
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Settings</Text>
                    <View style={styles.card}>
                        <View style={styles.actionRow}>
                            <View style={styles.actionLeft}>
                                <Ionicons name={isDark ? 'moon' : 'sunny-outline'} size={20} color={THEME.primary} />
                                <Text style={styles.actionText}>Dark Mode</Text>
                            </View>
                            <Switch value={isDark} onValueChange={toggleTheme} trackColor={{ true: THEME.primary }} />
                        </View>
                        <View style={styles.divider} />
                        <TouchableOpacity
                            style={styles.actionRow}
                            onPress={() => navigation.navigate('Settings')}
                            activeOpacity={0.7}
                        >
                            <View style={styles.actionLeft}>
                                <Ionicons name="settings-outline" size={20} color={THEME.primary} />
                                <Text style={styles.actionText}>API Settings</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Logout */}
                <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
                    <Ionicons name="log-out-outline" size={20} color="#ffffff" />
                    <Text style={styles.logoutText}>Sign Out</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
};

const InfoRow = ({ icon, label, value }) => (
    <View style={styles.infoRow}>
        <Ionicons name={icon} size={18} color={THEME.primary} style={{ marginRight: 10 }} />
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
);

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
    content: { paddingBottom: 40 },
    avatarSection: {
        alignItems: 'center',
        paddingVertical: 32,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        marginBottom: 20,
    },
    avatar: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: THEME.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 12,
    },
    avatarLetter: { fontSize: 32, fontWeight: '700', color: '#ffffff' },
    displayName: { fontSize: 20, fontWeight: '600', color: THEME.text, marginBottom: 4 },
    roleText: { fontSize: 13, color: THEME.textSecondary },
    section: { paddingHorizontal: 16, marginBottom: 16 },
    sectionTitle: { fontSize: 12, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginLeft: 4 },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    infoLabel: { fontSize: 14, color: THEME.textSecondary, flex: 1 },
    infoValue: { fontSize: 14, fontWeight: '500', color: THEME.text, flex: 1, textAlign: 'right' },
    divider: { height: 1, backgroundColor: '#f3f4f6', marginHorizontal: 16 },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    actionLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    actionText: { fontSize: 14, color: THEME.text, fontWeight: '500' },
    logoutBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginTop: 8,
        paddingVertical: 14,
        borderRadius: 14,
        backgroundColor: '#ef4444',
    },
    logoutText: { fontSize: 15, fontWeight: '600', color: '#ffffff' },
});

export default ProfileScreen;
