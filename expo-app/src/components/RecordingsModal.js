import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ScrollView, ActivityIndicator, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const SOURCE_LABEL = { teams: 'Teams', sharepoint: 'SharePoint', onedrive: 'OneDrive', manual_upload: 'Upload' };

/**
 * Read-mostly recordings view for a ticket (specs/08 mobile parity).
 * Manual file upload is deliberately out of scope here — a real Phase 2.5/3
 * mobile task (native camera-roll upload), not silently skipped.
 */
export default function RecordingsModal({ visible, onClose, ticketId, itsmApi }) {
    const { theme: THEME } = useTheme(); // eslint-disable-line no-shadow
    const styles = useMemo(() => makeStyles(THEME), [THEME]);
    const [recordings, setRecordings] = useState(null);
    const [error, setError] = useState('');
    const [url, setUrl] = useState('');
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!ticketId) return;
        setError('');
        try {
            const data = await itsmApi.get(`/tickets/${ticketId}/recordings`);
            setRecordings(data.items || []);
        } catch (e) {
            setError(e.message || 'Failed to load recordings.');
        }
    }, [ticketId, itsmApi]);

    useEffect(() => { if (visible) { setRecordings(null); load(); } }, [visible, load]);

    const linkRecording = async () => {
        if (!url.trim() || !title.trim() || busy) return;
        setBusy(true); setError('');
        try {
            await itsmApi.post(`/tickets/${ticketId}/recordings/from-url`, { url: url.trim(), title: title.trim() });
            setUrl(''); setTitle('');
            await load();
        } catch (e) {
            Alert.alert('Could not link recording', e.message || 'Unknown error');
        } finally { setBusy(false); }
    };

    const generateSummary = async (recordingId) => {
        try { await itsmApi.post(`/support-recordings/${recordingId}/generate-summary`, {}); load(); }
        catch (e) { Alert.alert('Could not start summary', e.message || 'Unknown error'); }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Recordings</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close-circle" size={24} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={{ maxHeight: 320 }}>
                        {recordings === null && <ActivityIndicator style={{ marginVertical: 20 }} color={THEME.primary} />}
                        {error ? <Text style={styles.error}>{error}</Text> : null}
                        {recordings && recordings.length === 0 && (
                            <Text style={styles.empty}>No recordings linked to this ticket.</Text>
                        )}
                        {(recordings || []).map(r => (
                            <View key={r.id} style={styles.recRow}>
                                <Text style={styles.recTitle} numberOfLines={1}>{r.title}</Text>
                                <Text style={styles.recMeta}>
                                    {SOURCE_LABEL[r.source_type] || r.source_type}
                                    {r.consent_status ? ` · ${r.consent_status.replace(/_/g, ' ')}` : ''}
                                    {r.ai_summary_status === 'completed' ? ' · summarized' : ''}
                                </Text>
                                {r.ai_summary ? <Text style={styles.recSummary} numberOfLines={3}>{r.ai_summary}</Text> : null}
                                <View style={styles.recActions}>
                                    <TouchableOpacity onPress={() => Linking.openURL(r.recording_url)}>
                                        <Text style={styles.link}>Open</Text>
                                    </TouchableOpacity>
                                    {(r.ai_summary_status === 'not_requested' || r.ai_summary_status === 'failed') && (
                                        <TouchableOpacity onPress={() => generateSummary(r.id)}>
                                            <Text style={styles.link}>Generate summary</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        ))}
                    </ScrollView>

                    <View style={styles.addBox}>
                        <TextInput
                            style={styles.input}
                            placeholder="Paste Teams / SharePoint / OneDrive link"
                            value={url}
                            onChangeText={setUrl}
                            autoCapitalize="none"
                        />
                        <TextInput style={styles.input} placeholder="Title" value={title} onChangeText={setTitle} />
                        <TouchableOpacity
                            style={[styles.submitBtn, (!url.trim() || !title.trim() || busy) && styles.disabledBtn]}
                            onPress={linkRecording}
                            disabled={!url.trim() || !title.trim() || busy}
                        >
                            <Text style={styles.submitBtnText}>{busy ? 'Linking…' : '+ Link recording'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const makeStyles = (THEME) => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: THEME.background, borderRadius: 20, overflow: 'hidden', padding: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '700', color: THEME.text },
    error: { color: THEME.error, fontSize: 13, marginBottom: 8 },
    empty: { color: THEME.textSecondary, fontSize: 13, textAlign: 'center', marginVertical: 20 },
    recRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.border },
    recTitle: { fontSize: 14, fontWeight: '600', color: THEME.text },
    recMeta: { fontSize: 12, color: THEME.textSecondary, marginTop: 2 },
    recSummary: { fontSize: 12, color: THEME.textSecondary, fontStyle: 'italic', marginTop: 4 },
    recActions: { flexDirection: 'row', gap: 16, marginTop: 6 },
    link: { fontSize: 12, color: THEME.primary, fontWeight: '600' },
    addBox: { marginTop: 12, gap: 8 },
    input: { borderWidth: 1, borderColor: THEME.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: THEME.text },
    submitBtn: { backgroundColor: THEME.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
    submitBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    disabledBtn: { opacity: 0.4 },
});
