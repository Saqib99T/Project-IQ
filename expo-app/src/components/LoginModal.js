import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME, APP_TITLE } from '../config';

const LoginModal = ({ visible, onClose, onLogin, isLoading, error }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = () => {
        if (username.trim() && password.trim()) {
            onLogin(username.trim(), password.trim());
        }
    };

    const handleClose = () => {
        setUsername('');
        setPassword('');
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <KeyboardAvoidingView style={styles.overlay} behavior="padding">
                <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.headerText}>🔐 Login to {APP_TITLE}</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                            <Ionicons name="close-circle" size={24} color="rgba(255,255,255,0.7)" />
                        </TouchableOpacity>
                    </View>

                    {/* Form */}
                    <View style={styles.form}>
                        <Text style={styles.label}>Username</Text>
                        <View style={styles.inputRow}>
                            <Ionicons name="person-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                value={username}
                                onChangeText={setUsername}
                                placeholder="Username"
                                autoCapitalize="none"
                                autoCorrect={false}
                                editable={!isLoading}
                            />
                        </View>

                        <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
                        <View style={styles.inputRow}>
                            <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                value={password}
                                onChangeText={setPassword}
                                placeholder="Password"
                                secureTextEntry
                                editable={!isLoading}
                            />
                        </View>

                        {error ? (
                            <View style={styles.errorBox}>
                                <Text style={styles.errorText}>❌ {error}</Text>
                            </View>
                        ) : null}

                        <View style={styles.btnRow}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.loginBtn, isLoading && styles.disabledBtn]}
                                onPress={handleSubmit}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Text style={styles.loginText}>Login</Text>
                                )}
                            </TouchableOpacity>
                        </View>
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
        flex: 1,
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
});

export default LoginModal;
