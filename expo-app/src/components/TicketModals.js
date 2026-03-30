import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../config';

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

// Simple Custom Dropdown for React Native without external Picker dependencies
const CustomSelect = ({ label, options, selectedValue, onSelect }) => {
    return (
        <View style={{ marginBottom: 12 }}>
            <Text style={styles.label}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
                {options.map((opt) => {
                    const isActive = selectedValue === opt;
                    return (
                        <TouchableOpacity
                            key={opt}
                            onPress={() => onSelect(opt)}
                            style={[
                                styles.chip,
                                isActive ? styles.chipActive : styles.chipInactive,
                            ]}
                        >
                            <Text style={isActive ? styles.chipTextActive : styles.chipTextInactive}>
                                {opt}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );
};

// Ticket Create Form Modal - Chatbot style
export const TicketFormModal = ({ visible, onClose, onSubmit }) => {
    const [formData, setFormData] = useState({
        title: '', detail: '', priority: 'Medium', urgency: 'Medium', category: 'Hardware'
    });
    const [error, setError] = useState('');
    const [showConfirm, setShowConfirm] = useState(false);

    const priorityOptions = ['Minor', 'Major', 'Medium', 'High', 'Critical'];
    const urgencyOptions = ['Low', 'Medium', 'High'];
    const categoryOptions = ['Hardware', 'Software', 'Network', 'Other'];

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (field === 'title' && value.trim()) setError('');
    };

    const handleInitialSubmit = () => {
        if (!formData.title.trim()) {
            setError('Title is required');
            return;
        }
        setShowConfirm(true);
    };

    const handleConfirm = () => {
        onSubmit(formData);
        
        // Reset form fully on success
        setTimeout(() => {
            setFormData({ title: '', detail: '', priority: 'Medium', urgency: 'Medium', category: 'Hardware' });
            setShowConfirm(false);
            onClose();
        }, 300);
    };
    
    const handleClose = () => {
        setShowConfirm(false);
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <View style={styles.overlay}>
                <View style={[styles.card, { maxWidth: 450 }]}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>
                            <Text style={{fontSize: 16}}>📝</Text> New Ticket
                        </Text>
                        <TouchableOpacity onPress={handleClose}>
                            <Ionicons name="close-circle" size={24} color="#9ca3af" />
                        </TouchableOpacity>
                    </View>
                    
                    <ScrollView style={styles.formScroll}>
                        {!showConfirm ? (
                            <View style={styles.form}>
                                <Text style={styles.label}>Title <Text style={{ color: '#ef4444' }}>*</Text></Text>
                                <TextInput
                                    style={[styles.textInput, error ? { borderColor: '#ef4444' } : null]}
                                    value={formData.title}
                                    onChangeText={(val) => handleChange('title', val)}
                                    placeholder="Brief summary of the issue"
                                />
                                {error ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{error}</Text> : null}

                                <Text style={[styles.label, { marginTop: 12 }]}>Detail</Text>
                                <TextInput
                                    style={[styles.textInput, { height: 75, textAlignVertical: 'top' }]}
                                    value={formData.detail}
                                    onChangeText={(val) => handleChange('detail', val)}
                                    placeholder="Describe the issue in detail..."
                                    multiline
                                />

                                <View style={{ marginTop: 16 }}>
                                    <CustomSelect 
                                        label="Category" 
                                        options={categoryOptions} 
                                        selectedValue={formData.category} 
                                        onSelect={(v) => handleChange('category', v)} 
                                    />
                                    <CustomSelect 
                                        label="Priority" 
                                        options={priorityOptions} 
                                        selectedValue={formData.priority} 
                                        onSelect={(v) => handleChange('priority', v)} 
                                    />
                                    <CustomSelect 
                                        label="Urgency" 
                                        options={urgencyOptions} 
                                        selectedValue={formData.urgency} 
                                        onSelect={(v) => handleChange('urgency', v)} 
                                    />
                                </View>

                                <View style={styles.btnRow}>
                                    <TouchableOpacity style={styles.cancelBtn} onPress={handleClose}>
                                        <Text style={styles.cancelBtnText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.submitBtn} onPress={handleInitialSubmit}>
                                        <Text style={styles.submitBtnText}>Submit</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.confirmContainer}>
                                <View style={styles.iconCircle}>
                                    <Ionicons name="alert-circle" size={32} color={THEME.primary} />
                                </View>
                                <Text style={styles.confirmTitle}>Confirm Submission?</Text>
                                <Text style={styles.confirmSubtitle}>Are you sure you want to create this ticket?</Text>
                                
                                <View style={styles.confirmBox}>
                                    <Text style={styles.confirmRow}><Text style={styles.confirmBold}>Title:</Text> {formData.title}</Text>
                                    <Text style={styles.confirmRow}><Text style={styles.confirmBold}>Category:</Text> {formData.category}</Text>
                                    <Text style={styles.confirmRow}><Text style={styles.confirmBold}>Priority:</Text> {formData.priority}</Text>
                                </View>
                                
                                <View style={styles.btnRow}>
                                    <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowConfirm(false)}>
                                        <Text style={styles.cancelBtnText}>Back</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.submitBtn, { backgroundColor: THEME.success }]} onPress={handleConfirm}>
                                        <Text style={styles.submitBtnText}>Yes, Create It</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </ScrollView>
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
        maxHeight: '85%',
        backgroundColor: THEME.background,
        borderRadius: 20,
        overflow: 'hidden',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: THEME.border,
        backgroundColor: THEME.background,
    },
    modalTitle: { fontSize: 17, fontWeight: '700', color: THEME.text },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 16,
        gap: 10,
    },
    gridItem: {
        width: '47%',
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: THEME.border,
        borderRadius: 14,
        backgroundColor: THEME.background,
    },
    gridText: { fontSize: 14, color: THEME.text, fontWeight: '500' },
    cancelFooter: {
        padding: 16,
        backgroundColor: THEME.background,
        borderTopWidth: 1,
        borderTopColor: THEME.border,
        alignItems: 'flex-end',
    },
    cancelText: { color: THEME.textSecondary, fontWeight: '500' },
    formScroll: {
        flexGrow: 0,
    },
    form: { padding: 20 },
    label: { fontSize: 14, fontWeight: '600', color: THEME.text, marginBottom: 8 },
    textInput: {
        borderWidth: 1,
        borderColor: THEME.border,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: THEME.text,
        backgroundColor: '#ffffff',
    },
    btnRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
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
        backgroundColor: THEME.primary,
        borderRadius: 12,
        alignItems: 'center',
    },
    submitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
    disabledBtn: { opacity: 0.4 },
    
    // Custom Select Styles
    chip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginRight: 8,
        borderWidth: 1,
    },
    chipInactive: {
        backgroundColor: '#ffffff',
        borderColor: THEME.border,
    },
    chipActive: {
        backgroundColor: THEME.secondary,
        borderColor: THEME.primary,
    },
    chipTextInactive: {
        color: THEME.textSecondary,
        fontSize: 14,
    },
    chipTextActive: {
        color: THEME.primary,
        fontSize: 14,
        fontWeight: '700',
    },
    
    // Confirm Styles
    confirmContainer: {
        padding: 24,
        alignItems: 'center',
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: THEME.secondary,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    confirmTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1f2937',
        marginBottom: 8,
    },
    confirmSubtitle: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
        marginBottom: 20,
    },
    confirmBox: {
        width: '100%',
        backgroundColor: '#f9fafb',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    confirmRow: {
        fontSize: 14,
        color: '#4b5563',
        marginBottom: 6,
    },
    confirmBold: {
        fontWeight: '600',
        color: '#374151',
    }
});
