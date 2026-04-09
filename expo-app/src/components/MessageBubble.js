import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Clipboard } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { THEME } from '../config';

const getYouTubeEmbedUrl = (video) => {
    if (!video) return null;
    const url = typeof video === 'string' ? video : (video.url || video.youtube_id || '');
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    const videoId = match ? match[1] : url;
    const start = video.start_time ? `?start=${video.start_time}` : '';
    return videoId ? `https://www.youtube.com/embed/${videoId}${start}` : null;
};

const MessageBubble = ({ message, onButtonClick, onFeedback, readonly, initialFeedback }) => {
    const [feedbackGiven, setFeedbackGiven] = useState(initialFeedback || null);
    const isBot = message.sender === 'bot';

    const handleFeedback = (type) => {
        if (readonly) return;
        setFeedbackGiven(type);
        onFeedback?.(message.id, type);
    };

    const handleCopy = () => {
        Clipboard.setString(message.text || '');
    };

    const mdStyles = {
        body: { color: THEME.text, fontSize: 14, lineHeight: 21, padding: 0, margin: 0 },
        strong: { fontWeight: '700' },
        em: { fontStyle: 'italic' },
        bullet_list: { marginLeft: 4, marginVertical: 2 },
        ordered_list: { marginLeft: 4, marginVertical: 2 },
        list_item: { marginVertical: 1 },
        link: { color: readonly ? THEME.textSecondary : THEME.primary, textDecorationLine: readonly ? 'none' : 'underline' },
        heading1: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#111' },
        heading2: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: '#111' },
        heading3: { fontSize: 14, fontWeight: '600', marginVertical: 3, color: '#111' },
        table: { borderWidth: 1, borderColor: THEME.border, borderRadius: 8, marginVertical: 8 },
        thead: { backgroundColor: '#f9fafb' },
        th: { padding: 8, fontWeight: '600', fontSize: 13, color: '#374151' },
        td: { padding: 8, fontSize: 13, color: '#4b5563', borderTopWidth: 1, borderColor: THEME.border },
        code_inline: { backgroundColor: '#f3f4f6', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, fontFamily: 'monospace', fontSize: 13, color: THEME.text },
        fence: { backgroundColor: '#f8fafc', padding: 12, borderRadius: 8, marginVertical: 8, borderWidth: 1, borderColor: '#e2e8f0' },
        code_block: { fontFamily: 'monospace', fontSize: 12, color: '#0f172a' },
    };

    // Warning / system banner
    if (message.type === 'warning' || message.type === 'system') {
        const isSystem = message.type === 'system';
        return (
            <View style={styles.bannerWrapper}>
                <View style={[styles.banner, isSystem ? styles.bannerSystem : styles.bannerWarning]}>
                    <Text style={styles.bannerIcon}>{isSystem ? '💬' : '⏰'}</Text>
                    <Markdown style={{ body: { fontSize: 13, color: isSystem ? '#6b7280' : '#92400e', lineHeight: 20, flexShrink: 1 }, strong: { fontWeight: '700' } }}>
                        {message.text}
                    </Markdown>
                </View>
            </View>
        );
    }

    const videoUrl = message.video ? getYouTubeEmbedUrl(message.video) : null;
    const chartData = message.chart;
    const chartMax = chartData ? Math.max(...(chartData.data || [1]), 1) : 1;

    return (
        <View style={[styles.row, isBot ? styles.botRow : styles.userRow]}>
            {/* Bot avatar */}
            {isBot && (
                <View style={styles.botAvatar}>
                    <Ionicons name="sparkles" size={15} color="#1a73e8" />
                </View>
            )}

            <View style={[styles.content, isBot ? styles.botContent : styles.userContent]}>
                <View style={[styles.bubble, isBot ? styles.botBubble : styles.userBubble]}>

                    {/* Message text */}
                    {message.text ? (
                        <Markdown
                            style={mdStyles}
                            onLinkPress={readonly ? () => false : (url) => { Linking.openURL(url); return false; }}
                        >
                            {message.text}
                        </Markdown>
                    ) : null}

                    {/* YouTube video */}
                    {videoUrl && (
                        <View style={styles.videoContainer}>
                            <WebView
                                source={{ uri: videoUrl }}
                                style={styles.video}
                                allowsFullscreenVideo
                                javaScriptEnabled
                            />
                        </View>
                    )}

                    {/* Chart — inline bar chart */}
                    {chartData && (
                        <View style={styles.chartContainer}>
                            {chartData.title ? <Text style={styles.chartTitle}>{chartData.title}</Text> : null}
                            {(chartData.labels || []).map((label, i) => (
                                <View key={i} style={styles.chartRow}>
                                    <Text style={styles.chartLabel} numberOfLines={1}>{label}</Text>
                                    <View style={styles.chartBarTrack}>
                                        <View style={[styles.chartBar, { width: `${Math.round(((chartData.data?.[i] || 0) / chartMax) * 100)}%` }]} />
                                    </View>
                                    <Text style={styles.chartValue}>{chartData.data?.[i]}</Text>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Action buttons — wrapping layout, hidden in readonly */}
                    {!readonly && message.buttons && message.buttons.length > 0 && (
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

                    {/* Ticket form — archived indicator in readonly */}
                    {readonly && message.ticket_form && (
                        <Text style={styles.archivedNote}>📋 Ticket form (archived)</Text>
                    )}
                </View>

                {/* Feedback row — hidden in readonly */}
                {isBot && message.id !== 'init' && !readonly && (
                    <View style={styles.feedbackRow}>
                        <TouchableOpacity onPress={() => handleFeedback('up')} style={styles.feedbackBtn}>
                            <Ionicons
                                name={feedbackGiven === 'up' ? 'thumbs-up' : 'thumbs-up-outline'}
                                size={16}
                                color={feedbackGiven === 'up' ? '#1a73e8' : THEME.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleFeedback('down')} style={styles.feedbackBtn}>
                            <Ionicons
                                name={feedbackGiven === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
                                size={16}
                                color={feedbackGiven === 'down' ? '#e53e3e' : THEME.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.feedbackBtn} onPress={handleCopy}>
                            <Ionicons name="copy-outline" size={16} color={THEME.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 8 },
    botRow: { justifyContent: 'flex-start', alignItems: 'flex-start' },
    userRow: { justifyContent: 'flex-end', marginLeft: 60 },

    botAvatar: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: '#e8f0fe',
        justifyContent: 'center', alignItems: 'center',
        marginRight: 8, marginTop: 2, flexShrink: 0,
    },

    content: { flexShrink: 1 },
    botContent: { flex: 1 },
    userContent: {},

    bubble: { borderRadius: 18 },
    botBubble: { backgroundColor: 'transparent', paddingRight: 8 },
    userBubble: { backgroundColor: THEME.userBubble, paddingHorizontal: 14, paddingVertical: 10 },

    // Video
    videoContainer: { marginTop: 8, borderRadius: 10, overflow: 'hidden', height: 180 },
    video: { flex: 1 },

    // Chart
    chartContainer: {
        marginTop: 10, padding: 10,
        backgroundColor: '#f8fafc', borderRadius: 10,
        borderWidth: 1, borderColor: '#e2e8f0',
    },
    chartTitle: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 8 },
    chartRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3, gap: 6 },
    chartLabel: { fontSize: 11, color: '#6b7280', width: 72 },
    chartBarTrack: { flex: 1, height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, overflow: 'hidden' },
    chartBar: { height: 6, backgroundColor: THEME.primary, borderRadius: 3 },
    chartValue: { fontSize: 11, color: '#374151', width: 24, textAlign: 'right' },

    archivedNote: { fontSize: 11, color: '#9ca3af', marginTop: 6, fontStyle: 'italic' },

    // Buttons
    buttonsContainer: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    actionButton: {
        paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: 16, borderWidth: 1,
        borderColor: THEME.primary, backgroundColor: 'transparent',
    },
    actionButtonText: { fontSize: 12, color: THEME.primary, fontWeight: '500' },

    // Feedback
    feedbackRow: { flexDirection: 'row', gap: 2, marginTop: 4 },
    feedbackBtn: { padding: 5, borderRadius: 14 },

    // Banners
    bannerWrapper: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 16 },
    banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, maxWidth: '100%' },
    bannerWarning: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a' },
    bannerSystem: { backgroundColor: '#f3f4f6' },
    bannerIcon: { fontSize: 14, lineHeight: 20 },
});

export default MessageBubble;
