import React, { useState } from 'react';
import {
    Modal, View, Text, TouchableOpacity, TextInput,
    StyleSheet, Alert, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../config';

const SessionFeedbackModal = ({ visible, onClose, onSubmit, isLoading = false }) => {
    const [rating, setRating] = useState(0);
    const [comments, setComments] = useState('');

    const handleSubmit = () => {
        if (rating === 0) {
            Alert.alert('Rating Required', 'Please select a rating (1-5 stars)');
            return;
        }

        onSubmit({ rating, comments });
        setRating(0);
        setComments('');
    };

    const handleClose = () => {
        setRating(0);
        setComments('');
        onClose();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleClose}
        >
            <View style={styles.overlay}>
                <View style={styles.card}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>Rate Your Experience</Text>
                        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                            <Ionicons name="close" size={24} color={THEME.text} />
                        </TouchableOpacity>
                    </View>

                    {/* Message */}
                    <Text style={styles.message}>
                        How helpful was this conversation?
                    </Text>

                    {/* Star Rating */}
                    <View style={styles.ratingContainer}>
                        {[1, 2, 3, 4, 5].map((star) => (
                            <TouchableOpacity
                                key={star}
                                onPress={() => setRating(star)}
                                style={styles.starBtn}
                            >
                                <Ionicons
                                    name={star <= rating ? 'star' : 'star-outline'}
                                    size={36}
                                    color={star <= rating ? '#fbbf24' : '#d1d5db'}
                                />
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* Comments */}
                    <Text style={styles.label}>Comments (optional)</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Tell us how we can improve..."
                        placeholderTextColor="#9ca3af"
                        value={comments}
                        onChangeText={setComments}
                        multiline
                        maxLength={500}
                    />
                    <Text style={styles.charCount}>{comments.length}/500</Text>

                    {/* Buttons */}
                    <View style={styles.buttonGroup}>
                        <TouchableOpacity
                            style={[styles.button, styles.cancelBtn]}
                            onPress={handleClose}
                            disabled={isLoading}
                        >
                            <Text style={styles.cancelBtnText}>Skip</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.button, styles.submitBtn, isLoading && styles.submitBtnDisabled]}
                            onPress={handleSubmit}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                                <Text style={styles.submitBtnText}>Submit</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
        padding: 16,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 24,
        marginBottom: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: THEME.text,
    },
    closeBtn: {
        padding: 8,
    },
    message: {
        fontSize: 14,
        color: THEME.textSecondary,
        marginBottom: 20,
        textAlign: 'center',
    },
    ratingContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        marginBottom: 24,
    },
    starBtn: {
        padding: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        color: THEME.text,
        marginBottom: 8,
    },
    input: {
        borderWidth: 1,
        borderColor: THEME.border,
        borderRadius: 12,
        padding: 12,
        fontSize: 14,
        color: THEME.text,
        height: 100,
        textAlignVertical: 'top',
        marginBottom: 8,
    },
    charCount: {
        fontSize: 12,
        color: THEME.textSecondary,
        textAlign: 'right',
        marginBottom: 20,
    },
    buttonGroup: {
        flexDirection: 'row',
        gap: 12,
    },
    button: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelBtn: {
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: THEME.border,
    },
    cancelBtnText: {
        color: THEME.textSecondary,
        fontSize: 15,
        fontWeight: '600',
    },
    submitBtn: {
        backgroundColor: THEME.primary,
    },
    submitBtnDisabled: {
        opacity: 0.6,
    },
    submitBtnText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },
});

export default SessionFeedbackModal;
