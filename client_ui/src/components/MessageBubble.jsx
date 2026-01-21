import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, User, ThumbsUp, ThumbsDown } from 'lucide-react';
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


const MessageBubble = ({ message, onButtonClick, onFeedback, themeColor = null, botIcon = '🤖', botIconColor = null, userIcon = '👤', userIconColor = '#e5e7eb', buttonFontSize = '13' }) => {
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

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex w-full mb-4 ${isBot ? 'justify-start' : 'justify-end'}`}
        >
            <div className={`flex ${message.ticket_form ? 'w-full max-w-full' : 'max-w-[90%]'} ${isBot ? 'flex-row' : 'flex-row-reverse'}`}>
                {/* Avatar - Using emoji icons */}
                <div
                    className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-lg ${isBot ? 'mr-2' : 'ml-2'}`}
                    style={isBot ? { backgroundColor: botBgColor } : { backgroundColor: userIconColor }}
                >
                    {isBot ? botIcon : userIcon}
                </div>

                {/* Bubble + Feedback container */}
                <div className="flex flex-col">
                    {/* Bubble */}
                    <div
                        className={`p-3 rounded-2xl shadow-sm text-sm ${isBot
                            ? 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
                            : 'text-white rounded-tr-none'
                            }`}
                        style={!isBot ? { backgroundColor: primaryColor } : {}}
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
                                            a: ({ node, ...props }) => <a style={{ color: primaryColor }} className="hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
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
                                    </div>
                                )}

                                {/* Render buttons if present */}
                                {message.buttons && message.buttons.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3 not-prose">
                                        {message.buttons.map((button, index) => (
                                            <button
                                                key={index}
                                                onClick={() => onButtonClick && onButtonClick(button.payload)}
                                                className="px-3 py-2 text-white rounded-lg transition-colors shadow-sm"
                                                style={{ backgroundColor: primaryColor, fontSize: `${buttonFontSize}px` }}
                                                onMouseEnter={(e) => e.target.style.backgroundColor = hoverColor}
                                                onMouseLeave={(e) => e.target.style.backgroundColor = primaryColor}
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

                    {/* Thumbs Up/Down Feedback - Only for bot messages */}
                    {isBot && message.id !== 'init' && (
                        <div className="flex items-center gap-1 mt-1 ml-1">
                            <button
                                onClick={() => handleFeedback('up')}
                                className={`p-1.5 rounded-full transition-all duration-200 ${feedback === 'up'
                                    ? 'bg-green-100 text-green-600 scale-110'
                                    : 'text-gray-400 hover:text-green-500 hover:bg-green-50'
                                    }`}
                                title="Helpful"
                            >
                                <ThumbsUp size={14} fill={feedback === 'up' ? 'currentColor' : 'none'} />
                            </button>
                            <button
                                onClick={() => handleFeedback('down')}
                                className={`p-1.5 rounded-full transition-all duration-200 ${feedback === 'down'
                                    ? 'bg-red-100 text-red-600 scale-110'
                                    : 'text-gray-400 hover:text-red-500 hover:bg-red-50'
                                    }`}
                                title="Not helpful"
                            >
                                <ThumbsDown size={14} fill={feedback === 'down' ? 'currentColor' : 'none'} />
                            </button>
                            {feedback && (
                                <span className="text-xs text-gray-400 ml-1 animate-pulse">
                                    Thanks for feedback!
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </div >
        </motion.div >
    );
};

export default MessageBubble;
