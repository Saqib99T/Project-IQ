import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Ticket Filter Modal
export const TicketFilterModal = ({ visible, onClose, onSelect }) => {
    const filters = [
        { id: 1, label: '🆕 New' },
        { id: 2, label: '⚙️ Processing' },
        { id: 4, label: '⏳ Pending' },
        { id: 10, label: '👍 Approved' },
        { id: 5, label: '✅ Solved' },
        { id: 6, label: '🔒 Closed' },
    ];

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>Filter Tickets</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close-circle" size={24} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.grid}>
                        {filters.map((f) => (
                            <TouchableOpacity
                                key={f.id}
                                style={styles.gridItem}
                                onPress={() => { onSelect(f.id); onClose(); }}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.gridText}>{f.label}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <TouchableOpacity style={styles.cancelFooter} onPress={onClose}>
                        <Text style={styles.cancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

// Ticket ID Input Modal
export const TicketIdModal = ({ visible, onClose, onSubmit }) => {
    const [ticketId, setTicketId] = useState('');

    const handleSubmit = () => {
        if (ticketId.trim()) {
            onSubmit(ticketId.trim());
            setTicketId('');
            onClose();
        }
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>View Ticket</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Ionicons name="close-circle" size={24} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>
                    <View style={styles.form}>
                        <Text style={styles.label}>Ticket Number <Text style={{ color: '#ef4444' }}>*</Text></Text>
                        <TextInput
                            style={styles.textInput}
                            value={ticketId}
                            onChangeText={setTicketId}
                            placeholder="e.g. 12345"
                            keyboardType="number-pad"
                            autoFocus
                        />
                        <View style={styles.btnRow}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                                <Text style={styles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.submitBtn, !ticketId.trim() && styles.disabledBtn]}
                                onPress={handleSubmit}
                                disabled={!ticketId.trim()}
                            >
                                <Text style={styles.submitBtnText}>Show</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    card: {
        width: '100%',
        maxWidth: 380,
        backgroundColor: '#fff',
        borderRadius: 20,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        backgroundColor: '#f9fafb',
    },
    modalTitle: { fontSize: 16, fontWeight: '600', color: '#1f2937' },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 16,
        gap: 10,
    },
    gridItem: {
        width: '47%',
        padding: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 14,
        backgroundColor: '#fff',
    },
    gridText: { fontSize: 14, color: '#374151' },
    cancelFooter: {
        padding: 16,
        backgroundColor: '#f9fafb',
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        alignItems: 'flex-end',
    },
    cancelText: { color: '#6b7280', fontWeight: '500' },
    form: { padding: 20 },
    label: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 },
    textInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#111',
        backgroundColor: '#fff',
    },
    btnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
    cancelBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        alignItems: 'center',
    },
    cancelBtnText: { color: '#374151', fontWeight: '500', fontSize: 15 },
    submitBtn: {
        flex: 1,
        paddingVertical: 14,
        backgroundColor: '#000',
        borderRadius: 12,
        alignItems: 'center',
    },
    submitBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    disabledBtn: { opacity: 0.4 },
});
