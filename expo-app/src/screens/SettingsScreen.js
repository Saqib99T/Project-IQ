import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { getApiUrl, setApiUrl, WEBHOOK_PATH, getAppId, setAppId, APP_ID_OPTIONS } from '../config';

const SettingsScreen = ({ navigation }) => {
    const [url, setUrl] = useState('');
    const [status, setStatus] = useState(null); // 'testing' | 'success' | 'error'
    const [statusMsg, setStatusMsg] = useState('');
    const [saved, setSaved] = useState(false);
    const [selectedAppId, setSelectedAppId] = useState('IT');
    const [showAppIdPicker, setShowAppIdPicker] = useState(false);

    useEffect(() => {
        (async () => {
            const current = await getApiUrl();
            setUrl(current);
            const currentAppId = await getAppId();
            setSelectedAppId(currentAppId);
        })();
    }, []);

    const handleTest = async () => {
        if (!url.trim()) return;
        setStatus('testing');
        setStatusMsg('Testing connection...');
        setSaved(false);

        const base = url.replace(/\/+$/, '');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            // POST to Rasa webhook — same call the chat screen makes
            const response = await fetch(`${base}${WEBHOOK_PATH}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: 'connection_test', message: '/greet' }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (response.ok) {
                setStatus('success');
                setStatusMsg('Connected successfully!');
            } else {
                setStatus('error');
                setStatusMsg(`Server returned ${response.status}`);
            }
        } catch (err) {
            clearTimeout(timeout);
            setStatus('error');
            setStatusMsg(err.name === 'AbortError'
                ? 'Connection timed out. Is the server running?'
                : 'Cannot connect. Check the URL and ensure the server is reachable.');
        }
    };

    const handleSave = async () => {
        const clean = url.replace(/\/+$/, '');
        setUrl(clean);
        await setApiUrl(clean);
        await setAppId(selectedAppId);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const handleAppIdSelect = (value) => {
        setSelectedAppId(value);
        setShowAppIdPicker(false);
        setSaved(false);
    };

    const selectedLabel = APP_ID_OPTIONS.find(o => o.value === selectedAppId)?.label || selectedAppId;

    return (
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={22} color="#374151" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                {/* App ID Selection */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={[styles.iconBox, { backgroundColor: '#4f46e5' }]}>
                            <Ionicons name="apps" size={22} color="#fff" />
                        </View>
                        <View>
                            <Text style={styles.cardTitle}>App ID</Text>
                            <Text style={styles.cardSub}>Select which department to connect to</Text>
                        </View>
                    </View>

                    <Text style={styles.label}>Department</Text>
                    <TouchableOpacity
                        style={styles.dropdown}
                        onPress={() => setShowAppIdPicker(true)}
                    >
                        <Text style={styles.dropdownText}>{selectedLabel}</Text>
                        <Ionicons name="chevron-down" size={20} color="#6b7280" />
                    </TouchableOpacity>
                    <Text style={styles.hint}>
                        Choose the department app to route your queries to the right team.
                    </Text>
                </View>

                {/* Server Config */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.iconBox}>
                            <Ionicons name="server" size={22} color="#fff" />
                        </View>
                        <View>
                            <Text style={styles.cardTitle}>Chatbot Server</Text>
                            <Text style={styles.cardSub}>Backend URL</Text>
                        </View>
                    </View>

                    <Text style={styles.label}>Server URL</Text>
                    <TextInput
                        style={styles.urlInput}
                        value={url}
                        onChangeText={setUrl}
                        placeholder="http://198.233.100.77:8181"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                    />
                    <Text style={styles.hint}>
                        Base URL of the admin API server (port 8181). Changes take effect after saving.
                    </Text>

                    {/* Status */}
                    {status && (
                        <View style={[styles.statusBox,
                        status === 'testing' && styles.statusTesting,
                        status === 'success' && styles.statusSuccess,
                        status === 'error' && styles.statusError,
                        ]}>
                            {status === 'testing' && <ActivityIndicator size="small" color="#d97706" />}
                            {status === 'success' && <Ionicons name="checkmark-circle" size={18} color="#16a34a" />}
                            {status === 'error' && <Ionicons name="alert-circle" size={18} color="#dc2626" />}
                            <Text style={[styles.statusText,
                            status === 'testing' && { color: '#d97706' },
                            status === 'success' && { color: '#16a34a' },
                            status === 'error' && { color: '#dc2626' },
                            ]}>{statusMsg}</Text>
                        </View>
                    )}

                    {/* Buttons */}
                    <View style={styles.btnRow}>
                        <TouchableOpacity style={styles.testBtn} onPress={handleTest}>
                            <Text style={styles.testBtnText}>🔌 Test Connection</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.saveBtn, saved && styles.savedBtn]}
                            onPress={handleSave}
                        >
                            <Text style={styles.saveBtnText}>{saved ? '✓ Saved!' : '💾 Save'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* App Info */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>Project IQ Mobile v{Constants.expoConfig?.version || '1.0.8'}</Text>
                    <Text style={styles.footerSub}>Powered by Rasa • React Native</Text>
                </View>
            </ScrollView>

            {/* App ID Picker Modal */}
            <Modal
                visible={showAppIdPicker}
                transparent
                animationType="fade"
                onRequestClose={() => setShowAppIdPicker(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowAppIdPicker(false)}
                >
                    <View style={styles.pickerModal}>
                        <Text style={styles.pickerTitle}>Select Department</Text>
                        {APP_ID_OPTIONS.map((option) => (
                            <TouchableOpacity
                                key={option.value}
                                style={[
                                    styles.pickerOption,
                                    selectedAppId === option.value && styles.pickerOptionSelected,
                                ]}
                                onPress={() => handleAppIdSelect(option.value)}
                            >
                                <Text style={[
                                    styles.pickerOptionText,
                                    selectedAppId === option.value && styles.pickerOptionTextSelected,
                                ]}>
                                    {option.label}
                                </Text>
                                {selectedAppId === option.value && (
                                    <Ionicons name="checkmark-circle" size={20} color="#4f46e5" />
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9fafb' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    backBtn: { padding: 8, borderRadius: 20 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
    content: { padding: 20, gap: 20, paddingBottom: 40 },

    // Card
    card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: '#f3f4f6' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
    iconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
    cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },
    cardSub: { fontSize: 12, color: '#6b7280' },
    label: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 },

    // Dropdown
    dropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: '#f9fafb',
    },
    dropdownText: { fontSize: 16, color: '#111', fontWeight: '500' },

    // URL Input
    urlInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#111',
        backgroundColor: '#f9fafb',
    },
    urlInputDisabled: {
        backgroundColor: '#f3f4f6',
        color: '#9ca3af',
    },
    hint: { marginTop: 8, fontSize: 12, color: '#9ca3af', lineHeight: 18 },

    // Status
    statusBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, marginTop: 16 },
    statusTesting: { backgroundColor: '#fefce8' },
    statusSuccess: { backgroundColor: '#f0fdf4' },
    statusError: { backgroundColor: '#fef2f2' },
    statusText: { fontSize: 14, flex: 1 },

    // Buttons
    btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
    testBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#f3f4f6',
        borderRadius: 14,
        alignItems: 'center',
    },
    testBtnText: { fontWeight: '500', color: '#374151', fontSize: 14 },
    saveBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#000',
        borderRadius: 14,
        alignItems: 'center',
    },
    savedBtn: { backgroundColor: '#16a34a' },
    saveBtnText: { fontWeight: '600', color: '#fff', fontSize: 14 },

    // Footer
    footer: { alignItems: 'center', paddingVertical: 20 },
    footerText: { fontSize: 12, color: '#9ca3af' },
    footerSub: { fontSize: 11, color: '#d1d5db', marginTop: 4 },

    // Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    pickerModal: {
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 24,
        width: '80%',
        maxWidth: 340,
    },
    pickerTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#111',
        marginBottom: 16,
        textAlign: 'center',
    },
    pickerOption: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 4,
    },
    pickerOptionSelected: {
        backgroundColor: '#eef2ff',
    },
    pickerOptionText: {
        fontSize: 16,
        color: '#374151',
    },
    pickerOptionTextSelected: {
        color: '#4f46e5',
        fontWeight: '600',
    },
});

export default SettingsScreen;
