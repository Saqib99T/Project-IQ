import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';

const MessageBubble = ({ message, onButtonClick, onFeedback }) => {
    const [feedbackGiven, setFeedbackGiven] = useState(null);
    const isBot = message.sender === 'bot';

    const handleFeedback = (type) => {
        setFeedbackGiven(type);
        onFeedback?.(message.id, type);
    };

    const mdStyles = {
        body: { color: isBot ? '#1f2937' : '#fff', fontSize: 15, lineHeight: 22 },
        strong: { fontWeight: '700' },
        em: { fontStyle: 'italic' },
        bullet_list: { marginLeft: 4 },
        ordered_list: { marginLeft: 4 },
        list_item: { marginVertical: 2 },
        link: { color: isBot ? '#2563eb' : '#93c5fd', textDecorationLine: 'underline' },
        heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: isBot ? '#111' : '#fff' },
        heading2: { fontSize: 18, fontWeight: '600', marginVertical: 4, color: isBot ? '#111' : '#fff' },
        heading3: { fontSize: 16, fontWeight: '600', marginVertical: 3, color: isBot ? '#111' : '#fff' },
        table: { borderWidth: 1, borderColor: isBot ? '#e5e7eb' : 'rgba(255,255,255,0.3)', borderRadius: 8, marginVertical: 8 },
        thead: { backgroundColor: isBot ? '#f9fafb' : 'rgba(255,255,255,0.1)' },
        th: { padding: 8, fontWeight: '600', fontSize: 13, color: isBot ? '#374151' : '#fff' },
        td: { padding: 8, fontSize: 13, color: isBot ? '#4b5563' : '#e5e7eb', borderTopWidth: 1, borderColor: isBot ? '#e5e7eb' : 'rgba(255,255,255,0.2)' },
        code_inline: { backgroundColor: isBot ? '#f3f4f6' : 'rgba(255,255,255,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 },
        fence: { backgroundColor: isBot ? '#f3f4f6' : 'rgba(255,255,255,0.1)', padding: 12, borderRadius: 8, marginVertical: 8 },
        code_block: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color: isBot ? '#374151' : '#e5e7eb' },
    };

    return (
        <View style={[styles.row, isBot ? styles.botRow : styles.userRow]}>
            {/* Avatar */}
            {isBot && (
                <View style={styles.botAvatar}>
                    <Text style={styles.avatarText}>🤖</Text>
                </View>
            )}

            <View style={[styles.bubble, isBot ? styles.botBubble : styles.userBubble]}>
                {/* Message content */}
                {message.text ? (
                    <Markdown
                        style={mdStyles}
                        onLinkPress={(url) => { Linking.openURL(url); return false; }}
                    >
                        {message.text}
                    </Markdown>
                ) : null}

                {/* Action buttons from Rasa */}
                {message.buttons && message.buttons.length > 0 && (
                    <View style={styles.buttonsContainer}>
                        {message.buttons.map((btn, idx) => (
                            <TouchableOpacity
                                key={idx}
                                style={styles.actionButton}
                                onPress={() => onButtonClick?.(btn.payload)}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.actionButtonText}>{btn.title}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}

                {/* Feedback buttons for bot messages */}
                {isBot && message.id !== 'init' && (
                    <View style={styles.feedbackRow}>
                        <TouchableOpacity
                            onPress={() => handleFeedback('up')}
                            style={[styles.feedbackBtn, feedbackGiven === 'up' && styles.feedbackActive]}
                        >
                            <Ionicons
                                name={feedbackGiven === 'up' ? 'thumbs-up' : 'thumbs-up-outline'}
                                size={14}
                                color={feedbackGiven === 'up' ? '#10b981' : '#9ca3af'}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => handleFeedback('down')}
                            style={[styles.feedbackBtn, feedbackGiven === 'down' && styles.feedbackActive]}
                        >
                            <Ionicons
                                name={feedbackGiven === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
                                size={14}
                                color={feedbackGiven === 'down' ? '#ef4444' : '#9ca3af'}
                            />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </View>
    );
};

import { Platform } from 'react-native';

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        marginVertical: 4,
        paddingHorizontal: 4,
    },
    botRow: { justifyContent: 'flex-start' },
    userRow: { justifyContent: 'flex-end' },
    botAvatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
        marginTop: 4,
    },
    avatarText: { fontSize: 16 },
    bubble: {
        maxWidth: '80%',
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    botBubble: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderBottomLeftRadius: 4,
    },
    userBubble: {
        backgroundColor: '#111',
        borderBottomRightRadius: 4,
    },
    buttonsContainer: {
        marginTop: 10,
        gap: 6,
    },
    actionButton: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        backgroundColor: '#f9fafb',
    },
    actionButtonText: {
        fontSize: 13,
        color: '#374151',
        fontWeight: '500',
    },
    feedbackRow: {
        flexDirection: 'row',
        gap: 4,
        marginTop: 8,
        justifyContent: 'flex-end',
    },
    feedbackBtn: {
        padding: 6,
        borderRadius: 8,
    },
    feedbackActive: {
        backgroundColor: '#f3f4f6',
    },
});

export default MessageBubble;
