import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, Minimize2, X, User, Lock, XCircle, Sparkles, History, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from './MessageBubble';
import AnimatedChatIcon from './AnimatedChatIcon';
import { v4 as uuidv4 } from 'uuid';
import { getCookie, setCookie, deleteCookie } from '../utils/cookieUtils';

const RASA_API_URL = `${window.location.protocol}//${window.location.hostname}:5005/webhooks/rest/webhook`;
const ADMIN_API_URL = window.location.origin;

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

    const [sessionEnded, setSessionEnded] = useState(false);
    const isWelcomeState = messages.length === 1 && messages[0]?.id === 'init';

    // Inactivity timeout
    const [timeoutMinutes, setTimeoutMinutes] = useState(10);
    const lastActivityRef = useRef(Date.now());
    const warningShownRef = useRef(false);
    const sessionEndedRef = useRef(false);
    const inactivityIntervalRef = useRef(null);
    const [showTicketFilterPopup, setShowTicketFilterPopup] = useState(false);
    const [showTicketIdPopup, setShowTicketIdPopup] = useState(false);
    const [ticketIdInput, setTicketIdInput] = useState('');
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [historyView, setHistoryView] = useState('chat'); // 'chat' | 'history' | 'session'
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(false);
    const userMenuRef = useRef(null);
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

    // Fetch session timeout from admin config on mount
    useEffect(() => {
        fetch(`${ADMIN_API_URL}/admin/config/SESSION_TIMEOUT_MINUTES`)
            .then(r => r.json())
            .then(d => {
                const val = parseInt(d.value || d.SESSION_TIMEOUT_MINUTES || '10', 10);
                if (!isNaN(val) && val > 0) setTimeoutMinutes(val);
            })
            .catch(() => {}); // silently fall back to default 10
    }, []);

    // Close user menu on outside click
    useEffect(() => {
        const handler = (e) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setShowUserMenu(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Inactivity timer — runs while chat is open and session is active
    useEffect(() => {
        if (!isOpen || sessionEndedRef.current) {
            clearInterval(inactivityIntervalRef.current);
            return;
        }

        // Reset on open only if session is not ended
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        inactivityIntervalRef.current = setInterval(() => {
            // Use ref to avoid stale closure
            if (sessionEndedRef.current) {
                clearInterval(inactivityIntervalRef.current);
                return;
            }
            const idleMs = Date.now() - lastActivityRef.current;
            const timeoutMs = timeoutMinutes * 60 * 1000;
            const warningMs = (timeoutMinutes - 2) * 60 * 1000;

            if (idleMs >= timeoutMs) {
                clearInterval(inactivityIntervalRef.current);
                sessionEndedRef.current = true;
                setSessionEnded(true);
                setMessages(prev => {
                    if (prev.some(m => m.type === 'system')) return prev;
                    return [...prev, {
                        id: uuidv4(),
                        sender: 'bot',
                        text: '**Session ended due to inactivity.** Thank you for chatting! Start a new conversation anytime.',
                        type: 'system',
                    }];
                });
            } else if (idleMs >= warningMs && !warningShownRef.current) {
                warningShownRef.current = true;
                setMessages(prev => {
                    if (prev.some(m => m.type === 'warning')) return prev;
                    return [...prev, {
                        id: uuidv4(),
                        sender: 'bot',
                        text: `⏰ **Still there?** You've been inactive for ${timeoutMinutes - 2} minute${timeoutMinutes - 2 !== 1 ? 's' : ''}. Your session will end automatically in **2 minutes** if there's no activity.`,
                        type: 'warning',
                    }];
                });
            }
        }, 15000);

        return () => clearInterval(inactivityIntervalRef.current);
    }, [isOpen, timeoutMinutes]);

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

    // Fetch conversation history list from DB
    const fetchUserHistory = async () => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const res = await fetch(`${ADMIN_API_URL}/api/user/conversations?user_name=${encodeURIComponent(authUser)}&app_id=${encodeURIComponent(appId)}`);
            const data = await res.json();
            if (data.success) setSessions(data.data);
        } catch (e) {
            console.error('Failed to fetch history', e);
        } finally {
            setHistoryLoading(false);
        }
    };

    // Fetch messages for a selected session
    const fetchSessionMessages = async (session) => {
        setSessionLoading(true);
        try {
            const res = await fetch(`${ADMIN_API_URL}/api/user/conversation/${encodeURIComponent(session.sender_id)}/messages`);
            const data = await res.json();
            if (data.success) {
                setSelectedSession({ ...session, messages: data.data });
                setHistoryView('session');
            }
        } catch (e) {
            console.error('Failed to fetch session messages', e);
        } finally {
            setSessionLoading(false);
        }
    };

    // Handle Logout - returns to guest mode
    const handleLogout = () => {
        setIsAuthenticated(false);
        setIsGuest(true);
        sessionEndedRef.current = false;
        setSessionEnded(false);
        setAuthUser('');
        deleteCookie(getStorageKey(appId, 'isAuthenticated'));
        deleteCookie(getStorageKey(appId, 'authUser'));
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        setMessages([{ id: 'init', sender: 'bot', text: `You've been logged out. Continuing as guest.\n\n📚 You can still search the Knowledge Base and ask questions!\n🔑 Login anytime for full ticket features.` }]);
    };

    const handleEndSession = () => {
        clearInterval(inactivityIntervalRef.current);
        sessionEndedRef.current = true;
        setSessionEnded(true);
        setMessages(prev => {
            if (prev.some(m => m.type === 'system')) return prev;
            return [...prev, {
                id: uuidv4(),
                sender: 'bot',
                text: '**Session ended.** Thank you for chatting! Start a new conversation anytime.'
            }];
        });
    };

    const handleNewConversation = () => {
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;
        sessionEndedRef.current = false;
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        deleteCookie(getStorageKey(appId, 'senderId'));
        const newId = uuidv4();
        setCookie(getStorageKey(appId, 'senderId'), newId);
        setSessionEnded(false);
        const welcomeMsg = isAuthenticated && authUser
            ? `**Hi ${authUser}!**\n\nWelcome back. How can I help you today?`
            : `**Hi, I'm ${title}** 👋\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*`;
        setMessages([{ id: 'init', sender: 'bot', text: welcomeMsg }]);
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
        // Reset inactivity timer on user action
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

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
        // Reset inactivity timer on user action
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

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
                        {/* Header — Gemini style: hamburger | title | avatar */}
                        <div
                            className="flex items-center justify-between px-2 py-3"
                            style={{ backgroundColor: bgColor, color: textColor }}
                        >
                            {/* Left: hamburger / minimize */}
                            <button
                                onClick={() => setIsOpen(false)}
                                className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600"
                                title="Close"
                            >
                                <Minimize2 size={18} />
                            </button>

                            {/* Center: title */}
                            <h1
                                className="font-normal text-gray-800 tracking-wide"
                                style={{ fontSize: `${parseInt(headerFontSize) + 2}px` }}
                            >
                                {title}
                            </h1>

                            {/* Right: avatar dropdown / login */}
                            <div className="flex items-center gap-1" ref={userMenuRef}>
                                {isAuthenticated && !isGuest ? (
                                    <div className="relative">
                                        <button
                                            onClick={() => setShowUserMenu(v => !v)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold focus:outline-none"
                                            style={{ backgroundColor: primaryColor }}
                                        >
                                            {authUser ? authUser[0].toUpperCase() : 'U'}
                                        </button>
                                        {showUserMenu && (
                                            <div className="absolute right-0 top-10 w-56 rounded-xl shadow-2xl z-[80] overflow-hidden" style={{ backgroundColor: '#ffffff', border: '1px solid rgba(0,0,0,0.08)' }}>
                                                {/* User info */}
                                                <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
                                                    <div className="font-semibold text-sm" style={{ color: '#111827' }}>{authUser}</div>
                                                    <div className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>{authUser}</div>
                                                </div>
                                                {/* Menu items */}
                                                <div className="py-1">
                                                    <button className="w-full text-left px-4 py-2.5 text-sm transition-colors" style={{ color: '#4b5563' }}
                                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                    >
                                                        My Profile
                                                    </button>
                                                    <button
                                                        className="w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors"
                                                        style={{ color: '#111827' }}
                                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                        onClick={() => { setShowUserMenu(false); fetchUserHistory(); setHistoryView('history'); }}
                                                    >
                                                        History
                                                    </button>
                                                    {!isWelcomeState && !sessionEnded && (
                                                        <button
                                                            className="w-full text-left px-4 py-2.5 text-sm font-semibold transition-colors"
                                                            style={{ color: '#111827' }}
                                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            onClick={() => { setShowUserMenu(false); handleEndSession(); }}
                                                        >
                                                            End This Conversation
                                                        </button>
                                                    )}
                                                </div>
                                                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }} className="py-1">
                                                    <button
                                                        className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                                                        style={{ color: '#4b5563' }}
                                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                        onClick={() => { setShowUserMenu(false); handleLogout(); }}
                                                    >
                                                        Logout
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setShowLoginPrompt(true)}
                                        className="p-1.5 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                                        title="Login"
                                    >
                                        <User size={18} />
                                    </button>
                                )}
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

                        {/* History List Panel */}
                        <AnimatePresence>
                            {historyView === 'history' && (
                                <motion.div
                                    initial={{ x: -400, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: -400, opacity: 0 }}
                                    transition={{ type: 'tween', duration: 0.22 }}
                                    className="absolute inset-0 z-[60] flex flex-col"
                                    style={{ backgroundColor: bgColor }}
                                >
                                    {/* Panel header */}
                                    <div className="flex items-center gap-2 px-2 py-3 border-b border-gray-100" style={{ backgroundColor: bgColor }}>
                                        <button
                                            onClick={() => setHistoryView('chat')}
                                            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <h2 className="font-normal text-gray-800 text-base flex-1 text-center pr-8">Conversation History</h2>
                                    </div>
                                    {/* Session list */}
                                    <div className="flex-1 overflow-y-auto p-3 space-y-1" style={{ backgroundColor: '#f9fafb' }}>
                                        {historyLoading ? (
                                            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 pt-10">
                                                <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                                                <p className="text-sm">Loading history...</p>
                                            </div>
                                        ) : sessions.length === 0 ? (
                                            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 pt-10">
                                                <History size={32} strokeWidth={1.2} />
                                                <p className="text-sm">No previous conversations</p>
                                            </div>
                                        ) : (() => {
                                            const formatLabel = (iso) => {
                                                const d = new Date(iso);
                                                const today = new Date();
                                                const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                                                if (d.toDateString() === today.toDateString()) return 'Today';
                                                if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                                                return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
                                            };
                                            const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                            const grouped = sessions.reduce((acc, s) => {
                                                const lbl = formatLabel(s.started_at);
                                                (acc[lbl] = acc[lbl] || []).push(s);
                                                return acc;
                                            }, {});
                                            return Object.entries(grouped).map(([label, group]) => (
                                                <div key={label}>
                                                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-1 py-2">{label}</div>
                                                    {group.map(session => (
                                                        <button
                                                            key={session.sender_id}
                                                            onClick={() => fetchSessionMessages(session)}
                                                            disabled={sessionLoading}
                                                            className="w-full text-left bg-white rounded-xl px-4 py-3 mb-1.5 shadow-sm border border-gray-100 hover:border-gray-300 hover:shadow transition-all disabled:opacity-50"
                                                        >
                                                            <div className="text-xs text-gray-400 mb-1">{formatLabel(session.started_at)} · {formatTime(session.started_at)}</div>
                                                            <div className="text-sm text-gray-700 truncate">"{session.preview}"</div>
                                                        </button>
                                                    ))}
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Session Read-Only View Panel */}
                        <AnimatePresence>
                            {historyView === 'session' && selectedSession && (
                                <motion.div
                                    initial={{ x: 400, opacity: 0 }}
                                    animate={{ x: 0, opacity: 1 }}
                                    exit={{ x: 400, opacity: 0 }}
                                    transition={{ type: 'tween', duration: 0.22 }}
                                    className="absolute inset-0 z-[61] flex flex-col"
                                    style={{ backgroundColor: bgColor }}
                                >
                                    {/* Panel header */}
                                    <div className="flex items-center gap-2 px-2 py-3 border-b border-gray-100" style={{ backgroundColor: bgColor }}>
                                        <button
                                            onClick={() => { setHistoryView('history'); setSelectedSession(null); }}
                                            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600"
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <h2 className="font-normal text-gray-700 text-sm flex-1 truncate pr-2">
                                            {new Date(selectedSession.started_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short' })} · {selectedSession.preview.slice(0, 35)}{selectedSession.preview.length > 35 ? '...' : ''}
                                        </h2>
                                    </div>
                                    {/* Messages read-only */}
                                    <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-gray-50/50" style={{ fontSize: `${messageFontSize}px` }}>
                                        {sessionLoading ? (
                                            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                                                <svg className="animate-spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                                                <p className="text-sm">Loading messages...</p>
                                            </div>
                                        ) : (selectedSession.messages || []).map(msg => (
                                            <MessageBubble
                                                key={msg.id}
                                                message={msg}
                                                readonly={true}
                                                themeColor={primaryColor}
                                                botIcon={botIcon}
                                                botIconColor={botIconColor}
                                                userIcon={userIcon}
                                                userIconColor={userIconColor}
                                                buttonFontSize={buttonFontSize}
                                            />
                                        ))}
                                    </div>
                                    {/* Read-only footer strip */}
                                    <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-center gap-1.5 bg-gray-50 text-xs text-gray-400">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                        Read-only · {new Date(selectedSession.started_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(selectedSession.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
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
                                {/* Messages Area */}
                                {isWelcomeState ? (
                                    /* Welcome state — Gemini style */
                                    <div className="flex-1 overflow-y-auto p-5" style={{ backgroundColor: '#EEF2FA' }}>
                                        <div className="mb-1 text-2xl font-normal text-gray-800">
                                            Hi {isAuthenticated && authUser ? authUser : 'there'}
                                        </div>
                                        <div className="mb-6 text-2xl font-semibold text-gray-800">
                                            Where should we start?
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {[
                                                { label: '📝 Create Ticket', payload: '/create_ticket' },
                                                { label: '📋 My Tickets', payload: '/list_tickets' },
                                                { label: '🔍 Check Status', payload: '/check_status' },
                                                { label: '❓ Get Help', payload: '/help' },
                                            ].map((action, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => handleButtonClick(action.payload)}
                                                    className="px-4 py-2 bg-white rounded-full shadow-sm hover:shadow-md text-gray-700 text-sm font-normal transition-shadow whitespace-nowrap"
                                                >
                                                    {action.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
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
                                )}

                                {/* Quick Actions - single row, no scroll */}
                                {!isWelcomeState && !sessionEnded && (
                                    <div className="px-3 py-1.5 flex gap-1.5 border-t border-gray-100">
                                        {[
                                            { label: 'Create Ticket', payload: '/create_ticket' },
                                            { label: 'List Tickets', payload: '/list_tickets' },
                                            { label: 'Check Status', payload: '/check_status' },
                                            { label: 'Help', payload: '/help' }
                                        ].map((action, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handleButtonClick(action.payload)}
                                                className="flex-1 py-1 bg-transparent border border-gray-200 hover:bg-gray-50 text-gray-500 hover:text-gray-700 rounded-full transition-colors text-center"
                                                style={{ fontSize: '11px' }}
                                            >
                                                {action.label}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {/* Input Area or New Conversation */}
                                {sessionEnded ? (
                                    <div
                                        className="p-4 flex justify-center"
                                        style={{ backgroundColor: bgColor }}
                                    >
                                        <button
                                            onClick={handleNewConversation}
                                            className="flex items-center gap-2 px-6 py-3 text-white rounded-full font-semibold text-sm transition-all shadow-md hover:shadow-lg"
                                            style={{ backgroundColor: primaryColor }}
                                            onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                                            onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                                            New Conversation
                                        </button>
                                    </div>
                                ) : (
                                    <form
                                        onSubmit={handleSendMessage}
                                        className="p-4 flex items-center gap-2"
                                        style={{ backgroundColor: isWelcomeState ? '#EEF2FA' : bgColor }}
                                    >
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
                                )}
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
