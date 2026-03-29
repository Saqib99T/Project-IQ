import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { THEME } from '../config';

const MessageBubble = ({ message, onButtonClick, onFeedback }) => {
    const [feedbackGiven, setFeedbackGiven] = React.useState(null);
    const isBot = message.sender === 'bot';

    const handleFeedback = (type) => {
        setFeedbackGiven(type);
        onFeedback?.(message.id, type);
    };

    const mdStyles = {
        body: { color: THEME.text, fontSize: 16, lineHeight: 24, padding: 0, margin: 0 },
        strong: { fontWeight: '700' },
        em: { fontStyle: 'italic' },
        bullet_list: { marginLeft: 4, marginVertical: 4 },
        ordered_list: { marginLeft: 4, marginVertical: 4 },
        list_item: { marginVertical: 2 },
        link: { color: THEME.primary, textDecorationLine: 'underline' },
        heading1: { fontSize: 22, fontWeight: '700', marginVertical: 8, color: '#111' },
        heading2: { fontSize: 18, fontWeight: '600', marginVertical: 6, color: '#111' },
        heading3: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: '#111' },
        table: { borderWidth: 1, borderColor: THEME.border, borderRadius: 12, marginVertical: 12 },
        thead: { backgroundColor: '#f9fafb' },
        th: { padding: 10, fontWeight: '600', fontSize: 14, color: '#374151' },
        td: { padding: 10, fontSize: 14, color: '#4b5563', borderTopWidth: 1, borderColor: THEME.border },
        code_inline: { backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontFamily: 'monospace', fontSize: 14, color: THEME.text },
        fence: { backgroundColor: '#f8fafc', padding: 16, borderRadius: 12, marginVertical: 12, borderWidth: 1, borderColor: '#e2e8f0' },
        code_block: { fontFamily: 'monospace', fontSize: 13, color: '#0f172a' },
    };

    return (
        <View style={[styles.row, isBot ? styles.botRow : styles.userRow]}>
            {/* Avatar */}
            {isBot && (
                <View style={styles.botAvatar}>
                    <Ionicons name="sparkles" size={16} color="#ffffff" />
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
                                color={feedbackGiven === 'up' ? THEME.success : THEME.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => handleFeedback('down')}
                            style={[styles.feedbackBtn, feedbackGiven === 'down' && styles.feedbackActive]}
                        >
                            <Ionicons
                                name={feedbackGiven === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
                                size={14}
                                color={feedbackGiven === 'down' ? THEME.error : THEME.textSecondary}
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
        marginVertical: 12,
        paddingHorizontal: 8,
    },
    botRow: { justifyContent: 'flex-start' },
    userRow: { justifyContent: 'flex-end', marginLeft: 40 },
    botAvatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: THEME.primary,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
        marginTop: 2,
    },
    bubble: {
        flex: 1,
        borderRadius: 24,
    },
    botBubble: {
        backgroundColor: 'transparent',
    },
    userBubble: {
        backgroundColor: THEME.userBubble,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 24,
    },
    buttonsContainer: {
        marginTop: 10,
        gap: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    actionButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: THEME.primary,
        shadowColor: THEME.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 2,
    },
    actionButtonText: {
        fontSize: 13,
        color: '#ffffff',
        fontWeight: '600',
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
