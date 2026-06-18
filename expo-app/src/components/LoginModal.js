import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, KeyboardAvoidingView, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME, APP_TITLE } from '../config';

const LoginModal = ({ visible, onClose, onIamLogin, onPasswordLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw]     = useState(false);
    const [busy, setBusy]         = useState(false);
    const [error, setError]       = useState(null);

    const reset = () => { setUsername(''); setPassword(''); setError(null); setBusy(false); };
    const handleClose = () => { reset(); onClose(); };

    const submit = async () => {
        if (!username.trim() || !password || !onPasswordLogin) return;
        setBusy(true); setError(null);
        try {
            await onPasswordLogin(username.trim(), password);
            reset();
            onClose();
        } catch (e) {
            setError(e.message || 'Login failed');
            setBusy(false);
        }
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <KeyboardAvoidingView style={styles.overlay} behavior="padding">
                <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.headerText}>🔐 Sign in to {APP_TITLE}</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                            <Ionicons name="close-circle" size={24} color="rgba(255,255,255,0.7)" />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.form}>
                        {onPasswordLogin && (
                            <>
                                <Text style={styles.label}>Email or username</Text>
                                <View style={styles.inputRow}>
                                    <Ionicons name="person-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input} value={username} onChangeText={setUsername}
                                        placeholder="you@example.com" placeholderTextColor="#9ca3af"
                                        autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                                        editable={!busy} returnKeyType="next"
                                    />
                                </View>
                                <Text style={[styles.label, { marginTop: 14 }]}>Password</Text>
                                <View style={styles.inputRow}>
                                    <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input} value={password} onChangeText={setPassword}
                                        placeholder="••••••••" placeholderTextColor="#9ca3af"
                                        secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false}
                                        editable={!busy} returnKeyType="go" onSubmitEditing={submit}
                                    />
                                    <TouchableOpacity onPress={() => setShowPw(v => !v)} style={{ paddingHorizontal: 12 }}>
                                        <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color="#9ca3af" />
                                    </TouchableOpacity>
                                </View>

                                {error && (
                                    <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
                                )}

                                <TouchableOpacity
                                    style={[styles.iamBtn, { marginTop: 18 }, (busy || !username.trim() || !password) && styles.disabledBtn]}
                                    onPress={submit} disabled={busy || !username.trim() || !password}
                                >
                                    {busy
                                        ? <ActivityIndicator color="#fff" />
                                        : <Text style={styles.iamText}>Sign in</Text>}
                                </TouchableOpacity>
                            </>
                        )}

                        {onIamLogin && (
                            <>
                                {onPasswordLogin && (
                                    <View style={styles.dividerRow}>
                                        <View style={styles.dividerLine} /><Text style={styles.dividerLabel}>or</Text><View style={styles.dividerLine} />
                                    </View>
                                )}
                                <TouchableOpacity style={styles.ssoBtn} onPress={() => { handleClose(); onIamLogin(); }} disabled={busy}>
                                    <Ionicons name="key-outline" size={18} color={THEME.primary} style={{ marginRight: 8 }} />
                                    <Text style={styles.ssoText}>Sign in with SSO (browser)</Text>
                                </TouchableOpacity>
                            </>
                        )}

                        <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={busy}>
                            <Text style={styles.cancelText}>Cancel</Text>
                        </TouchableOpacity>
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    card: {
        width: '100%',
        maxWidth: 380,
        backgroundColor: THEME.background,
        borderRadius: 20,
        overflow: 'hidden',
    },
    header: {
        backgroundColor: THEME.primary,
        paddingHorizontal: 20,
        paddingVertical: 18,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    headerText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
    closeBtn: { padding: 4 },
    form: { padding: 20 },
    subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 16, textAlign: 'center' },
    label: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 6 },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: THEME.border,
        borderRadius: 12,
        backgroundColor: '#ffffff',
    },
    inputIcon: { marginLeft: 12 },
    input: {
        flex: 1,
        paddingHorizontal: 12,
        paddingVertical: 14,
        fontSize: 16,
        color: '#111',
    },
    errorBox: {
        marginTop: 12,
        padding: 12,
        backgroundColor: '#fef2f2',
        borderWidth: 1,
        borderColor: '#fecaca',
        borderRadius: 12,
    },
    errorText: { color: '#dc2626', fontSize: 14 },
    btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
    cancelBtn: {
        marginTop: 12,
        paddingVertical: 14,
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        alignItems: 'center',
    },
    cancelText: { color: '#374151', fontWeight: '500', fontSize: 15 },
    loginBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: THEME.primary,
        borderRadius: 12,
        alignItems: 'center',
    },
    loginText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    disabledBtn: { opacity: 0.5 },
    iamBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: THEME.primary,
        paddingVertical: 14,
        borderRadius: 12,
        marginBottom: 4,
    },
    iamText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    ssoBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: THEME.primary,
        paddingVertical: 13,
        borderRadius: 12,
    },
    ssoText: { color: THEME.primary, fontWeight: '600', fontSize: 15 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
    dividerLine: { flex: 1, height: 1, backgroundColor: THEME.border },
    dividerLabel: { marginHorizontal: 10, fontSize: 12, color: '#9ca3af' },
});

export default LoginModal;
