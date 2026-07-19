import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

const STATUS_LABEL = {
    required: 'Required', draft: 'Draft', under_review: 'Under review', approved: 'Approved',
    actions_in_progress: 'Actions in progress', completed: 'Completed', rejected: 'Rejected',
    waived: 'Waived', overdue: 'Overdue',
};

// Client-side mirror of the backend state machine — for showing/hiding
// buttons only. The server's response is always authoritative.
const NEXT_STEPS = {
    required: ['draft', 'waived'], draft: ['under_review', 'waived'],
    under_review: ['approved', 'rejected'], rejected: ['draft'],
    approved: ['actions_in_progress', 'completed'], actions_in_progress: ['completed'],
};

/**
 * Read-mostly RCA summary + lifecycle actions for a ticket (specs/08 mobile
 * parity). Long-form narrative-field editing (executive summary, root cause
 * text) is deliberately web-only for Phase 1/2 — authoring is impractical in
 * this modal UX; this screen only shows progress and drives the workflow.
 */
export default function RcaSummaryModal({ visible, onClose, ticketId, itsmApi, canManage }) {
    const { theme: THEME } = useTheme(); // eslint-disable-line no-shadow
    const styles = useMemo(() => makeStyles(THEME), [THEME]);
    const [rca, setRca] = useState(undefined); // undefined = loading, null = none exists
    const [checklist, setChecklist] = useState([]);
    const [actions, setActions] = useState([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        if (!ticketId) return;
        setError('');
        try {
            const list = await itsmApi.get('/rca', { source_ticket_id: ticketId });
            const found = (list.items || [])[0] || null;
            setRca(found);
            if (found) {
                const [cl, ac] = await Promise.all([
                    itsmApi.get(`/rca/${found.id}/evidence-checklist`),
                    itsmApi.get(`/rca/${found.id}/actions`),
                ]);
                setChecklist(cl.items || []);
                setActions(ac.items || []);
            }
        } catch (e) {
            setError(e.message || 'Failed to load RCA.');
        }
    }, [ticketId, itsmApi]);

    useEffect(() => { if (visible) { setRca(undefined); load(); } }, [visible, load]);

    const runAction = async (action, body) => {
        if (!rca || busy) return;
        setBusy(true);
        try { await itsmApi.post(`/rca/${rca.id}/${action}`, body || {}); await load(); }
        catch (e) { Alert.alert('Action failed', e.message || 'Unknown error'); }
        finally { setBusy(false); }
    };
    const reject = () => Alert.prompt
        ? Alert.prompt('Reject RCA', 'Reason:', (reason) => reason && runAction('reject', { reason }))
        : runAction('reject', { reason: 'Rejected from mobile' });
    const waive = () => Alert.prompt
        ? Alert.prompt('Waive RCA', 'Reason:', (reason) => reason && runAction('waive', { reason }))
        : runAction('waive', { reason: 'Waived from mobile' });

    const evidenceDone = checklist.filter(i => i.status !== 'missing').length;
    const next = rca ? (NEXT_STEPS[rca.status] || []) : [];

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.header}>
                        <Text style={styles.title}>RCA</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close-circle" size={24} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>

                    {rca === undefined && <ActivityIndicator style={{ marginVertical: 20 }} color={THEME.primary} />}
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    {rca === null && !error && (
                        <Text style={styles.empty}>No RCA exists for this ticket yet.</Text>
                    )}

                    {rca && (
                        <ScrollView style={{ maxHeight: 360 }}>
                            <View style={styles.statusRow}>
                                <Text style={styles.rcaNumber}>{rca.rca_number}</Text>
                                <View style={styles.statusPill}><Text style={styles.statusPillText}>{STATUS_LABEL[rca.status] || rca.status}</Text></View>
                            </View>
                            {rca.due_at && <Text style={styles.meta}>Due {new Date(rca.due_at).toLocaleDateString()}</Text>}
                            <Text style={styles.meta}>Evidence: {evidenceDone}/{checklist.length} provided</Text>
                            <Text style={styles.meta}>Action items: {actions.length} ({actions.filter(a => a.status === 'done' || a.status === 'accepted_risk').length} closed)</Text>

                            <View style={styles.actionsRow}>
                                {next.includes('under_review') && (
                                    <TouchableOpacity style={styles.actionBtn} onPress={() => runAction('submit')} disabled={busy}>
                                        <Text style={styles.actionBtnText}>Submit</Text>
                                    </TouchableOpacity>
                                )}
                                {canManage && next.includes('approved') && (
                                    <TouchableOpacity style={styles.actionBtn} onPress={() => runAction('approve')} disabled={busy}>
                                        <Text style={styles.actionBtnText}>Approve</Text>
                                    </TouchableOpacity>
                                )}
                                {canManage && rca.status === 'under_review' && (
                                    <TouchableOpacity style={styles.actionBtnGhost} onPress={reject} disabled={busy}>
                                        <Text style={styles.actionBtnGhostText}>Reject</Text>
                                    </TouchableOpacity>
                                )}
                                {canManage && next.includes('waived') && (
                                    <TouchableOpacity style={styles.actionBtnGhost} onPress={waive} disabled={busy}>
                                        <Text style={styles.actionBtnGhostText}>Waive</Text>
                                    </TouchableOpacity>
                                )}
                                {rca.status === 'actions_in_progress' && (
                                    <TouchableOpacity style={styles.actionBtn} onPress={() => runAction('complete')} disabled={busy}>
                                        <Text style={styles.actionBtnText}>Complete</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        </ScrollView>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const makeStyles = (THEME) => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 420, maxHeight: '80%', backgroundColor: THEME.background, borderRadius: 20, overflow: 'hidden', padding: 16 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '700', color: THEME.text },
    error: { color: THEME.error, fontSize: 13 },
    empty: { color: THEME.textSecondary, fontSize: 13, textAlign: 'center', marginVertical: 20 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    rcaNumber: { fontFamily: 'monospace', fontSize: 12, color: THEME.textSecondary },
    statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: THEME.secondary },
    statusPillText: { fontSize: 11, fontWeight: '600', color: THEME.primary },
    meta: { fontSize: 13, color: THEME.textSecondary, marginTop: 4 },
    actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    actionBtn: { backgroundColor: THEME.primary, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
    actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    actionBtnGhost: { borderWidth: 1, borderColor: THEME.border, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
    actionBtnGhostText: { color: THEME.textSecondary, fontWeight: '600', fontSize: 13 },
});
