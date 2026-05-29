import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Clipboard, Image } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { THEME } from '../config';
import { useTheme } from '../context/ThemeContext';

const extractYouTubeInfo = (video) => {
    if (!video) return { id: '', start: 0, title: '' };
    const url = typeof video === 'string' ? video : (video.url || video.youtube_id || '');
    const title = typeof video === 'object' ? (video.title || '') : '';

    // Extract video ID
    const idPatterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];
    let videoId = '';
    for (const pattern of idPatterns) {
        const match = url.match(pattern);
        if (match) { videoId = match[1]; break; }
    }

    // Extract start time from URL (?t=123, &t=123, &start=123) or from object property
    let startTime = 0;
    const timeMatch = url.match(/[?&](?:t|start)=(\d+)/);
    if (timeMatch) {
        startTime = parseInt(timeMatch[1], 10);
    } else if (typeof video === 'object' && video.start_time) {
        startTime = parseInt(video.start_time, 10) || 0;
    }

    return { id: videoId, start: startTime, title };
};

const MessageBubble = ({ message, onButtonClick, onFeedback, readonly, initialFeedback, apiBaseUrl = '' }) => {
    const { theme: THEME } = useTheme();
    const styles = useMemo(() => makeStyles(THEME), [THEME]);
    const [feedbackGiven, setFeedbackGiven] = useState(initialFeedback || null);
    const isBot = message.sender === 'bot';
    const isOperator = message.sender === 'operator';

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
        heading1: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: THEME.text },
        heading2: { fontSize: 16, fontWeight: '600', marginVertical: 4, color: THEME.text },
        heading3: { fontSize: 14, fontWeight: '600', marginVertical: 3, color: THEME.text },
        table: { borderWidth: 1, borderColor: THEME.border, borderRadius: 8, marginVertical: 8 },
        thead: { backgroundColor: THEME.userBubble },
        th: { padding: 8, fontWeight: '600', fontSize: 13, color: THEME.text },
        td: { padding: 8, fontSize: 13, color: THEME.textSecondary, borderTopWidth: 1, borderColor: THEME.border },
        code_inline: { backgroundColor: THEME.userBubble, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, fontFamily: 'monospace', fontSize: 13, color: THEME.text },
        fence: { backgroundColor: THEME.userBubble, padding: 12, borderRadius: 8, marginVertical: 8, borderWidth: 1, borderColor: THEME.border },
        code_block: { fontFamily: 'monospace', fontSize: 12, color: THEME.text },
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

    const videoInfo = message.video ? extractYouTubeInfo(message.video) : null;
    const videoUrl = videoInfo?.id ? `https://www.youtube.com/embed/${videoInfo.id}?rel=0${videoInfo.start > 0 ? `&start=${videoInfo.start}` : ''}` : null;
    const chartData = message.chart;
    const chartMax = chartData ? Math.max(...(chartData.data || [1]), 1) : 1;

    return (
        <View style={[styles.row, (isBot || isOperator) ? styles.botRow : styles.userRow]}>
            {/* Bot avatar */}
            {isBot && (
                <View style={styles.botAvatar}>
                    <Ionicons name="sparkles" size={15} color="#1a73e8" />
                </View>
            )}
            {/* Operator avatar */}
            {isOperator && (
                <View style={styles.operatorAvatar}>
                    <Ionicons name="person" size={15} color="#fff" />
                </View>
            )}

            <View style={[styles.content, (isBot || isOperator) ? styles.botContent : styles.userContent]}>
                {isOperator && message.operator_name && (
                    <Text style={styles.operatorName}>{message.operator_name}</Text>
                )}
                <View style={[styles.bubble, isBot ? styles.botBubble : isOperator ? styles.operatorBubble : styles.userBubble]}>

                    {/* Message text */}
                    {message.text ? (
                        <Markdown
                            style={mdStyles}
                            onLinkPress={readonly ? () => false : (url) => {
                                const resolved = url.startsWith('/') ? `${apiBaseUrl}${url}` : url;
                                Linking.openURL(resolved);
                                return false;
                            }}
                            rules={{
                                image: (node) => {
                                    const src = node.attributes?.src || '';
                                    const resolved = src.startsWith('/') ? `${apiBaseUrl}${src}` : src;
                                    return (
                                        <TouchableOpacity key={node.key} onPress={() => Linking.openURL(resolved)} activeOpacity={0.8}
                                            style={{ width: '30%', marginRight: 4, marginBottom: 4 }}>
                                            <Image
                                                source={{ uri: resolved }}
                                                style={{ width: '100%', height: 70, borderRadius: 6, resizeMode: 'cover', backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb' }}
                                            />
                                        </TouchableOpacity>
                                    );
                                },
                            }}
                        >
                            {message.text}
                        </Markdown>
                    ) : null}

                    {/* YouTube video */}
                    {videoUrl && (
                        <View style={{ marginTop: 8 }}>
                            <View style={styles.videoLabelRow}>
                                <Ionicons name="logo-youtube" size={14} color="#6b7280" />
                                <Text style={styles.videoLabel}>
                                    {videoInfo?.title || 'Video Tutorial'}
                                    {videoInfo?.start > 0 ? ` (starts at ${Math.floor(videoInfo.start / 60)}:${String(videoInfo.start % 60).padStart(2, '0')})` : ''}
                                </Text>
                            </View>
                            <View style={styles.videoContainer}>
                                <WebView
                                    source={{ uri: videoUrl }}
                                    style={styles.video}
                                    allowsFullscreenVideo
                                    javaScriptEnabled
                                />
                            </View>
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
                                size={15}
                                color={feedbackGiven === 'up' ? '#1a73e8' : THEME.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => handleFeedback('down')} style={styles.feedbackBtn}>
                            <Ionicons
                                name={feedbackGiven === 'down' ? 'thumbs-down' : 'thumbs-down-outline'}
                                size={15}
                                color={feedbackGiven === 'down' ? '#e53e3e' : THEME.textSecondary}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.feedbackBtn}>
                            <Ionicons name="refresh-outline" size={15} color={THEME.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.feedbackBtn} onPress={handleCopy}>
                            <Ionicons name="copy-outline" size={15} color={THEME.textSecondary} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </View>
    );
};

const makeStyles = (THEME) => StyleSheet.create({
    row: { flexDirection: 'row', marginVertical: 4, paddingHorizontal: 8 },
    botRow: { justifyContent: 'flex-start', alignItems: 'flex-start' },
    userRow: { justifyContent: 'flex-end', marginLeft: 60 },

    botAvatar: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: '#e8f0fe',
        justifyContent: 'center', alignItems: 'center',
        marginRight: 8, marginTop: 2, flexShrink: 0,
    },
    operatorAvatar: {
        width: 24, height: 24, borderRadius: 12,
        backgroundColor: '#16a34a',
        justifyContent: 'center', alignItems: 'center',
        marginRight: 8, marginTop: 2, flexShrink: 0,
    },
    operatorName: {
        fontSize: 11, color: '#16a34a', fontWeight: '600',
        marginBottom: 2, marginLeft: 2,
    },

    content: { flexShrink: 1 },
    botContent: { flex: 1 },
    userContent: {},

    bubble: { borderRadius: 18 },
    botBubble: { backgroundColor: 'transparent', paddingRight: 8 },
    operatorBubble: { backgroundColor: '#f0fdf4', paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#bbf7d0' },
    userBubble: { backgroundColor: THEME.userBubble, paddingHorizontal: 14, paddingVertical: 10 },

    // Video
    videoLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
    videoLabel: { fontSize: 12, color: '#6b7280', flexShrink: 1 },
    videoContainer: { borderRadius: 10, overflow: 'hidden', height: 180 },
    video: { flex: 1 },

    // Chart
    chartContainer: {
        marginTop: 10, padding: 10,
        backgroundColor: THEME.userBubble, borderRadius: 10,
        borderWidth: 1, borderColor: THEME.border,
    },
    chartTitle: { fontSize: 12, fontWeight: '600', color: THEME.text, marginBottom: 8 },
    chartRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3, gap: 6 },
    chartLabel: { fontSize: 11, color: THEME.textSecondary, width: 72 },
    chartBarTrack: { flex: 1, height: 6, backgroundColor: THEME.border, borderRadius: 3, overflow: 'hidden' },
    chartBar: { height: 6, backgroundColor: THEME.primary, borderRadius: 3 },
    chartValue: { fontSize: 11, color: THEME.text, width: 24, textAlign: 'right' },

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
    bannerSystem: { backgroundColor: THEME.userBubble },
    bannerIcon: { fontSize: 14, lineHeight: 20 },
});

export default MessageBubble;
