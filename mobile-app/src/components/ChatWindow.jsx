import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, RefreshCw, X, Trash2, LogOut, User, Lock, XCircle, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from './MessageBubble';
import { v4 as uuidv4 } from 'uuid';
import { getItem, setItem, removeItem, getLocalItem, setLocalItem, removeLocalItem } from '../utils/storage';
import { getApiUrl, WEBHOOK_PATH } from '../config';

// Storage keys with appId prefix for multi-widget support
const getStorageKey = (appId, key) => `glpi-chat-${appId}-${key}`;

const ChatWindow = ({ title = "Project IQ", appId = "General", onOpenSettings }) => {
    const primaryColor = '#000000';
    const shadowColor = `${primaryColor}4D`;

    // API URL state
    const [apiUrl, setApiUrlState] = useState('');

    // Load API URL on mount
    useEffect(() => {
        (async () => {
            const url = await getApiUrl();
            setApiUrlState(url);
        })();
    }, []);

    const RASA_API_URL = `${apiUrl}${WEBHOOK_PATH}`;

    // Authentication state - loaded async from Capacitor Preferences
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isGuest, setIsGuest] = useState(true);
    const [authUser, setAuthUser] = useState('');
    const [senderId, setSenderId] = useState('');
    const [authLoaded, setAuthLoaded] = useState(false);

    // Load auth state from Preferences on mount
    useEffect(() => {
        (async () => {
            const storedAuth = await getItem(getStorageKey(appId, 'isAuthenticated'));
            const storedUser = await getItem(getStorageKey(appId, 'authUser'));
            let storedSenderId = await getItem(getStorageKey(appId, 'senderId'));

            if (!storedSenderId) {
                storedSenderId = uuidv4();
                await setItem(getStorageKey(appId, 'senderId'), storedSenderId);
            }

            setSenderId(storedSenderId);

            if (storedAuth === 'true') {
                setIsAuthenticated(true);
                setIsGuest(false);
                setAuthUser(storedUser || '');
            }

            setAuthLoaded(true);
        })();
    }, [appId]);

    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);

    // Load saved messages from localStorage
    const [messages, setMessages] = useState(() => {
        const saved = getLocalItem(getStorageKey(appId, 'messages'));
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch (e) { /* ignore */ }
        }
        return [{ id: 'init', sender: 'bot', text: `**Hi, I'm ${title}** 👋\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*` }];
    });

    // Reinitialize welcome message after auth loads
    useEffect(() => {
        if (!authLoaded) return;
        const saved = getLocalItem(getStorageKey(appId, 'messages'));
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return; // already have messages
            } catch (e) { /* ignore */ }
        }
        if (isAuthenticated && authUser) {
            setMessages([{ id: 'init', sender: 'bot', text: `**Hi ${authUser}!**\n\nWelcome back. How can I help you today?` }]);
        }
    }, [authLoaded, isAuthenticated, authUser, appId]);

    const [showPrivacyPopup, setShowPrivacyPopup] = useState(false);
    const [showTicketFilterPopup, setShowTicketFilterPopup] = useState(false);
    const [showTicketIdPopup, setShowTicketIdPopup] = useState(false);
    const [ticketIdInput, setTicketIdInput] = useState('');
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Save messages to localStorage whenever they change
    useEffect(() => {
        setLocalItem(getStorageKey(appId, 'messages'), JSON.stringify(messages));
    }, [messages, appId]);

    useEffect(() => { scrollToBottom(); }, [messages]);

    // Handle Login
    const handleLogin = async (e) => {
        e.preventDefault();
        if (!loginUsername.trim() || !loginPassword.trim()) {
            setLoginError('Please enter both username and password');
            return;
        }
        if (!apiUrl) {
            setLoginError('API URL not configured. Go to Settings first.');
            return;
        }

        setIsLoggingIn(true);
        setLoginError('');

        try {
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
            let loginSuccess = false;
            let errorMsg = 'Login failed. Please check your credentials.';

            for (const msg of data) {
                if (msg.custom?.login_success) { loginSuccess = true; break; }
                if (msg.custom?.login_error) { errorMsg = msg.custom.error || errorMsg; break; }
                if (msg.text && msg.text.includes('Welcome')) loginSuccess = true;
                if (msg.text && msg.text.includes('failed')) errorMsg = msg.text;
            }

            if (loginSuccess) {
                setIsAuthenticated(true);
                setIsGuest(false);
                setShowLoginPrompt(false);
                setAuthUser(loginUsername);
                await setItem(getStorageKey(appId, 'isAuthenticated'), 'true');
                await setItem(getStorageKey(appId, 'authUser'), loginUsername);
                await removeItem(getStorageKey(appId, 'privacyDismissed'));
                setShowPrivacyPopup(true);

                const welcomeData = data.find(m => m.text);
                const welcomeMsg = welcomeData?.text || `Welcome, ${loginUsername}! How can I help you?`;
                const welcomeButtons = welcomeData?.buttons || [];
                setMessages([{ id: uuidv4(), sender: 'bot', text: welcomeMsg, buttons: welcomeButtons }]);

                setLoginUsername('');
                setLoginPassword('');
            } else {
                setLoginError(errorMsg);
            }
        } catch (error) {
            console.error('Login error:', error);
            setLoginError('Connection error. Please check your API URL in Settings.');
        } finally {
            setIsLoggingIn(false);
        }
    };

    // Handle Logout
    const handleLogout = async () => {
        setIsAuthenticated(false);
        setIsGuest(true);
        setAuthUser('');
        await removeItem(getStorageKey(appId, 'isAuthenticated'));
        await removeItem(getStorageKey(appId, 'authUser'));
        removeLocalItem(getStorageKey(appId, 'messages'));
        setMessages([{ id: 'init', sender: 'bot', text: `You've been logged out. Continuing as guest.\n\n📚 You can still search the Knowledge Base and ask questions!\n🔑 Login anytime for full ticket features.` }]);
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 2 * 1024 * 1024) {
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ File too large. Max 2MB." }]);
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result.split(',')[1];
            const entities = { file_name: file.name, file_data: base64 };
            const payload = `/upload_file${JSON.stringify(entities)}`;

            const userMsg = { id: uuidv4(), sender: senderId, text: `📎 Uploading ${file.name}...` };
            setMessages(prev => [...prev, userMsg]);
            setIsLoading(true);

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
                    const botMessages = data.map(msg => ({ id: uuidv4(), sender: 'bot', text: msg.text }));
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
        const profanityList = ['damn', 'hell', 'crap', 'stupid', 'idiot'];
        const lowerMessage = message.toLowerCase();
        if (profanityList.some(word => lowerMessage.includes(word))) {
            return { valid: false, error: "Please keep the conversation professional." };
        }
        const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
        const creditCardPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
        if (ssnPattern.test(message)) return { valid: false, error: "Please don't share Social Security Numbers." };
        if (creditCardPattern.test(message)) return { valid: false, error: "Please don't share credit card numbers." };
        if (message.length > 500) return { valid: false, error: "Please keep your message under 500 characters." };
        const capsRatio = (message.match(/[A-Z]/g) || []).length / message.length;
        if (message.length > 20 && capsRatio > 0.7) return { valid: false, error: "Please don't use excessive CAPS." };
        return { valid: true };
    };

    // Handle feedback
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
        } catch (error) {
            console.error('Error sending feedback:', error);
        }
    };

    const handleTicketFilterSubmit = (statusId) => {
        setShowTicketFilterPopup(false);
        const payload = `/list_tickets{"status_id": ${statusId}}`;
        handleButtonClick(payload);
    };

    // Handle button clicks
    const handleButtonClick = async (payload) => {
        if (payload === '__LOGIN__') { setShowLoginPrompt(true); return; }

        const restrictedPayloads = ['/create_ticket', '/list_tickets', '/check_status', '/update_ticket', '/verify_resolution'];
        if (isGuest && restrictedPayloads.some(p => payload.startsWith(p))) {
            const actionName = payload.includes('create') ? 'create tickets' :
                payload.includes('list') ? 'view your tickets' :
                    payload.includes('check') ? 'check ticket status' : 'manage tickets';
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: `🔐 **Login Required**\n\nTo ${actionName}, please login with your Project IQ credentials.`,
                buttons: [
                    { title: '🔑 Login Now', payload: '__LOGIN__' },
                    { title: '📚 Search KB Instead', payload: '/ask_knowledge' }
                ]
            }]);
            return;
        }

        if (payload === '/check_status') { setShowTicketIdPopup(true); return; }
        if (payload === '/list_tickets' && !payload.includes('{')) { setShowTicketFilterPopup(true); return; }

        const message = payload.startsWith('/') ? payload : `/${payload}`;
        let displayText = payload;
        if (payload.startsWith('/submit_ticket_form')) {
            try {
                const jsonStr = payload.replace('/submit_ticket_form', '');
                const data = JSON.parse(jsonStr);
                displayText = `📝 Ticket Request:\n${data.title} (${data.category})\nPriority: ${data.priority}`;
            } catch (e) { displayText = '📝 Submitting Ticket...'; }
        } else if (payload.includes('status_id')) {
            displayText = "🔍 Filtering tickets...";
        }

        const userMsg = { id: uuidv4(), sender: senderId, text: displayText };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        try {
            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: senderId, message: message, metadata: { app_id: appId } }),
            });
            const data = await response.json();
            if (data && data.length > 0) {
                let lastTextMessage = null;
                const processedMessages = [];
                for (const msg of data) {
                    if (msg.text) {
                        lastTextMessage = { id: uuidv4(), sender: 'bot', text: msg.text, buttons: msg.buttons, chart: msg.chart || msg.custom?.chart, video: msg.custom?.video, ticket_form: msg.custom?.ticket_form };
                        processedMessages.push(lastTextMessage);
                    } else if (msg.custom?.chart && lastTextMessage) { lastTextMessage.chart = msg.custom.chart; }
                    else if (msg.custom?.chart) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', chart: msg.custom.chart }); }
                    else if (msg.custom?.video && lastTextMessage) { lastTextMessage.video = msg.custom.video; }
                    else if (msg.custom?.video) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', video: msg.custom.video }); }
                    else if (msg.custom?.ticket_form && lastTextMessage) { lastTextMessage.ticket_form = msg.custom.ticket_form; }
                    else if (msg.custom?.ticket_form) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', ticket_form: msg.custom.ticket_form, buttons: [] }); }
                }
                if (processedMessages.length > 0) setMessages(prev => [...prev, ...processedMessages]);
            }
        } catch (error) {
            console.error("Error:", error);
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ Error connecting to server. Check your API URL in Settings." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim()) return;

        if (!apiUrl) {
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ API URL not configured. Please go to Settings to set your Rasa server URL." }]);
            setInputText('');
            return;
        }

        const validation = validateInput(inputText);
        if (!validation.valid) {
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: `⚠️ ${validation.error}` }]);
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
                body: JSON.stringify({ sender: senderId, message: userMsg.text, metadata: { app_id: appId } }),
            });
            const data = await response.json();
            if (data && data.length > 0) {
                let lastTextMessage = null;
                const processedMessages = [];
                for (const msg of data) {
                    if (msg.text) {
                        lastTextMessage = { id: uuidv4(), sender: 'bot', text: msg.text, buttons: msg.buttons, chart: msg.chart || msg.custom?.chart, video: msg.custom?.video, ticket_form: msg.custom?.ticket_form };
                        processedMessages.push(lastTextMessage);
                    } else if (msg.custom?.chart && lastTextMessage) { lastTextMessage.chart = msg.custom.chart; }
                    else if (msg.custom?.chart) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', chart: msg.custom.chart }); }
                    else if (msg.custom?.video && lastTextMessage) { lastTextMessage.video = msg.custom.video; }
                    else if (msg.custom?.video) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', video: msg.custom.video }); }
                    else if (msg.custom?.ticket_form && lastTextMessage) { lastTextMessage.ticket_form = msg.custom.ticket_form; }
                    else if (msg.custom?.ticket_form) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '', ticket_form: msg.custom.ticket_form }); }
                    else if (msg.image) { processedMessages.push({ id: uuidv4(), sender: 'bot', text: '![image](' + msg.image + ')' }); }
                }
                if (processedMessages.length > 0) setMessages(prev => [...prev, ...processedMessages]);
                else {
                    setMessages(prev => [...prev, {
                        id: uuidv4(), sender: 'bot',
                        text: "I'm not sure I understand. Here are some things I can help with:",
                        buttons: [
                            { title: "List my tickets", payload: "/list_tickets" },
                            { title: "Create a ticket", payload: "/create_ticket" },
                            { title: "Check ticket status", payload: "/check_status" },
                            { title: "Help", payload: "/help" }
                        ]
                    }]);
                }
            }
        } catch (error) {
            console.error("Error:", error);
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: "⚠️ Error connecting to server. Check your API URL in Settings." }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTicketIdSubmit = async (e) => {
        e.preventDefault();
        if (!ticketIdInput.trim()) return;
        setShowTicketIdPopup(false);
        const payload = `/check_status{"ticket_id":"${ticketIdInput.trim()}"}`;
        handleButtonClick(payload);
        setTicketIdInput('');
    };

    // Show loading screen while auth loads
    if (!authLoaded) {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-white">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-3 border-gray-200 border-t-black rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-500">Loading...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen flex flex-col bg-white safe-area-inset">
            {/* Header */}
            <div className="px-4 py-3 flex items-center justify-between bg-white border-b border-gray-100 safe-area-top">
                <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <h1 className="font-semibold text-lg text-gray-900">{title}</h1>
                    {isAuthenticated && authUser && (
                        <span className="text-xs text-gray-500">({authUser})</span>
                    )}
                    {isGuest && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Guest</span>
                    )}
                </div>
                <div className="flex items-center space-x-1">
                    {/* Settings button */}
                    {onOpenSettings && (
                        <button onClick={onOpenSettings} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500" title="Settings">
                            <Settings size={18} />
                        </button>
                    )}
                    {/* Login button for guests */}
                    {isGuest && (
                        <button onClick={() => setShowLoginPrompt(true)} className="px-3 py-1.5 text-xs bg-black text-white rounded-full transition-colors" title="Login">
                            🔑 Login
                        </button>
                    )}
                    {/* Logout */}
                    {isAuthenticated && !isGuest && (
                        <button onClick={handleLogout} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500" title="Logout">
                            <LogOut size={18} />
                        </button>
                    )}
                    {/* Clear History */}
                    {isAuthenticated && (
                        <button
                            onClick={async () => {
                                removeLocalItem(getStorageKey(appId, 'messages'));
                                await removeItem(getStorageKey(appId, 'senderId'));
                                const newId = uuidv4();
                                await setItem(getStorageKey(appId, 'senderId'), newId);
                                setSenderId(newId);
                                setMessages([{ id: 'init', sender: 'bot', text: `Hello! Welcome to ${title}. How can I help you?` }]);
                            }}
                            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500"
                            title="Clear chat history"
                        >
                            <Trash2 size={18} />
                        </button>
                    )}
                </div>
            </div>

            {/* Filter Popup */}
            <AnimatePresence>
                {showTicketFilterPopup && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h3 className="font-semibold text-gray-800">Filter Tickets</h3>
                                <button onClick={() => setShowTicketFilterPopup(false)} className="text-gray-400 hover:text-gray-600 p-1">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <div className="p-4 grid grid-cols-2 gap-3">
                                <button onClick={() => handleTicketFilterSubmit(1)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">🆕 New</button>
                                <button onClick={() => handleTicketFilterSubmit(2)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">⚙️ Processing</button>
                                <button onClick={() => handleTicketFilterSubmit(4)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">⏳ Pending</button>
                                <button onClick={() => handleTicketFilterSubmit(10)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">👍 Approved</button>
                                <button onClick={() => handleTicketFilterSubmit(5)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">✅ Solved</button>
                                <button onClick={() => handleTicketFilterSubmit(6)} className="p-3 text-sm text-left border rounded-xl hover:bg-blue-50 hover:border-blue-200 text-gray-700 transition-colors">🔒 Closed</button>
                            </div>
                            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
                                <button onClick={() => setShowTicketFilterPopup(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Ticket ID Popup */}
            <AnimatePresence>
                {showTicketIdPopup && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h3 className="font-semibold text-gray-800">View Ticket</h3>
                                <button onClick={() => setShowTicketIdPopup(false)} className="text-gray-400 hover:text-gray-600 p-1">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <form onSubmit={handleTicketIdSubmit} className="p-4 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Ticket Number <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text" value={ticketIdInput} onChange={(e) => setTicketIdInput(e.target.value)}
                                        placeholder="e.g. 12345"
                                        className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-black/20 text-base"
                                        autoFocus
                                    />
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button type="button" onClick={() => setShowTicketIdPopup(false)}
                                        className="flex-1 px-4 py-3 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Cancel</button>
                                    <button type="submit" disabled={!ticketIdInput.trim()}
                                        className="flex-1 px-4 py-3 text-sm font-medium text-white bg-black rounded-xl transition-shadow hover:shadow-md disabled:opacity-50">Show</button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Login Prompt Popup */}
            <AnimatePresence>
                {showLoginPrompt && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
                        <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-black">
                                <h3 className="font-semibold text-white">🔐 Login to Project IQ</h3>
                                <button onClick={() => setShowLoginPrompt(false)} className="text-white/70 hover:text-white p-1">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <form onSubmit={handleLogin} className="p-5 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                                    <div className="relative">
                                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        <input type="text" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)}
                                            placeholder="Username"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all text-base"
                                            disabled={isLoggingIn} autoFocus />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                                            placeholder="Password"
                                            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-black/20 focus:border-transparent outline-none transition-all text-base"
                                            disabled={isLoggingIn} />
                                    </div>
                                </div>
                                {loginError && (
                                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">❌ {loginError}</div>
                                )}
                                <div className="flex gap-3">
                                    <button type="button" onClick={() => setShowLoginPrompt(false)}
                                        className="flex-1 px-4 py-3 text-gray-700 font-medium bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">Cancel</button>
                                    <button type="submit" disabled={isLoggingIn}
                                        className="flex-1 py-3 text-white font-medium bg-black rounded-xl transition-all disabled:opacity-50">
                                        {isLoggingIn ? 'Signing in...' : 'Login'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                {messages.map(msg => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        onButtonClick={handleButtonClick}
                        onFeedback={handleFeedback}
                        themeColor={primaryColor}
                        botIcon="🤖"
                        botIconColor={primaryColor}
                        userIcon="👤"
                        userIconColor="#e5e7eb"
                        buttonFontSize="13"
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

            {/* Quick Actions */}
            <div className="px-4 py-2 bg-white overflow-x-auto flex gap-2 no-scrollbar border-t border-gray-100">
                {[
                    { label: '📝 Create Ticket', payload: '/create_ticket' },
                    { label: '📋 List Tickets', payload: '/list_tickets' },
                    { label: '🔍 Check Status', payload: '/check_status' },
                    { label: '❓ Help', payload: '/help' }
                ].map((action, idx) => (
                    <button key={idx} onClick={() => handleButtonClick(action.payload)}
                        className="flex-shrink-0 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-full transition-colors whitespace-nowrap">
                        {action.label}
                    </button>
                ))}
            </div>

            {/* Input Area */}
            <form onSubmit={handleSendMessage} className="p-3 bg-white flex items-center gap-2 safe-area-bottom border-t border-gray-100">
                <div className="flex-1 flex items-center bg-gray-100 rounded-full px-4 py-2.5 focus-within:ring-2 focus-within:ring-black/20 transition-all border border-gray-200">
                    <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="text-gray-400 hover:text-gray-600 transition-colors mr-2" title="Attach File">
                        <Paperclip size={20} />
                    </button>
                    <input
                        type="text" value={inputText} onChange={(e) => setInputText(e.target.value)}
                        placeholder="Message Project IQ..."
                        className="flex-1 bg-transparent text-gray-800 focus:outline-none font-light py-1 text-base"
                    />
                    <button type="submit" disabled={!inputText.trim() || isLoading}
                        className="text-gray-400 hover:text-black disabled:opacity-30 transition-colors ml-2">
                        <Send size={20} />
                    </button>
                </div>
            </form>

            {/* Privacy Consent Popup */}
            <AnimatePresence>
                {showPrivacyPopup && (
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                        className="fixed bottom-24 left-4 right-4 p-4 bg-blue-50/95 backdrop-blur-sm border border-blue-200 rounded-2xl shadow-xl z-50">
                        <button
                            onClick={async () => {
                                setShowPrivacyPopup(false);
                                await setItem(getStorageKey(appId, 'privacyDismissed'), 'true');
                            }}
                            className="absolute top-2 right-2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-black/5 transition-colors" title="Dismiss">
                            <X size={16} />
                        </button>
                        <div className="text-sm text-blue-900 pr-6 leading-snug">
                            <p className="font-semibold mb-1">Privacy Notice</p>
                            By chatting, you consent to the chats being recorded, used, and shared according to our privacy policy.
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ChatWindow;
