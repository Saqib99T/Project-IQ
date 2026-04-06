import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThumbsUp, ThumbsDown, Sparkles, RotateCcw, Copy } from 'lucide-react';
import { motion } from 'framer-motion';
import ChartRenderer from './ChartRenderer';
import TicketForm from './TicketForm';

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


const MessageBubble = ({ message, onButtonClick, onFeedback, themeColor = null, botIcon = '🤖', botIconColor = null, userIcon = '👤', userIconColor = '#e5e7eb', buttonFontSize = '13', readonly = false }) => {
    const isBot = message.sender === 'bot';

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

    // Warning/system messages render as a centered banner
    if (message.type === 'warning' || message.type === 'system') {
        const isSystem = message.type === 'system';
        return (
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full justify-center mb-4"
            >
                <div className={`flex items-start gap-2 px-4 py-3 rounded-2xl text-sm max-w-[90%] ${isSystem ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
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
            className={`flex w-full mb-4 ${isBot ? 'justify-start' : 'justify-end'}`}
        >
            <div className={`flex ${message.ticket_form ? 'w-full max-w-full' : 'max-w-[90%]'} ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>
                {/* Avatar - Using SVG or emoji icons */}
                <div
                    className={`flex-shrink-0 h-8 w-8 flex items-center justify-center ${isBot ? 'mr-3 mt-1' : 'ml-2 rounded-full text-base'}`}
                    style={isBot ? { backgroundColor: '#e8f0fe', borderRadius: '50%', color: '#1a73e8' } : { backgroundColor: userIconColor }}
                >
                    {isBot ? (
                        <Sparkles size={15} strokeWidth={2} />
                    ) : (
                        userIcon
                    )}
                </div>

                {/* Bubble + Feedback container */}
                <div className="flex flex-col">
                    {/* Bubble */}
                    <div
                        className={`p-3 text-sm ${isBot
                            ? 'text-gray-800'
                            : 'rounded-3xl rounded-tr-none text-gray-800 px-5 bg-gray-100'
                            }`}
                        style={!isBot ? { backgroundColor: '#f0f4f9' } : {}}
                    >
                        {isBot ? (
                            <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-table:my-2">
                                {/* Text content */}
                                {message.text && (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            table: ({ node, ...props }) => <table className="min-w-full divide-y divide-gray-200 my-2 border rounded-md overflow-hidden" {...props} />,
                                            thead: ({ node, ...props }) => <thead className="bg-gray-50" {...props} />,
                                            th: ({ node, ...props }) => <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b" {...props} />,
                                            td: ({ node, ...props }) => <td className="px-3 py-2 whitespace-normal text-sm text-gray-700 border-b border-r last:border-r-0 border-gray-100 bg-white" {...props} />,
                                            a: ({ node, ...props }) => <a style={{ color: readonly ? 'inherit' : primaryColor, pointerEvents: readonly ? 'none' : 'auto', textDecoration: readonly ? 'none' : undefined }} className={readonly ? '' : 'hover:underline'} target={readonly ? undefined : '_blank'} rel="noopener noreferrer" {...props} />,
                                            ul: ({ node, ...props }) => <ul className="list-disc pl-5" {...props} />,
                                            ol: ({ node, ...props }) => <ol className="list-decimal pl-5" {...props} />,
                                        }}
                                    >
                                        {message.text}
                                    </ReactMarkdown>
                                )}

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
                            <p className="whitespace-pre-wrap">{message.text}</p>
                        )}
                    </div>

                    {/* Feedback row — Gemini style: thumbs up, down, refresh, copy */}
                    {isBot && message.id !== 'init' && !readonly && (
                        <div className="flex items-center gap-0.5 mt-1.5 ml-1">
                            <button
                                onClick={() => handleFeedback('up')}
                                className={`p-1.5 rounded-full transition-colors ${feedback === 'up' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                title="Good response"
                            >
                                <ThumbsUp size={15} fill={feedback === 'up' ? 'currentColor' : 'none'} />
                            </button>
                            <button
                                onClick={() => handleFeedback('down')}
                                className={`p-1.5 rounded-full transition-colors ${feedback === 'down' ? 'text-red-500' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                title="Bad response"
                            >
                                <ThumbsDown size={15} fill={feedback === 'down' ? 'currentColor' : 'none'} />
                            </button>
                            <button className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Regenerate">
                                <RotateCcw size={15} />
                            </button>
                            <button className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Copy">
                                <Copy size={15} />
                            </button>
                        </div>
                    )}
                </div>
            </div >
        </motion.div >
    );
};

export default MessageBubble;
