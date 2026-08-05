import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Clipboard, Image } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { THEME } from '../config';
import { useTheme } from '../context/ThemeContext';

// Per-message RTL: render Arabic (and other RTL scripts) right-to-left. Mirrors
// the web widget's dir="auto" — direction follows the message content so a
// mixed-language chat stays correct without any global layout flip.
const _RTL_RE = /[؀-ۿݐ-ݿࢠ-ࣿ֐-׿ﭐ-﷿ﹰ-﻿]/;

// In-WebView SVG drawer for line / area / pie charts (no react-native-svg dep).
// Reads a JSON blob `D` and renders into #c, legend into #l — mirrors the web
// ChartRenderer's line/area/pie output.
const _CHART_DRAWER = "var W=300,H=180,P=28;function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}document.getElementById('t').textContent=D.title||'';var svg='',lg='';if(D.type==='pie'){var data=(D.datasets[0]||{}).data||[];var tot=data.reduce(function(a,b){return a+(+b||0)},0)||1;var cx=90,cy=90,r=70,a0=-Math.PI/2,paths='';for(var i=0;i<data.length;i++){var frac=(+data[i]||0)/tot,a1=a0+frac*2*Math.PI,x0=cx+r*Math.cos(a0),y0=cy+r*Math.sin(a0),x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1),large=frac>0.5?1:0,col=D.palette[i%D.palette.length];paths+='<path d=\"M'+cx+','+cy+' L'+x0.toFixed(1)+','+y0.toFixed(1)+' A'+r+','+r+' 0 '+large+' 1 '+x1.toFixed(1)+','+y1.toFixed(1)+' Z\" fill=\"'+col+'\"/>';a0=a1;lg+='<span><i style=\"background:'+col+'\"></i>'+esc(D.labels[i]||('#'+(i+1)))+' '+Math.round(frac*100)+'%</span>';}svg='<svg viewBox=\"0 0 180 180\" height=\"170\">'+paths+'</svg>';}else{var all=[];D.datasets.forEach(function(ds){(ds.data||[]).forEach(function(v){all.push(+v||0);});});var mn=Math.min.apply(null,all.concat(0)),mx=Math.max.apply(null,all.concat(1)),rng=(mx-mn)||1,n=D.labels.length||((D.datasets[0]||{}).data||[]).length,cw=W-P*2,ch=H-P*2;function X(i){return P+(n<=1?cw/2:cw*i/(n-1));}function Y(v){return P+ch-((v-mn)/rng)*ch;}var grid='';for(var g=0;g<=4;g++){var yy=P+ch*g/4;grid+='<line x1=\"'+P+'\" y1=\"'+yy+'\" x2=\"'+(W-P)+'\" y2=\"'+yy+'\" stroke=\"'+D.grid+'\" stroke-width=\"1\"/>';}var series='';D.datasets.forEach(function(ds,di){var col=D.palette[di%D.palette.length],d=ds.data||[],pts=d.map(function(v,i){return X(i).toFixed(1)+','+Y(+v||0).toFixed(1);}).join(' ');if(D.type==='area'&&d.length){series+='<polygon points=\"'+X(0).toFixed(1)+','+(P+ch)+' '+pts+' '+X(d.length-1).toFixed(1)+','+(P+ch)+'\" fill=\"'+col+'\" opacity=\"0.15\"/>';}series+='<polyline points=\"'+pts+'\" fill=\"none\" stroke=\"'+col+'\" stroke-width=\"2\"/>';d.forEach(function(v,i){series+='<circle cx=\"'+X(i).toFixed(1)+'\" cy=\"'+Y(+v||0).toFixed(1)+'\" r=\"2.5\" fill=\"'+col+'\"/>';});if(ds.label){lg+='<span><i style=\"background:'+col+'\"></i>'+esc(ds.label)+'</span>';}});var xl='';for(var i=0;i<n;i++){xl+='<text x=\"'+X(i).toFixed(1)+'\" y=\"'+(H-8)+'\" fill=\"'+D.fg+'\" font-size=\"8\" text-anchor=\"middle\">'+esc(D.labels[i]||'')+'</text>';}svg='<svg viewBox=\"0 0 '+W+' '+H+'\" height=\"170\">'+grid+series+xl+'</svg>';}document.getElementById('c').innerHTML=svg;document.getElementById('l').innerHTML=lg;";

function chartHtml(chart, isDark) {
    const bg = isDark ? '#1e2533' : '#ffffff';
    const fg = isDark ? '#e5e7eb' : '#334155';
    const grid = isDark ? '#2e3a4e' : '#e5e7eb';
    const palette = ['#7c3aed', '#2563eb', '#0d9488', '#d97706', '#dc2626', '#16a34a'];
    const datasets = (chart.datasets && chart.datasets.length)
        ? chart.datasets
        : [{ label: chart.title || '', data: chart.data || [] }];
    const payload = JSON.stringify({
        type: (chart.type || 'line').toLowerCase(),
        labels: chart.labels || [], datasets, title: chart.title || '', palette, fg, grid,
    });
    return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<style>html,body{margin:0;padding:0;background:' + bg + ';overflow:hidden;font-family:system-ui,sans-serif}'
        + '#t{color:' + fg + ';font-size:12px;font-weight:600;padding:6px 8px 0}svg{display:block;width:100%}'
        + '.lg{color:' + fg + ';font-size:10px;display:flex;flex-wrap:wrap;gap:8px;padding:2px 8px 6px}'
        + '.lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:3px;vertical-align:middle}</style></head>'
        + '<body><div id="t"></div><div id="c"></div><div id="l" class="lg"></div>'
        + '<script>var D=' + payload + ';' + _CHART_DRAWER + '</script></body></html>';
}
const isRtlText = (text) => typeof text === 'string' && _RTL_RE.test(text);

const PAYLOAD_LABELS = {
    '/create_ticket':          'Create a ticket',
    '/list_tickets':           'List my tickets',
    '/check_status':           'Check ticket status',
    '/help':                   'Help',
    '/request_human_agent':    'Talk to a human agent',
    '/confirm_gdpr_consent':   'I agree to the terms',
    '/deny_gdpr_consent':      'I do not agree',
    '/login':                  'Login',
    '/logout':                 'Logout',
    '/greet':                  'Hello',
    '/hi':                     'Hello',
    '/affirm':                 'Yes',
    '/deny':                   'No',
    '/restart':                'Start over',
    '/out_of_scope':           'Other',
    '/ask_knowledge':          'Search Knowledge Base',
    '/submit_ticket_form':     'Ticket submitted',
    '/show_ticket_graph':      'View ticket graph',
    '/show_chart':             'View chart',
    '/accept_ticket_fallback': 'Create a support ticket',
    '/confirm_handoff':        'Wait in queue',
    '/cancel_handoff':         'Cancel handoff',
    '/kb_not_helpful':         'Not helpful',
    '/kb_show_full_answer':    'Show full answer',
    '/kb_show_full_article':   'Show full article',
    '/feedback_positive':      'Positive feedback',
    '/feedback_negative':      'Negative feedback',
    '/inform':                 'Option selected',
    '/inform_update':          'Update ticket',
    '/stop':                   'Cancel',
    '/clear':                  'Clear session',
    '/verify_resolution':      'Mark as resolved',
    '/update_ticket':          'Update ticket',
    '/list_attachments':       'List attachments',
    '/upload_file':            'Upload file',
    '/rating_1':               'Rating: 1★',
    '/rating_2':               'Rating: 2★',
    '/rating_3':               'Rating: 3★',
    '/rating_4':               'Rating: 4★',
    '/rating_5':               'Rating: 5★',
};

const formatUserMessage = (text) => {
    if (!text || !text.startsWith('/')) return text;
    const key = text.split('{')[0].trim().toLowerCase();
    return PAYLOAD_LABELS[key] || text.slice(1).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
};

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
    const { theme: THEME, isDark } = useTheme();
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

    const rtl = isRtlText(message.text);
    const mdStyles = {
        body: { color: THEME.text, fontSize: 14, lineHeight: 21, padding: 0, margin: 0,
                ...(rtl ? { writingDirection: 'rtl', textAlign: 'right' } : {}) },
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
                    <Markdown style={{ body: { fontSize: 13, color: isSystem ? '#6b7280' : '#92400e', lineHeight: 20, flexShrink: 1, ...(isRtlText(message.text) ? { writingDirection: 'rtl', textAlign: 'right' } : {}) }, strong: { fontWeight: '700' } }}>
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
                            {(isBot || isOperator) ? message.text : formatUserMessage(message.text)}
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

                    {/* Structured ticket list — 3-column cards */}
                    {message.ticketList?.rows?.length > 0 && (
                        <View style={{ marginTop: 4, gap: 6 }}>
                            {message.ticketList.rows.map((r, i) => (
                                <View key={i} style={{ flexDirection: 'row', alignItems: 'stretch', gap: 8,
                                                       borderWidth: 1, borderColor: THEME.border, borderRadius: 8,
                                                       paddingHorizontal: 10, paddingVertical: 8, backgroundColor: THEME.background }}>
                                    {/* Col 1: ticket no + date */}
                                    <View style={{ justifyContent: 'center', minWidth: 60 }}>
                                        <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.text }}>#{r.no}</Text>
                                        <Text style={{ fontSize: 10, color: THEME.textSecondary }}>{r.date}</Text>
                                    </View>
                                    {/* Col 2: title + product */}
                                    <View style={{ justifyContent: 'center', flex: 1, minWidth: 0 }}>
                                        <Text numberOfLines={1} style={{ fontSize: 13, color: THEME.text }}>{r.title}</Text>
                                        {r.product ? (
                                            <Text numberOfLines={1} style={{ fontSize: 10, color: THEME.textSecondary }}>{r.product}</Text>
                                        ) : null}
                                    </View>
                                    {/* Col 3: status */}
                                    <View style={{ justifyContent: 'center' }}>
                                        <Text style={{ fontSize: 10, fontWeight: '500', color: THEME.primary,
                                                       backgroundColor: THEME.primary + '15', paddingHorizontal: 8,
                                                       paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{r.status}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Structured ticket detail — badges + title + comments + attachments (mirrors web) */}
                    {message.ticketDetail && (
                        <View style={{ marginTop: 4, borderWidth: 1, borderColor: THEME.border, borderRadius: 8, padding: 10, backgroundColor: THEME.background, gap: 6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.text }}>Ticket {message.ticketDetail.ref}:</Text>
                                {message.ticketDetail.status ? (
                                    <Text style={{ fontSize: 10, fontWeight: '600', color: THEME.primary, backgroundColor: THEME.primary + '15', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{message.ticketDetail.status}</Text>
                                ) : null}
                                {message.ticketDetail.priority ? (
                                    <Text style={{ fontSize: 10, fontWeight: '600', color: '#b45309', backgroundColor: '#b4530915', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{message.ticketDetail.priority}</Text>
                                ) : null}
                            </View>
                            {[['Title', message.ticketDetail.title], ['Product', message.ticketDetail.product], ['Created', message.ticketDetail.created], ['Updated', message.ticketDetail.updated]].map(([lbl, val]) => (
                                val ? (
                                    <View key={lbl} style={{ flexDirection: 'row', gap: 8 }}>
                                        <Text style={{ minWidth: 58, fontSize: 12, fontWeight: '600', color: THEME.textSecondary }}>{lbl}</Text>
                                        <Text style={{ flex: 1, fontSize: 12, color: THEME.text }}>{val}</Text>
                                    </View>
                                ) : null
                            ))}
                            {(message.ticketDetail.comments || []).length > 0 && (
                                <View style={{ gap: 6, marginTop: 2 }}>
                                    <Text style={{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary }}>💬 Comments</Text>
                                    {message.ticketDetail.comments.map((c, i) => (
                                        <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: THEME.border, paddingLeft: 8 }}>
                                            <Text style={{ fontSize: 10, fontWeight: '600', color: THEME.textSecondary }}>{c.author}{c.date ? ` · ${c.date}` : ''}</Text>
                                            <Text style={{ fontSize: 12, color: THEME.text }}>{c.body}</Text>
                                        </View>
                                    ))}
                                </View>
                            )}
                            {(message.ticketDetail.attachments || []).length > 0 && (
                                <View style={{ marginTop: 2, gap: 4 }}>
                                    <Text style={{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary }}>📎 Attachments</Text>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                                        {message.ticketDetail.attachments.filter(a => a.url && (a.mime || '').startsWith('image/')).map((a, i) => (
                                            <Image key={i} source={{ uri: a.url }} style={{ width: 76, height: 76, borderRadius: 6, borderWidth: 1, borderColor: THEME.border }} />
                                        ))}
                                    </View>
                                    {message.ticketDetail.attachments.filter(a => !(a.url && (a.mime || '').startsWith('image/'))).map((a, i) => (
                                        a.url
                                            ? <Text key={i} style={{ fontSize: 12, color: THEME.primary }} onPress={() => Linking.openURL(a.url)}>{a.filename}</Text>
                                            : <Text key={i} style={{ fontSize: 12, color: THEME.text }}>{a.filename}</Text>
                                    ))}
                                </View>
                            )}
                        </View>
                    )}

                    {/* Structured Shopify order-tracking card — badge header + stepper (mirrors web) */}
                    {message.orderTracking && (() => {
                        const o = message.orderTracking;
                        const STAGES = ['ordered', 'processing', 'shipped', 'delivered'];
                        const STAGE_HEX = { ordered: '#6b7280', processing: '#d97706', shipped: '#2563eb', delivered: '#16a34a' };
                        const idx = Math.max(STAGES.indexOf(o.stage), 0);
                        const stageColor = STAGE_HEX[o.stage] || THEME.primary;
                        return (
                            <View style={{ marginTop: 4, borderWidth: 1, borderColor: THEME.border, borderRadius: 8, padding: 10, backgroundColor: THEME.background, gap: 6 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                                    <Text style={{ fontSize: 13, fontWeight: '700', color: THEME.text }}>Order {o.name}:</Text>
                                    {o.status ? (
                                        <Text style={{ fontSize: 10, fontWeight: '600', color: stageColor, backgroundColor: stageColor + '15', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>{o.status}</Text>
                                    ) : null}
                                </View>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    {STAGES.map((s, i) => (
                                        <React.Fragment key={s}>
                                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: i <= idx ? stageColor : THEME.border }} />
                                            {i < STAGES.length - 1 ? (
                                                <View style={{ flex: 1, height: 2, backgroundColor: i < idx ? stageColor : THEME.border }} />
                                            ) : null}
                                        </React.Fragment>
                                    ))}
                                </View>
                                {[['Payment', o.financial_status], ['Total', o.total], ['Placed', o.created]].map(([lbl, val]) => (
                                    val ? (
                                        <View key={lbl} style={{ flexDirection: 'row', gap: 8 }}>
                                            <Text style={{ minWidth: 58, fontSize: 12, fontWeight: '600', color: THEME.textSecondary }}>{lbl}</Text>
                                            <Text style={{ flex: 1, fontSize: 12, color: THEME.text }}>{val}</Text>
                                        </View>
                                    ) : null
                                ))}
                                {(o.line_items || []).length > 0 && (
                                    <View style={{ gap: 2, marginTop: 2 }}>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary }}>Items</Text>
                                        {o.line_items.map((li, i) => (
                                            <Text key={i} style={{ fontSize: 12, color: THEME.text }}>{li.title} × {li.quantity}</Text>
                                        ))}
                                    </View>
                                )}
                                {(o.tracking || []).length > 0 && (
                                    <View style={{ gap: 2, marginTop: 2 }}>
                                        <Text style={{ fontSize: 11, fontWeight: '600', color: THEME.textSecondary }}>📦 Tracking</Text>
                                        {o.tracking.map((t, i) => (
                                            t.url
                                                ? <Text key={i} style={{ fontSize: 12, color: THEME.primary }} onPress={() => Linking.openURL(t.url)}>{t.company || 'Carrier'}: {t.number}</Text>
                                                : <Text key={i} style={{ fontSize: 12, color: THEME.text }}>{t.company || 'Carrier'}: {t.number}</Text>
                                        ))}
                                    </View>
                                )}
                            </View>
                        );
                    })()}

                    {/* Chart — inline bar chart */}
                    {chartData && (
                        ['line', 'area', 'pie'].includes((chartData.type || '').toLowerCase())
                            ? (
                                <View style={{ height: 220, marginTop: 6, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: THEME.border }}>
                                    <WebView
                                        originWhitelist={['*']}
                                        scrollEnabled={false}
                                        style={{ backgroundColor: 'transparent' }}
                                        source={{ html: chartHtml(chartData, isDark) }}
                                    />
                                </View>
                            ) : (
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
                            )
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
