import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThumbsUp, ThumbsDown, Sparkles, RotateCcw, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import ChartRenderer from './ChartRenderer';
import TicketForm from './TicketForm';

// Status/priority badge colors for the ticket-detail view.
const STATUS_HEX = {
    open: '#2563eb', new: '#2563eb',
    'in progress': '#d97706', 'in-progress': '#d97706', assigned: '#d97706',
    pending: '#7c3aed', 'on hold': '#7c3aed', waiting: '#7c3aed',
    resolved: '#16a34a', solved: '#16a34a', closed: '#16a34a', done: '#16a34a',
};
const PRIORITY_HEX = {
    low: '#16a34a', minor: '#16a34a',
    medium: '#d97706', normal: '#d97706',
    high: '#ea580c', major: '#ea580c',
    critical: '#dc2626', urgent: '#dc2626',
};
function badgeStyle(hexMap, value, isDark) {
    const base = hexMap[(value || '').toLowerCase().trim()] || (isDark ? '#9ca3af' : '#6b7280');
    return { color: base, backgroundColor: base + (isDark ? '26' : '1a') };
}

const PAYLOAD_LABELS = {
    '/create_ticket':        'Create a ticket',
    '/list_tickets':         'List my tickets',
    '/check_status':         'Check ticket status',
    '/help':                 'Help',
    '/request_human_agent':  'Talk to a human agent',
    '/confirm_gdpr_consent': 'I agree to the terms',
    '/deny_gdpr_consent':    'I do not agree',
    '/login':                'Login',
    '/logout':               'Logout',
    '/greet':                'Hello',
    '/affirm':               'Yes',
    '/deny':                 'No',
    '/restart':              'Start over',
    '/out_of_scope':         'Other',
};

const formatUserMessage = (text) => {
    if (!text || !text.startsWith('/')) return text;
    const key = text.split('{')[0].trim().toLowerCase();
    return PAYLOAD_LABELS[key] || text.slice(1).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
};

// Helper function to extract YouTube video ID and optional start time from various URL formats
const extractYouTubeInfo = (url) => {
    if (!url) return { id: '', start: 0 };

    // Extract video ID
    const idPatterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/ // Direct ID
    ];
    let videoId = '';
    for (const pattern of idPatterns) {
        const match = url.match(pattern);
        if (match) {
            videoId = match[1];
            break;
        }
    }

    // Extract start time from &t=123 or ?t=123 or &start=123
    let startTime = 0;
    const timeMatch = url.match(/[?&](?:t|start)=(\d+)/);
    if (timeMatch) {
        startTime = parseInt(timeMatch[1], 10);
    }

    return { id: videoId, start: startTime };
};


const MessageBubble = ({ message, onButtonClick, onFeedback, themeColor = null, isDark = false, botIcon = '🤖', botIconColor = null, userIcon = '👤', userIconColor = '#e5e7eb', buttonFontSize = '13', readonly = false, ticketPrefill = {}, sessionToken = null }) => {
    const isBot      = message.sender === 'bot';
    const isOperator = message.sender === 'operator';

    // Compute theme colors - default to black if not provided
    const primaryColor = themeColor || '#000000';
    const hoverColor = adjustBrightness(primaryColor, -15);
    const botBgColor = botIconColor || primaryColor;

    // Helper function to adjust color brightness
    function adjustBrightness(hex, percent) {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, Math.max(0, (num >> 16) + amt));
        const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
        const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    // Load feedback from localStorage if available
    const [feedback, setFeedback] = useState(() => {
        const saved = localStorage.getItem(`feedback-${message.id}`);
        return saved || null;
    });

    const handleFeedback = (type) => {
        setFeedback(type);
        // Save feedback to localStorage
        localStorage.setItem(`feedback-${message.id}`, type);
        if (onFeedback) {
            onFeedback(message.id, type);
        }
    };

    // Dark palette for MessageBubble
    const dm = {
        userBubble:   isDark ? '#2d3a50' : '#f0f4f9',
        userText:     isDark ? '#e5e7eb' : '#1f2937',
        systemBg:     isDark ? '#1e2533' : '#f3f4f6',
        systemText:   isDark ? '#9ca3af' : '#6b7280',
        feedbackHover:isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        feedbackColor:isDark ? '#6b7280' : '#9ca3af',
    };

    // Messages containing a markdown table (e.g. "Your Open Tickets") drop the
    // bubble padding so the table can use the full width.
    const hasTable = typeof message.text === 'string'
        && /\|.*\|/.test(message.text) && /\|\s*:?-{2,}/.test(message.text);

    // Warning/system messages render as a centered banner
    if (message.type === 'warning' || message.type === 'system') {
        const isSystem = message.type === 'system';
        return (
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full justify-center mb-4"
            >
                <div className={`flex items-start gap-2 px-4 py-3 rounded-2xl text-sm max-w-[90%] ${isSystem ? '' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}
                    style={isSystem ? { backgroundColor: dm.systemBg, color: dm.systemText } : {}}
                >
                    <span className="text-lg leading-none mt-0.5">{isSystem ? '💬' : '⏰'}</span>
                    <div className="prose prose-sm max-w-none prose-p:my-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                    </div>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex w-full mb-4 ${(isBot || isOperator) ? 'justify-start' : 'justify-end'}`}
        >
            <div className={`flex ${(message.ticket_form || isBot || isOperator) ? 'w-full max-w-full' : 'max-w-[80%]'} ${(isBot || isOperator) ? 'flex-row' : 'flex-row-reverse'}`}>
                {/* Avatar */}
                <div
                    className={`flex-shrink-0 h-8 w-8 flex items-center justify-center ${(isBot || isOperator) ? 'mr-3 mt-1' : 'ml-2 rounded-full text-base'}`}
                    style={isOperator
                        ? { backgroundColor: '#dcfce7', borderRadius: '50%', color: '#16a34a' }
                        : isBot
                            ? { backgroundColor: '#e8f0fe', borderRadius: '50%', color: '#1a73e8' }
                            : { backgroundColor: userIconColor }}
                >
                    {isOperator ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    ) : isBot ? (
                        <Sparkles size={15} strokeWidth={2} />
                    ) : (
                        userIcon
                    )}
                </div>

                {/* Bubble + Feedback container */}
                <div className="flex flex-col min-w-0 overflow-hidden">
                    {isOperator && (
                        <span className="text-xs text-green-600 font-medium mb-1 ml-1">Support Agent</span>
                    )}
                    {/* Bubble */}
                    <div
                        className={`${(hasTable || message.ticketDetail) ? 'p-0' : 'p-3'} text-sm ${(isBot || isOperator) ? '' : 'rounded-3xl rounded-tr-none px-5'}`}
                        style={isOperator
                            ? { backgroundColor: isDark ? '#1a2e20' : '#f0fdf4', border: `1px solid ${isDark ? '#166534' : '#bbf7d0'}`, borderRadius: '0 12px 12px 12px', color: isDark ? '#86efac' : '#166534' }
                            : (!isBot ? { backgroundColor: dm.userBubble, color: dm.userText } : { color: isDark ? '#e5e7eb' : '#1f2937' })}
                    >
                        {isOperator ? (
                            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{message.text}</p>
                        ) : isBot ? (
                            <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-table:my-2">
                                {/* Text content (suppressed when a structured ticket detail is shown) */}
                                {message.text && !message.ticketDetail && (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            // Image attachments render as clickable thumbnails
                                            img: ({ node, ...props }) => (
                                                <a href={props.src} target="_blank" rel="noopener noreferrer" className="inline-block not-prose">
                                                    <img {...props} loading="lazy" className="rounded-lg my-1 cursor-pointer"
                                                         style={{ maxHeight: '120px', maxWidth: '100%', objectFit: 'cover', border: `1px solid ${isDark ? '#2e3a4e' : '#e5e7eb'}` }} />
                                                </a>
                                            ),
                                            table: ({ node, ...props }) => <div style={{ overflowX: 'auto', maxWidth: '100%', margin: '6px 0' }}><table className="divide-y rounded-md overflow-hidden" style={{ border: `1px solid ${isDark ? '#2e3a4e' : '#e5e7eb'}` }} {...props} /></div>,
                                            thead: ({ node, ...props }) => <thead style={{ backgroundColor: isDark ? '#1e2533' : '#f9fafb' }} {...props} />,
                                            th: ({ node, ...props }) => <th className="px-3 py-2 text-left font-medium uppercase tracking-wider border-b" style={{ fontSize: '11px', color: isDark ? '#9ca3af' : '#6b7280', borderColor: isDark ? '#2e3a4e' : '#e5e7eb' }} {...props} />,
                                            td: ({ node, ...props }) => <td className="px-3 py-2 whitespace-normal border-b border-r last:border-r-0" style={{ fontSize: '13px', color: isDark ? '#d1d5db' : '#374151', backgroundColor: isDark ? '#111827' : '#ffffff', borderColor: isDark ? '#2e3a4e' : '#f3f4f6' }} {...props} />,
                                            a: ({ node, ...props }) => <a style={{ color: readonly ? 'inherit' : primaryColor, pointerEvents: readonly ? 'none' : 'auto', textDecoration: readonly ? 'none' : undefined }} className={readonly ? '' : 'hover:underline'} target={readonly ? undefined : '_blank'} rel="noopener noreferrer" {...props} />,
                                            p: ({ node, children, ...props }) => {
                                                const isImgOnly = node.children?.every(c => c.type === 'element' && c.tagName === 'img');
                                                if (isImgOnly) return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', margin: '4px 0' }}>{children}</div>;
                                                return <p className="my-1" {...props}>{children}</p>;
                                            },
                                            img: ({ node, src, alt }) => (
                                                <a href={src} target="_blank" rel="noopener noreferrer"
                                                    style={{ width: 'calc(33.33% - 3px)', flexShrink: 0, display: 'block' }}>
                                                    <img src={src} alt={alt} style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '6px', display: 'block', cursor: 'pointer', border: `1px solid ${isDark ? '#2e3a4e' : '#e5e7eb'}` }} />
                                                </a>
                                            ),
                                            ul: ({ node, ...props }) => <ul className="list-disc pl-5" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal pl-5" {...props} />,
                                        }}
                                    >
                                        {message.text}
                                    </ReactMarkdown>
                                )}

                                {/* Render structured ticket list (3-column cards) */}
                                {message.ticketList?.rows?.length > 0 && (
                                    <div className="not-prose mt-1 flex flex-col gap-1.5">
                                        {message.ticketList.rows.map((r, i) => (
                                            <div key={i} className="flex items-stretch gap-2 rounded-lg px-2.5 py-2"
                                                 style={{ border: `1px solid ${isDark ? '#2e3a4e' : '#e5e7eb'}`, backgroundColor: isDark ? '#111827' : '#fff' }}>
                                                {/* Col 1: ticket no + date */}
                                                <div className="flex flex-col justify-center shrink-0" style={{ minWidth: 64 }}>
                                                    <span className="font-semibold leading-tight" style={{ fontSize: 13, color: isDark ? '#e5e7eb' : '#111827' }}>#{r.no}</span>
                                                    <span className="leading-tight" style={{ fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>{r.date}</span>
                                                </div>
                                                {/* Col 2: title + product */}
                                                <div className="flex flex-col justify-center flex-1 min-w-0">
                                                    <span className="leading-tight truncate" style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#374151' }}>{r.title}</span>
                                                    {r.product ? (
                                                        <span className="leading-tight truncate" style={{ fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>{r.product}</span>
                                                    ) : null}
                                                </div>
                                                {/* Col 3: status */}
                                                <div className="flex items-center shrink-0">
                                                    <span className="px-2 py-0.5 rounded-full whitespace-nowrap" style={{ fontSize: 10, fontWeight: 500, color: primaryColor, backgroundColor: `${primaryColor}15` }}>{r.status}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Structured ticket detail — header with colored status/priority badges */}
                                {message.ticketDetail && (() => {
                                    const t = message.ticketDetail;
                                    const labelStyle = { minWidth: 64, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280' };
                                    const valStyle   = { color: isDark ? '#d1d5db' : '#374151' };
                                    const imgs = (t.attachments || []).filter(a => a.url && (a.mime || '').startsWith('image/'));
                                    const files = (t.attachments || []).filter(a => !(a.url && (a.mime || '').startsWith('image/')));
                                    return (
                                        <div className="not-prose p-3">
                                            <div className="flex items-center flex-wrap gap-2 mb-3">
                                                <span style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#e5e7eb' : '#111827' }}>Ticket {t.ref}:</span>
                                                {t.status && <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, fontWeight: 600, ...badgeStyle(STATUS_HEX, t.status, isDark) }}>{t.status}</span>}
                                                {t.priority && <span className="rounded-full px-2 py-0.5" style={{ fontSize: 11, fontWeight: 600, ...badgeStyle(PRIORITY_HEX, t.priority, isDark) }}>{t.priority}</span>}
                                            </div>
                                            <div className="flex flex-col gap-1.5" style={{ fontSize: 13 }}>
                                                <div className="flex gap-2"><span style={labelStyle}>Title</span><span style={valStyle}>{t.title}</span></div>
                                                {t.product && <div className="flex gap-2"><span style={labelStyle}>Product</span><span style={valStyle}>{t.product}</span></div>}
                                                {t.created && <div className="flex gap-2"><span style={labelStyle}>Created</span><span style={valStyle}>{t.created}</span></div>}
                                                {t.updated && <div className="flex gap-2"><span style={labelStyle}>Updated</span><span style={valStyle}>{t.updated}</span></div>}
                                            </div>
                                            {(imgs.length > 0 || files.length > 0) && (
                                                <div className="mt-3">
                                                    <p style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 6 }}>📎 Attachments</p>
                                                    {imgs.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                            {imgs.map((a, i) => (
                                                                <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" style={{ width: 'calc(33.33% - 3px)', display: 'block' }}>
                                                                    <img src={a.url} alt={a.filename} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, border: `1px solid ${isDark ? '#2e3a4e' : '#e5e7eb'}` }} />
                                                                </a>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {files.map((a, i) => (
                                                        <div key={i} style={{ fontSize: 13 }}>
                                                            {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: primaryColor }} className="hover:underline">{a.filename}</a> : a.filename}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Render chart if present */}
                                {message.chart && (
                                    <ChartRenderer chartData={message.chart} />
                                )}

                                {/* Render embedded video if present */}
                                {message.video && message.video.url && (() => {
                                    const videoInfo = extractYouTubeInfo(message.video.url);
                                    const startParam = videoInfo.start > 0 ? `&start=${videoInfo.start}` : '';
                                    return (
                                        <div className="mt-3 not-prose">
                                            <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                                                </svg>
                                                {message.video.title || 'Video Tutorial'}
                                                {videoInfo.start > 0 && (
                                                    <span className="ml-1 font-medium" style={{ color: primaryColor }}>
                                                        (starts at {Math.floor(videoInfo.start / 60)}:{(videoInfo.start % 60).toString().padStart(2, '0')})
                                                    </span>
                                                )}
                                            </div>
                                            <div className="relative w-full rounded-lg overflow-hidden shadow-md" style={{ paddingTop: '56.25%' }}>
                                                <iframe
                                                    className="absolute top-0 left-0 w-full h-full rounded-lg"
                                                    src={`https://www.youtube.com/embed/${videoInfo.id}?rel=0${startParam}`}
                                                    title={message.video.title || 'Video Tutorial'}
                                                    frameBorder="0"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Render Ticket Form if present */}
                                {message.ticket_form && (
                                    <div className="not-prose">
                                        {readonly ? (
                                            <div className="mt-2 px-3 py-2 bg-gray-100 rounded-lg text-xs text-gray-400 italic">Ticket form (archived)</div>
                                        ) : (
                                        <TicketForm
                                            primaryColor={primaryColor}
                                            prefill={ticketPrefill}
                                            sessionToken={sessionToken}
                                            onSubmit={(data) => {
                                                // Convert form data to a hidden intent payload
                                                // We'll format it as a JSON string to be parsed by custom action
                                                const payload = `/submit_ticket_form${JSON.stringify(data)}`;
                                                onButtonClick && onButtonClick(payload);
                                            }}
                                            onCancel={() => {
                                                onButtonClick && onButtonClick('/stop');
                                            }}
                                        />
                                        )}
                                    </div>
                                )}

                                {/* Render buttons if present */}
                                {message.buttons && message.buttons.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3 not-prose">
                                        {message.buttons.map((button, index) => (
                                            <button
                                                key={index}
                                                onClick={() => !readonly && onButtonClick && onButtonClick(button.payload)}
                                                className="px-3 py-2 rounded-full transition-colors bg-transparent"
                                                style={{
                                                    fontSize: `${buttonFontSize}px`,
                                                    color: primaryColor,
                                                    border: `1.5px solid ${primaryColor}`,
                                                    opacity: readonly ? 0.4 : 1,
                                                    pointerEvents: readonly ? 'none' : 'auto',
                                                    cursor: readonly ? 'default' : 'pointer',
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (!readonly) e.currentTarget.style.backgroundColor = `${primaryColor}15`;
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (!readonly) e.currentTarget.style.backgroundColor = 'transparent';
                                                }}
                                            >
                                                {button.title}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="whitespace-pre-wrap">{formatUserMessage(message.text)}</p>
                        )}
                    </div>

                    {/* Feedback row — Gemini style: thumbs up, down, refresh, copy */}
                    {isBot && message.id !== 'init' && !readonly && (
                        <div className="flex items-center gap-0.5 mt-1.5 ml-1">
                            {[
                                { icon: <ThumbsUp size={15} fill={feedback === 'up' ? 'currentColor' : 'none'} />, action: () => handleFeedback('up'), active: feedback === 'up', activeColor: '#3b82f6', title: 'Good response' },
                                { icon: <ThumbsDown size={15} fill={feedback === 'down' ? 'currentColor' : 'none'} />, action: () => handleFeedback('down'), active: feedback === 'down', activeColor: '#ef4444', title: 'Bad response' },
                                { icon: <RotateCcw size={15} />, action: null, active: false, activeColor: '', title: 'Regenerate' },
                                { icon: <Copy size={15} />, action: null, active: false, activeColor: '', title: 'Copy' },
                            ].map((btn, i) => (
                                <button key={i}
                                    onClick={btn.action}
                                    className="p-1.5 rounded-full transition-colors"
                                    style={{ color: btn.active ? btn.activeColor : dm.feedbackColor }}
                                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = dm.feedbackHover; if (!btn.active) e.currentTarget.style.color = isDark ? '#d1d5db' : '#4b5563'; }}
                                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = btn.active ? btn.activeColor : dm.feedbackColor; }}
                                    title={btn.title}
                                >
                                    {btn.icon}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div >
        </motion.div >
    );
};

export default MessageBubble;
