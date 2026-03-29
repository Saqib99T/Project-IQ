import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Minimize2, RefreshCw, X, Trash2, LogOut, User, Lock, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from './MessageBubble';
import AnimatedChatIcon from './AnimatedChatIcon';
import { v4 as uuidv4 } from 'uuid';
import { getCookie, setCookie, deleteCookie } from '../utils/cookieUtils';

const RASA_API_URL = `${window.location.protocol}//${window.location.hostname}:5005/webhooks/rest/webhook`;

// Storage keys with appId prefix for multi-widget support
// Cookies: auth data (senderId, isAuthenticated, authUser, privacyDismissed)
// localStorage: large data (messages)
const getStorageKey = (appId, key) => `glpi-chat-${appId}-${key}`;

const ChatWindow = ({ title = "Project IQ", appId = "General", theme = null }) => {
    // Extract theme properties with defaults
    const primaryColor = theme?.primaryColor || '#000000';
    const secondaryColor = theme?.secondaryColor || adjustBrightness(primaryColor, 20);
    const bgColor = theme?.bgColor || '#ffffff';
    const textColor = theme?.textColor || '#1f2937';
    const fontFamily = theme?.fontFamily || 'Inter';
    const borderRadius = theme?.borderRadius || '12';

    // Icon settings
    const botIcon = theme?.botIcon || '🤖';
    const botIconColor = theme?.botIconColor || primaryColor;
    const userIcon = theme?.userIcon || '👤';
    const userIconColor = theme?.userIconColor || '#e5e7eb';
    const sendIcon = theme?.sendIcon || '➤';
    const sendIconColor = theme?.sendIconColor || primaryColor;
    const attachIcon = theme?.attachIcon || '📎';

    // Font size settings
    const headerFontSize = theme?.headerFontSize || '16';
    const messageFontSize = theme?.messageFontSize || '14';
    const buttonFontSize = theme?.buttonFontSize || '13';
    const inputFontSize = theme?.inputFontSize || '14';

    // Compute derived colors
    const hoverColor = adjustBrightness(primaryColor, 20);
    const shadowColor = `${primaryColor}4D`; // 30% opacity

    // Helper function to adjust color brightness
    function adjustBrightness(hex, percent) {
        if (!hex || !hex.startsWith('#')) return hex;
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, Math.max(0, (num >> 16) + amt));
        const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
        const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
        return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    // Persist senderId across sessions (cookie)
    const [senderId] = useState(() => {
        const stored = getCookie(getStorageKey(appId, 'senderId'));
        if (stored) return stored;
        const newId = uuidv4();
        setCookie(getStorageKey(appId, 'senderId'), newId);
        return newId;
    });

    // Authentication state - check cookies for persisted login
    const [isAuthenticated, setIsAuthenticated] = useState(() => {
        const stored = getCookie(getStorageKey(appId, 'isAuthenticated'));
        return stored === 'true';
    });
    const [isGuest, setIsGuest] = useState(() => {
        // Guest if not authenticated
        const loggedIn = getCookie(getStorageKey(appId, 'isAuthenticated')) === 'true';
        return !loggedIn;
    });
    const [authUser, setAuthUser] = useState(() => {
        const stored = getCookie(getStorageKey(appId, 'authUser'));
        return stored || '';
    });
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);

    // Load saved messages or use welcome message
    const [messages, setMessages] = useState(() => {
        const saved = localStorage.getItem(getStorageKey(appId, 'messages'));
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            } catch (e) {
                console.warn('Failed to parse saved messages:', e);
            }
        }
        // Different welcome for logged-in vs guest users
        const loggedIn = getCookie(getStorageKey(appId, 'isAuthenticated')) === 'true';
        const userName = getCookie(getStorageKey(appId, 'authUser'));
        if (loggedIn && userName) {
            return [{ id: 'init', sender: 'bot', text: `**Hi ${userName}!**\n\nWelcome back. How can I help you today?` }];
        }
        // Guest welcome message
        return [{ id: 'init', sender: 'bot', text: `**Hi, I'm ${title}** 👋\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*` }];
    });

    const [showPrivacyPopup, setShowPrivacyPopup] = useState(() => {
        const dismissed = getCookie(getStorageKey(appId, 'privacyDismissed')) === 'true';
        return isAuthenticated && !dismissed;
    });

    // Debug log
    useEffect(() => {
        console.log('Privacy Popup State:', showPrivacyPopup, 'Authenticated:', isAuthenticated);
    }, [showPrivacyPopup, isAuthenticated]);

    const [showTicketFilterPopup, setShowTicketFilterPopup] = useState(false);
    const [showTicketIdPopup, setShowTicketIdPopup] = useState(false);
    const [ticketIdInput, setTicketIdInput] = useState('');
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Save messages to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem(getStorageKey(appId, 'messages'), JSON.stringify(messages));
    }, [messages, appId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Scroll to bottom when chat opens (for history reload)
    useEffect(() => {
        if (isOpen) {
            // Use instant scroll on open so user sees latest messages immediately
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 100);
        }
    }, [isOpen]);

    // Handle Login
    const handleLogin = async (e) => {
        e.preventDefault();
        if (!loginUsername.trim() || !loginPassword.trim()) {
            setLoginError('Please enter both username and password');
            return;
        }

        setIsLoggingIn(true);
        setLoginError('');

        try {
            // Send login intent to Rasa with credentials as entities
            const loginPayload = `/login{"glpi_username": "${loginUsername}", "glpi_password": "${loginPassword}"}`;

            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: senderId,
                    message: loginPayload,
                    metadata: { app_id: appId }
                }),
            });

            const data = await response.json();

            // Check response for login success/failure
            let loginSuccess = false;
            let errorMsg = 'Login failed. Please check your credentials.';

            for (const msg of data) {
                // Check for JSON message with login result
                if (msg.custom?.login_success) {
                    loginSuccess = true;
                    break;
                }
                if (msg.custom?.login_error) {
                    errorMsg = msg.custom.error || errorMsg;
                    break;
                }
                // Also check text for success indicator
                if (msg.text && msg.text.includes('Welcome')) {
                    loginSuccess = true;
                }
                if (msg.text && msg.text.includes('failed')) {
                    errorMsg = msg.text;
                }
            }

            if (loginSuccess) {
                // Login successful - persist state
                setIsAuthenticated(true);
                setIsGuest(false);  // No longer a guest
                setShowLoginPrompt(false);  // Hide login prompt if shown
                setAuthUser(loginUsername);
                setCookie(getStorageKey(appId, 'isAuthenticated'), 'true');
                setCookie(getStorageKey(appId, 'authUser'), loginUsername);
                deleteCookie(getStorageKey(appId, 'privacyDismissed')); // Reset dismissal on new login
                setShowPrivacyPopup(true); // Show privacy popup

                // Add welcome message to chat with buttons
                const welcomeData = data.find(m => m.text);
                console.log('LOGIN DEBUG - welcomeData:', welcomeData);
                console.log('LOGIN DEBUG - buttons:', welcomeData?.buttons);
                const welcomeMsg = welcomeData?.text || `Welcome, ${loginUsername}! How can I help you?`;
                const welcomeButtons = welcomeData?.buttons || [];
                console.log('LOGIN DEBUG - welcomeButtons:', welcomeButtons);
                setMessages([{ id: uuidv4(), sender: 'bot', text: welcomeMsg, buttons: welcomeButtons }]);

                // Clear form
                setLoginUsername('');
                setLoginPassword('');
            } else {
                setLoginError(errorMsg);
            }
        } catch (error) {
            console.error('Login error:', error);
            setLoginError('Connection error. Please try again.');
        } finally {
            setIsLoggingIn(false);
        }
    };

    // Handle Logout - returns to guest mode
    const handleLogout = () => {
        setIsAuthenticated(false);
        setIsGuest(true);  // Return to guest mode
        setAuthUser('');
        deleteCookie(getStorageKey(appId, 'isAuthenticated'));
        deleteCookie(getStorageKey(appId, 'authUser'));
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        setMessages([{ id: 'init', sender: 'bot', text: `You've been logged out. Continuing as guest.\n\n📚 You can still search the Knowledge Base and ask questions!\n🔑 Login anytime for full ticket features.` }]);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) { // 2MB limit
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ File too large. Max 2MB." }]);
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result.split(',')[1];
            const entities = { file_name: file.name, file_data: base64 };
            const payload = `/upload_file${JSON.stringify(entities)}`;

            // Show user message
            const userMsg = { id: uuidv4(), sender: senderId, text: `📎 Uploading ${file.name}...` };
            setMessages(prev => [...prev, userMsg]);
            setIsLoading(true);

            // Send to Rasa
            try {
                const response = await fetch(RASA_API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sender: senderId,
                        message: payload,
                        metadata: { app_id: appId }
                    }),
                });

                const data = await response.json();
                if (data && data.length > 0) {
                    const botMessages = data.map(msg => ({
                        id: uuidv4(),
                        sender: 'bot',
                        text: msg.text
                    }));
                    setMessages(prev => [...prev, ...botMessages]);
                }
            } catch (error) {
                console.error("Error uploading:", error);
                setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ Upload failed." }]);
            } finally {
                setIsLoading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsDataURL(file);
    };

    // Guard Rails: Input Validation
    const validateInput = (message) => {
        // Block profanity (basic list - expand as needed)
        const profanityList = ['damn', 'hell', 'crap', 'stupid', 'idiot'];
        const lowerMessage = message.toLowerCase();
        if (profanityList.some(word => lowerMessage.includes(word))) {
            return { valid: false, error: "Please keep the conversation professional." };
        }

        // Block PII patterns
        const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
        const creditCardPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;

        if (ssnPattern.test(message)) {
            return { valid: false, error: "Please don't share Social Security Numbers. Contact support directly for sensitive information." };
        }

        if (creditCardPattern.test(message)) {
            return { valid: false, error: "Please don't share credit card numbers. Contact support directly for payment issues." };
        }

        // Block excessive length (500 char limit)
        if (message.length > 500) {
            return { valid: false, error: "Please keep your message under 500 characters. Break it into multiple messages if needed." };
        }

        // Block spam-like patterns (all caps, excessive punctuation)
        const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
        if (message.length > 20 && capsRatio > 0.7) {
            return { valid: false, error: "Please don't use excessive CAPS. It's considered shouting." };
        }

        return { valid: true };
    };

    // Handle feedback (thumbs up/down) - sends to Rasa backend
    const handleFeedback = async (messageId, feedbackType) => {
        try {
            const intent = feedbackType === 'up' ? '/feedback_positive' : '/feedback_negative';
            await fetch(RASA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: senderId,
                    message: intent,
                    metadata: { app_id: appId }
                })
            });
            console.log(`Feedback ${feedbackType} sent for message ${messageId}`);
        } catch (error) {
            console.error('Error sending feedback:', error);
        }
    };

    const handleTicketFilterSubmit = (statusId) => {
        setShowTicketFilterPopup(false);
        const payload = `/list_tickets{"status_id": ${statusId}}`; // Just numbers, no quotes for int
        handleButtonClick(payload); // Recursive call but now it acts as manual send
    };

    // Handle button clicks from fallback suggestions
    const handleButtonClick = async (payload) => {
        // Handle login button click
        if (payload === '__LOGIN__') {
            setShowLoginPrompt(true);
            return;
        }

        // Guest mode restrictions - require login for ticket operations
        const restrictedPayloads = ['/create_ticket', '/list_tickets', '/check_status', '/update_ticket', '/verify_resolution'];
        if (isGuest && restrictedPayloads.some(p => payload.startsWith(p))) {
            const actionName = payload.includes('create') ? 'create tickets' :
                payload.includes('list') ? 'view your tickets' :
                    payload.includes('check') ? 'check ticket status' : 'manage tickets';
            setMessages(prev => [...prev, {
                id: uuidv4(),
                sender: 'bot',
                text: `🔐 **Login Required**\n\nTo ${actionName}, please login with your Project IQ credentials.`,
                buttons: [
                    { title: '🔑 Login Now', payload: '__LOGIN__' },
                    { title: '📚 Search KB Instead', payload: '/ask_knowledge' }
                ]
            }]);
            return;
        }

        // Intercept Check Status to show popup
        if (payload === '/check_status') {
            setShowTicketIdPopup(true);
            return;
        }

        // Intercept List Tickets to show Filter popup
        // BUT prevent loop if it's the recursive call with status_id inside
        if (payload === '/list_tickets' && !payload.includes('{')) {
            setShowTicketFilterPopup(true);
            return;
        }

        // Extract intent from payload (e.g., "/list_tickets" -> "list_tickets")
        const message = payload.startsWith('/') ? payload : `/${payload}`;

        // Match ticket submission to show formatted summary
        let displayText = payload;
        if (payload.startsWith('/submit_ticket_form')) {
            try {
                const jsonStr = payload.replace('/submit_ticket_form', '');
                const data = JSON.parse(jsonStr);
                displayText = `📝 Ticket Request:\n${data.title} (${data.category})\nPriority: ${data.priority}`;
            } catch (e) {
                displayText = '📝 Submitting Ticket...';
            }
        } else if (payload.includes('status_id')) {
            // Friendly text for user
            displayText = "🔍 Filtering tickets...";
        }

        // Show user's choice
        const userMsg = { id: uuidv4(), sender: senderId, text: displayText };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        try {
            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: senderId,
                    message: message,
                    metadata: { app_id: appId }
                }),
            });

            const data = await response.json();

            if (data && data.length > 0) {
                // Process messages, merging video data and filtering empty ones
                let lastTextMessage = null;
                const processedMessages = [];

                for (const msg of data) {
                    if (msg.text) {
                        lastTextMessage = {
                            id: uuidv4(),
                            sender: 'bot',
                            text: msg.text,
                            buttons: msg.buttons,
                            chart: msg.chart || msg.custom?.chart,
                            video: msg.custom?.video,
                            ticket_form: msg.custom?.ticket_form
                        };
                        processedMessages.push(lastTextMessage);
                    } else if (msg.custom?.chart && lastTextMessage) {
                        lastTextMessage.chart = msg.custom.chart;
                    } else if (msg.custom?.chart) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            chart: msg.custom.chart
                        });
                    } else if (msg.custom?.video && lastTextMessage) {
                        lastTextMessage.video = msg.custom.video;
                    } else if (msg.custom?.video) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            video: msg.custom.video
                        });
                    } else if (msg.custom?.ticket_form && lastTextMessage) {
                        lastTextMessage.ticket_form = msg.custom.ticket_form;
                    } else if (msg.custom?.ticket_form) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticket_form: msg.custom.ticket_form,
                            buttons: []
                        });
                    } else if (msg.custom?.ticket_form && lastTextMessage) {
                        lastTextMessage.ticket_form = msg.custom.ticket_form;
                    } else if (msg.custom?.ticket_form) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticket_form: msg.custom.ticket_form,
                            buttons: [] // Ensure buttons don't float weirdly
                        });
                    }
                }

                if (processedMessages.length > 0) {
                    setMessages(prev => [...prev, ...processedMessages]);
                }
            }
        } catch (error) {
            console.error("Error:", error);
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ Error connecting to server." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim()) return;

        // Guard Rails: Validate input
        const validation = validateInput(inputText);
        if (!validation.valid) {
            setMessages(prev => [...prev, {
                id: uuidv4(),
                sender: 'bot',
                text: `⚠️ ${validation.error}`
            }]);
            setInputText('');
            return;
        }

        const userMsg = { id: uuidv4(), sender: senderId, text: inputText };
        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsLoading(true);

        try {
            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender: senderId,
                    message: userMsg.text,
                    metadata: { app_id: appId }
                }),
            });

            const data = await response.json();

            if (data && data.length > 0) {
                // Process messages, merging video data and filtering empty ones
                let lastTextMessage = null;
                const processedMessages = [];

                for (const msg of data) {
                    if (msg.text) {
                        // Message with text - create a proper message object
                        lastTextMessage = {
                            id: uuidv4(),
                            sender: 'bot',
                            text: msg.text,
                            buttons: msg.buttons,
                            chart: msg.chart || msg.custom?.chart,
                            video: msg.custom?.video,
                            ticket_form: msg.custom?.ticket_form
                        };
                        processedMessages.push(lastTextMessage);
                    } else if (msg.custom?.chart && lastTextMessage) {
                        // Chart-only message - merge into the last text message
                        lastTextMessage.chart = msg.custom.chart;
                    } else if (msg.custom?.chart) {
                        // Standalone chart message (no previous text) - show it
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            chart: msg.custom.chart
                        });
                    } else if (msg.custom?.video && lastTextMessage) {
                        // Video-only message - merge into the last text message
                        lastTextMessage.video = msg.custom.video;
                    } else if (msg.custom?.video) {
                        // Standalone video message (no previous text) - show it
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            video: msg.custom.video
                        });
                    } else if (msg.custom?.ticket_form && lastTextMessage) {
                        lastTextMessage.ticket_form = msg.custom.ticket_form;
                    } else if (msg.custom?.ticket_form) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticket_form: msg.custom.ticket_form
                        });
                    } else if (msg.image) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '![image](' + msg.image + ')'
                        });
                    }
                    // Skip completely empty messages
                }

                if (processedMessages.length > 0) {
                    setMessages(prev => [...prev, ...processedMessages]);
                }
            } else {
                // Fallback with helpful suggestions and contact info
                const fallbackMessage = {
                    id: uuidv4(),
                    sender: 'bot',
                    text: "I'm not sure I understand. Here are some things I can help with:",
                    buttons: [
                        { title: "List my tickets", payload: "/list_tickets" },
                        { title: "Create a ticket", payload: "/create_ticket" },
                        { title: "Check ticket status", payload: "/check_status" },
                        { title: "Help", payload: "/help" }
                    ]
                };

                const contactInfo = {
                    id: uuidv4(),
                    sender: 'bot',
                    text: "Still need help? Contact our support team:\n📧 support@yourcompany.com\n📞 +1-800-123-4567"
                };

                setMessages(prev => [...prev, fallbackMessage, contactInfo]);
            }

        } catch (error) {
            console.error("Error:", error);
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ Error connecting to server." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTicketIdSubmit = async (e) => {
        e.preventDefault();
        if (!ticketIdInput.trim()) return;

        setShowTicketIdPopup(false);
        // Clean ID - remove "GLPI-" prefix if user typed it, though backend might handle it
        // sending standard entity payload
        const payload = `/check_status{"ticket_id":"${ticketIdInput.trim()}"}`;
        handleButtonClick(payload);
        setTicketIdInput('');
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end" style={{ fontFamily }}>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="w-[400px] h-[600px] backdrop-blur-xl border border-white/20 shadow-2xl flex flex-col overflow-hidden mb-4 relative"
                        style={{
                            backgroundColor: bgColor,
                            borderRadius: `${borderRadius}px`,
                            color: textColor
                        }}
                    >
                        {/* Header */}
                        <div
                            className="p-4 flex items-center justify-between shadow-sm border-b border-gray-100"
                            style={{
                                backgroundColor: bgColor,
                                color: textColor,
                                fontSize: `${headerFontSize}px`
                            }}
                        >
                            <div className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <h1 className="font-semibold" style={{ fontSize: `${parseInt(headerFontSize) + 2}px` }}>{title}</h1>
                                {isAuthenticated && authUser && (
                                    <span className="text-xs opacity-75">({authUser})</span>
                                )}
                                {isGuest && (
                                    <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Guest</span>
                                )}
                            </div>
                            <div className="flex space-x-1">
                                {/* Login button - show for guests */}
                                {isGuest && (
                                    <button
                                        onClick={() => setShowLoginPrompt(true)}
                                        className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors flex items-center gap-1"
                                        title="Login"
                                    >
                                        🔑 Login
                                    </button>
                                )}
                                {/* Logout - only show when logged in (not guest) */}
                                {isAuthenticated && !isGuest && (
                                    <button
                                        onClick={handleLogout}
                                        className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-600"
                                        title="Logout"
                                    >
                                        <LogOut size={15} />
                                    </button>
                                )}
                                {/* Clear History - clears messages and resets senderId */}
                                {isAuthenticated && (
                                    <button
                                        onClick={() => {
                                            localStorage.removeItem(getStorageKey(appId, 'messages'));
                                            deleteCookie(getStorageKey(appId, 'senderId'));
                                            // Generate new senderId for fresh start
                                            const newId = uuidv4();
                                            setCookie(getStorageKey(appId, 'senderId'), newId);
                                            setMessages([{ id: 'init', sender: 'bot', text: `Hello! Welcome to ${title}. How can I help you?` }]);
                                        }}
                                        className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-600"
                                        title="Clear chat history"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                )}
                                {/* Minimize */}
                                <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-gray-100 rounded transition-colors text-gray-600" title="Minimize">
                                    <Minimize2 size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Filter Popup */}
                        <AnimatePresence>
                            {showTicketFilterPopup && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                                >
                                    <motion.div
                                        initial={{ scale: 0.9, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.9, y: 20 }}
                                        className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
                                    >
                                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                            <h3 className="font-semibold text-gray-800">Filter Tickets</h3>
                                            <button
                                                onClick={() => setShowTicketFilterPopup(false)}
                                                className="text-gray-400 hover:text-gray-600 p-1"
                                            >
                                                <XCircle size={20} />
                                            </button>
                                        </div>

                                        <div className="p-4 grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                                            <button onClick={() => handleTicketFilterSubmit(1)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">🆕 New</button>
                                            <button onClick={() => handleTicketFilterSubmit(2)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">⚙️ Processing</button>
                                            <button onClick={() => handleTicketFilterSubmit(4)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">⏳ Pending</button>
                                            <button onClick={() => handleTicketFilterSubmit(10)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">👍 Approved</button>
                                            <button onClick={() => handleTicketFilterSubmit(5)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">✅ Solved</button>
                                            <button onClick={() => handleTicketFilterSubmit(6)} className="p-2 text-sm text-left border rounded hover:bg-blue-50 hover:border-blue-200 text-gray-700">🔒 Closed</button>
                                        </div>

                                        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                                            <button
                                                onClick={() => setShowTicketFilterPopup(false)}
                                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Ticket ID Popup */}
                        <AnimatePresence>
                            {showTicketIdPopup && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                                >
                                    <motion.div
                                        initial={{ scale: 0.9, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.9, y: 20 }}
                                        className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
                                    >
                                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                            <h3 className="font-semibold text-gray-800">View Ticket</h3>
                                            <button
                                                onClick={() => setShowTicketIdPopup(false)}
                                                className="text-gray-400 hover:text-gray-600 p-1"
                                            >
                                                <XCircle size={20} />
                                            </button>
                                        </div>

                                        <form onSubmit={handleTicketIdSubmit} className="p-4 space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Ticket Number <span className="text-red-500">*</span>
                                                </label>
                                                <input
                                                    type="text"
                                                    value={ticketIdInput}
                                                    onChange={(e) => setTicketIdInput(e.target.value)}
                                                    placeholder="e.g. 12345"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                                                    style={{ '--tw-ring-color': primaryColor }}
                                                    autoFocus
                                                />
                                            </div>

                                            <div className="flex gap-3 pt-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowTicketIdPopup(false)}
                                                    className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={!ticketIdInput.trim()}
                                                    className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-md transition-shadow shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                                                    style={{ backgroundColor: primaryColor }}
                                                >
                                                    Show
                                                </button>
                                            </div>
                                        </form>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Login Prompt Popup - for guests */}
                        <AnimatePresence>
                            {showLoginPrompt && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                                >
                                    <motion.div
                                        initial={{ scale: 0.9, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.9, y: 20 }}
                                        className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden"
                                    >
                                        <div className="p-4 border-b border-gray-100 flex justify-between items-center" style={{ backgroundColor: primaryColor }}>
                                            <h3 className="font-semibold text-white">🔐 Login to Project IQ</h3>
                                            <button
                                                onClick={() => setShowLoginPrompt(false)}
                                                className="text-white/70 hover:text-white p-1"
                                            >
                                                <XCircle size={20} />
                                            </button>
                                        </div>

                                        <form onSubmit={handleLogin} className="p-4 space-y-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                                <div className="relative">
                                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                    <input
                                                        type="text"
                                                        value={loginUsername}
                                                        onChange={(e) => setLoginUsername(e.target.value)}
                                                        placeholder="Username"
                                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none transition-all"
                                                        style={{ '--tw-ring-color': primaryColor }}
                                                        disabled={isLoggingIn}
                                                        autoFocus
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                                <div className="relative">
                                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                    <input
                                                        type="password"
                                                        value={loginPassword}
                                                        onChange={(e) => setLoginPassword(e.target.value)}
                                                        placeholder="Password"
                                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none transition-all"
                                                        style={{ '--tw-ring-color': primaryColor }}
                                                        disabled={isLoggingIn}
                                                    />
                                                </div>
                                            </div>

                                            {loginError && (
                                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                                                    ❌ {loginError}
                                                </div>
                                            )}

                                            <div className="flex gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowLoginPrompt(false)}
                                                    className="flex-1 px-4 py-2.5 text-gray-700 font-medium bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={isLoggingIn}
                                                    className="flex-1 py-2.5 text-white font-medium rounded-lg transition-all disabled:opacity-50"
                                                    style={{ backgroundColor: primaryColor }}
                                                >
                                                    {isLoggingIn ? 'Signing in...' : 'Login'}
                                                </button>
                                            </div>
                                        </form>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Login Form - Show when not authenticated AND not guest (legacy - for apps that require login) */}
                        {/* For guest mode, users see the chat directly */}
                        {!isAuthenticated && !isGuest ? (
                            <div className="flex-1 flex flex-col p-6 bg-gray-50/50">
                                <div className="w-full max-w-sm mx-auto flex-1 flex flex-col justify-center">
                                    <div className="text-center mb-6">
                                        <div
                                            className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-3xl text-white"
                                            style={{ backgroundColor: primaryColor }}
                                        >
                                            🔐
                                        </div>
                                        <h2 className="text-xl font-semibold text-gray-800">Project IQ Login</h2>
                                        <p className="text-sm text-gray-500 mt-1">Please sign in to continue</p>
                                    </div>

                                    <form onSubmit={handleLogin} className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                            <div className="relative">
                                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                <input
                                                    type="text"
                                                    value={loginUsername}
                                                    onChange={(e) => setLoginUsername(e.target.value)}
                                                    placeholder="Enter your username"
                                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none transition-all"
                                                    style={{ '--tw-ring-color': primaryColor }}
                                                    disabled={isLoggingIn}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                            <div className="relative">
                                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                                <input
                                                    type="password"
                                                    value={loginPassword}
                                                    onChange={(e) => setLoginPassword(e.target.value)}
                                                    placeholder="Enter your password"
                                                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:border-transparent outline-none transition-all"
                                                    style={{ '--tw-ring-color': primaryColor }}
                                                    disabled={isLoggingIn}
                                                />
                                            </div>
                                        </div>

                                        {loginError && (
                                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                                                ❌ {loginError}
                                            </div>
                                        )}

                                        <button
                                            type="submit"
                                            disabled={isLoggingIn}
                                            className="w-full py-2.5 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            style={{
                                                backgroundColor: primaryColor,
                                                boxShadow: `0 4px 14px ${shadowColor}`
                                            }}
                                        >
                                            {isLoggingIn ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                                    Signing in...
                                                </span>
                                            ) : (
                                                'Sign In'
                                            )}
                                        </button>
                                    </form>
                                </div>

                            </div>
                        ) : (
                            <>
                                {/* Messages Area - Only show when authenticated */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50" style={{ fontSize: `${messageFontSize}px` }}>
                                    {messages.map(msg => (
                                        <MessageBubble
                                            key={msg.id}
                                            message={msg}
                                            onButtonClick={handleButtonClick}
                                            onFeedback={handleFeedback}
                                            themeColor={primaryColor}
                                            botIcon={botIcon}
                                            botIconColor={botIconColor}
                                            userIcon={userIcon}
                                            userIconColor={userIconColor}
                                            buttonFontSize={buttonFontSize}
                                        />
                                    ))}
                                    {isLoading && (
                                        <div className="flex items-center space-x-2 text-gray-400 text-sm ml-2">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>

                                {/* Quick Actions - Fixed Buttons */}
                                <div className="px-4 py-2 bg-transparent overflow-x-auto flex gap-2 no-scrollbar border-t border-gray-50">
                                    {[
                                        { label: 'Create Ticket', payload: '/create_ticket' },
                                        { label: 'List Tickets', payload: '/list_tickets' },
                                        { label: 'Check Status', payload: '/check_status' },
                                        { label: 'Help', payload: '/help' }
                                    ].map((action, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleButtonClick(action.payload)}
                                            className="flex-shrink-0 px-3 py-1.5 bg-transparent border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 text-[11px] rounded-full transition-colors whitespace-nowrap"
                                            style={{
                                                fontSize: '12px'
                                            }}
                                        >
                                            {action.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Input Area */}
                                <form onSubmit={handleSendMessage} className="p-4 bg-white flex items-center gap-2">
                                    <div className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-2 focus-within:ring-2 transition-all shadow-sm border border-gray-200" style={{ '--tw-ring-color': `${primaryColor}80` }}>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            onChange={handleFileSelect}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            className="text-gray-400 hover:text-gray-600 transition-colors mr-2"
                                            style={{ '--hover-color': primaryColor }}
                                            onMouseEnter={(e) => e.target.style.color = primaryColor}
                                            onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                                            title="Attach File"
                                        >
                                            <Paperclip size={20} />
                                        </button>
                                        <input
                                            type="text"
                                            value={inputText}
                                            onChange={(e) => setInputText(e.target.value)}
                                            placeholder="Message Project IQ..."
                                            className="flex-1 bg-transparent text-gray-800 focus:outline-none font-light py-1"
                                            style={{ fontSize: `${inputFontSize}px` }}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!inputText.trim() || isLoading}
                                            className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-2"
                                            onMouseEnter={(e) => !e.target.disabled && (e.target.style.color = primaryColor)}
                                            onMouseLeave={(e) => !e.target.disabled && (e.target.style.color = '#9ca3af')}
                                        >
                                            <Send size={20} />
                                        </button>
                                    </div>
                                </form>
                                {/* Privacy Consent Popup - Dismissible - Absolute Positioned */}
                                <AnimatePresence>
                                    {showPrivacyPopup && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 10 }}
                                            className="absolute bottom-24 left-4 right-4 p-4 bg-blue-50/95 backdrop-blur-sm border border-blue-200 rounded-lg shadow-xl z-50"
                                        >
                                            <button
                                                onClick={() => {
                                                    setShowPrivacyPopup(false);
                                                    setCookie(getStorageKey(appId, 'privacyDismissed'), 'true');
                                                }}
                                                className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-black/5 transition-colors"
                                                title="Dismiss"
                                            >
                                                <X size={16} />
                                            </button>
                                            <div className="text-sm text-blue-900 pr-6 leading-snug">
                                                <p className="font-semibold mb-1">Privacy Notice</p>
                                                By chatting, you consent to the chats being recorded, used, and shared by us and our service providers according to our
                                                <div className="mt-2 flex gap-3">
                                                    <a href="/privacy_notice.html" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900 font-medium">Privacy Notice</a>
                                                    <a href="/cookies_policy.html" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline hover:text-blue-900 font-medium">Cookies Policy</a>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>


                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            {/* Animated Chat Icon Button - Show when closed */}
            {!isOpen && (
                <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    onClick={() => setIsOpen(true)}
                    className="cursor-pointer"
                >
                    <AnimatedChatIcon size={64} themeColor={primaryColor} />
                </motion.div>
            )}
        </div >
    );
};

export default ChatWindow;
