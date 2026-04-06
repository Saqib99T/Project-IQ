import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity,
    KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Alert,
    Modal, TouchableWithoutFeedback, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../utils/storage';
import { getWebhookUrl, getAppId, getApiUrl, THEME, APP_TITLE } from '../config';
import MessageBubble from '../components/MessageBubble';
import QuickActions from '../components/QuickActions';
import LoginModal from '../components/LoginModal';
import { TicketFilterModal, TicketIdModal, TicketFormModal } from '../components/TicketModals';
import * as DocumentPicker from 'expo-document-picker';

// Fallback UUID generator for React Native to avoid crypto requirement
const uuidv4 = () => {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
};

const TITLE = APP_TITLE;

const WELCOME_ACTIONS = [
    { label: '📝 Create Ticket', payload: '/create_ticket' },
    { label: '📋 My Tickets', payload: '/list_tickets' },
    { label: '🔍 Check Status', payload: '/check_status' },
    { label: '❓ Get Help', payload: '/help' },
];

const ChatScreen = ({ navigation }) => {
    // State
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isGuest, setIsGuest] = useState(true);
    const [authUser, setAuthUser] = useState('');
    const [senderId, setSenderId] = useState('');
    const [ready, setReady] = useState(false);
    const [appId, setAppIdState] = useState('IT');
    const appIdRef = useRef('IT');

    // Session ended state
    const [sessionEnded, setSessionEnded] = useState(false);

    // Inactivity timeout
    const [timeoutMinutes, setTimeoutMinutes] = useState(10);
    const lastActivityRef = useRef(Date.now());
    const warningShownRef = useRef(false);
    const inactivityIntervalRef = useRef(null);

    // Modals
    const [showLogin, setShowLogin] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [showFilter, setShowFilter] = useState(false);
    const [showTicketId, setShowTicketId] = useState(false);
    const [showTicketForm, setShowTicketForm] = useState(false);
    const [showPrivacyConsent, setShowPrivacyConsent] = useState(false);

    // History panel
    const [historyView, setHistoryView] = useState('chat'); // 'chat' | 'history' | 'session'
    const [historyList, setHistoryList] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(false);

    // Feedback persistence
    const [feedbackMap, setFeedbackMap] = useState({});

    const flatListRef = useRef(null);

    // Welcome state: only the init message, no real conversation yet
    const isWelcomeState = messages.length === 1 && messages[0]?.id === 'init';

    // Load session for a given app-id
    const loadSession = async (targetAppId) => {
        appIdRef.current = targetAppId;
        setAppIdState(targetAppId);

        let sid = await storage.getItem(targetAppId, 'senderId');
        if (!sid) {
            sid = uuidv4();
            await storage.setItem(targetAppId, 'senderId', sid);
        }
        setSenderId(sid);

        const auth = await storage.getItem(targetAppId, 'isAuthenticated');
        const user = await storage.getItem(targetAppId, 'authUser');
        if (auth === 'true') {
            setIsAuthenticated(true);
            setIsGuest(false);
            setAuthUser(user || '');
        } else {
            setIsAuthenticated(false);
            setIsGuest(true);
            setAuthUser('');
        }

        const saved = await storage.getMessages(targetAppId);
        if (saved) {
            setMessages(saved);
        } else {
            const welcomeMsg = auth === 'true' && user
                ? `**Hi ${user}!**\n\nWelcome back. How can I help you today?`
                : `**Hi, I'm ${TITLE}** \u{1F44B}\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*`;
            setMessages([{ id: 'init', sender: 'bot', text: welcomeMsg }]);
        }

        const savedFeedback = await storage.getItem(targetAppId, 'feedbackMap');
        if (savedFeedback) {
            try { setFeedbackMap(JSON.parse(savedFeedback)); } catch { /* ignore */ }
        }
    };

    // Fetch session timeout from admin config
    useEffect(() => {
        (async () => {
            try {
                const { getApiUrl } = await import('../config');
                const rasaBase = await getApiUrl(); // e.g. http://198.233.100.77:5005
                const adminBase = rasaBase.replace(/:\d+$/, ':8181');
                const res = await fetch(`${adminBase}/admin/config/SESSION_TIMEOUT_MINUTES`);
                const data = await res.json();
                const val = parseInt(data.value || data.SESSION_TIMEOUT_MINUTES || '10', 10);
                if (!isNaN(val) && val > 0) setTimeoutMinutes(val);
            } catch { /* use default 10 */ }
        })();
    }, []);

    // Inactivity timer — runs while screen is active and session is not ended
    useEffect(() => {
        if (sessionEnded || !ready) {
            clearInterval(inactivityIntervalRef.current);
            return;
        }

        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        inactivityIntervalRef.current = setInterval(() => {
            if (sessionEnded) return;
            const idleMs = Date.now() - lastActivityRef.current;
            const timeoutMs = timeoutMinutes * 60 * 1000;
            const warningMs = Math.max((timeoutMinutes - 2) * 60 * 1000, 0);

            if (idleMs >= timeoutMs) {
                clearInterval(inactivityIntervalRef.current);
                setSessionEnded(true);
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'bot',
                    text: '**Session ended due to inactivity.** Thank you for chatting! Tap **New Conversation** to start again.',
                    type: 'system',
                }]);
            } else if (idleMs >= warningMs && !warningShownRef.current) {
                warningShownRef.current = true;
                const waited = timeoutMinutes - 2;
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'bot',
                    text: `⏰ **Still there?** You've been inactive for ${waited} minute${waited !== 1 ? 's' : ''}. Your session will end automatically in **2 minutes** if there's no activity.`,
                    type: 'warning',
                }]);
            }
        }, 15000);

        return () => clearInterval(inactivityIntervalRef.current);
    }, [sessionEnded, ready, timeoutMinutes]);

    // Initialize on mount
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const currentAppId = await getAppId();
                if (mounted) {
                    await loadSession(currentAppId);
                }
            } catch (err) {
                console.error("Failed to initialize session:", err);
            } finally {
                if (mounted) setReady(true);
            }
        })();
        return () => { mounted = false; };
    }, []);

    // Re-check app-id when screen gains focus
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', async () => {
            const currentAppId = await getAppId();
            if (currentAppId !== appIdRef.current) {
                await loadSession(currentAppId);
            }
        });
        return unsubscribe;
    }, [navigation]);

    // Persist messages
    useEffect(() => {
        if (ready && messages.length > 0) {
            storage.setMessages(appIdRef.current, messages);
        }
    }, [messages, ready]);

    // Auto-scroll
    const scrollToEnd = useCallback(() => {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }, []);

    useEffect(() => { scrollToEnd(); }, [messages]);

    // API helper
    const sendToRasa = async (message) => {
        const currentAppId = await getAppId();
        const webhookUrl = await getWebhookUrl();
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender: senderId, message, metadata: { app_id: currentAppId } }),
        });
        return response.json();
    };

    // Process Rasa response
    const processResponse = (data) => {
        if (!data || data.length === 0) return [];
        const processed = [];
        let lastText = null;
        for (const msg of data) {
            if (msg.text) {
                lastText = { id: uuidv4(), sender: 'bot', text: msg.text, buttons: msg.buttons, chart: msg.chart || msg.custom?.chart, video: msg.custom?.video, ticket_form: msg.custom?.ticket_form };
                processed.push(lastText);
            } else if (msg.custom?.chart && lastText) { lastText.chart = msg.custom.chart; }
            else if (msg.custom?.chart) { processed.push({ id: uuidv4(), sender: 'bot', text: '', chart: msg.custom.chart }); }
            else if (msg.custom?.video && lastText) { lastText.video = msg.custom.video; }
            else if (msg.custom?.video) { processed.push({ id: uuidv4(), sender: 'bot', text: '', video: msg.custom.video }); }
            else if (msg.custom?.ticket_form && lastText) { lastText.ticket_form = msg.custom.ticket_form; }
            else if (msg.custom?.ticket_form) { processed.push({ id: uuidv4(), sender: 'bot', text: '', ticket_form: msg.custom.ticket_form }); }
            else if (msg.image) { processed.push({ id: uuidv4(), sender: 'bot', text: `![image](${msg.image})` }); }
        }
        return processed;
    };

    // Input validation
    const validateInput = (text) => {
        if (text.length > 500) return 'Please keep your message under 500 characters.';
        const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
        const ccPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
        if (ssnPattern.test(text)) return "Please don't share Social Security Numbers.";
        if (ccPattern.test(text)) return "Please don't share credit card numbers.";
        const profanity = ['damn', 'hell', 'crap', 'stupid', 'idiot'];
        if (profanity.some(w => text.toLowerCase().includes(w))) return 'Please keep the conversation professional.';
        const letters = text.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 10 && (letters.split('').filter(c => c >= 'A' && c <= 'Z').length / letters.length) > 0.7)
            return 'Please avoid excessive use of capital letters.';
        return null;
    };

    // Send message
    const handleSend = async () => {
        const text = inputText.trim();
        if (!text) return;
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        const error = validateInput(text);
        if (error) {
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: `⚠️ ${error}` }]);
            setInputText('');
            return;
        }

        const userMsg = { id: uuidv4(), sender: senderId, text };
        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsLoading(true);

        try {
            const data = await sendToRasa(text);
            const responses = processResponse(data);
            if (responses.length > 0) {
                setMessages(prev => [...prev, ...responses]);
                if (responses.some(m => m.ticket_form)) setShowTicketForm(true);
            } else {
                setMessages(prev => [...prev, {
                    id: uuidv4(), sender: 'bot',
                    text: "I'm not sure I understand. Here are some things I can help with:",
                    buttons: [
                        { title: "List my tickets", payload: "/list_tickets" },
                        { title: "Create a ticket", payload: "/create_ticket" },
                        { title: "Check ticket status", payload: "/check_status" },
                        { title: "Help", payload: "/help" },
                    ]
                }]);
            }
        } catch (err) {
            console.error('Send error:', err);
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: '⚠️ Error connecting to server. Check your API URL in Settings.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Button click handler
    const handleButtonClick = async (payload) => {
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;
        if (payload === '__LOGIN__') { setShowLogin(true); return; }
        if (payload === '__SHOW_TICKET_FORM__') { setShowTicketForm(true); return; }

        const restricted = ['/create_ticket', '/list_tickets', '/check_status', '/update_ticket', '/verify_resolution'];
        if (isGuest && restricted.some(p => payload.startsWith(p))) {
            const action = payload.includes('create') ? 'create tickets' : payload.includes('list') ? 'view your tickets' : payload.includes('check') ? 'check ticket status' : 'manage tickets';
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: `🔐 **Login Required**\n\nTo ${action}, please login with your Project IQ credentials.`,
                buttons: [{ title: '🔑 Login Now', payload: '__LOGIN__' }, { title: '📚 Search KB Instead', payload: '/ask_knowledge' }],
            }]);
            return;
        }

        if (payload === '/check_status') { setShowTicketId(true); return; }
        if (payload === '/list_tickets' && !payload.includes('{')) { setShowFilter(true); return; }

        const message = payload.startsWith('/') ? payload : `/${payload}`;
        let displayText = payload;
        if (payload.startsWith('/submit_ticket_form')) {
            try { const d = JSON.parse(payload.replace('/submit_ticket_form', '')); displayText = `📝 ${d.title} (${d.category})`; }
            catch { displayText = '📝 Submitting Ticket...'; }
        } else if (payload.includes('status_id')) { displayText = '🔍 Filtering tickets...'; }

        setMessages(prev => [...prev, { id: uuidv4(), sender: senderId, text: displayText }]);
        setIsLoading(true);

        try {
            const data = await sendToRasa(message);
            const responses = processResponse(data);
            if (responses.length > 0) {
                setMessages(prev => [...prev, ...responses]);
                if (responses.some(m => m.ticket_form)) setShowTicketForm(true);
            }
        } catch (err) {
            setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: '⚠️ Error connecting to server.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Login
    const handleLogin = async (username, password) => {
        setLoginLoading(true);
        setLoginError('');
        try {
            const loginPayload = `/login{"glpi_username": "${username}", "glpi_password": "${password}"}`;
            const data = await sendToRasa(loginPayload);
            let success = false;
            let errMsg = 'Login failed. Please check your credentials.';
            for (const msg of data) {
                if (msg.custom?.login_success) { success = true; break; }
                if (msg.custom?.login_error) { errMsg = msg.custom.error || errMsg; break; }
                if (msg.text?.includes('Welcome')) success = true;
                if (msg.text?.includes('failed')) errMsg = msg.text;
            }
            if (success) {
                setIsAuthenticated(true);
                setIsGuest(false);
                setAuthUser(username);
                setShowLogin(false);
                await storage.setItem(appIdRef.current, 'isAuthenticated', 'true');
                await storage.setItem(appIdRef.current, 'authUser', username);
                const dismissed = await storage.getItem(appIdRef.current, 'privacyDismissed');
                if (!dismissed) setShowPrivacyConsent(true);
                const welcomeData = data.find(m => m.text);
                setMessages([{ id: uuidv4(), sender: 'bot', text: welcomeData?.text || `Welcome, ${username}!`, buttons: welcomeData?.buttons || [] }]);
            } else {
                setLoginError(errMsg);
            }
        } catch (err) {
            setLoginError('Connection error. Check your API URL in Settings.');
        } finally {
            setLoginLoading(false);
        }
    };

    // Logout
    const handleLogout = async () => {
        setIsAuthenticated(false);
        setIsGuest(true);
        setAuthUser('');
        await storage.removeItem(appIdRef.current, 'isAuthenticated');
        await storage.removeItem(appIdRef.current, 'authUser');
        await storage.clearMessages(appIdRef.current);
        setMessages([{ id: 'init', sender: 'bot', text: "You've been logged out. Continuing as guest.\n\n📚 You can still search the Knowledge Base!\n🔑 Login anytime for full ticket features." }]);
    };

    // End session
    const handleEndSession = () => {
        clearInterval(inactivityIntervalRef.current);
        setSessionEnded(true);
        setMessages(prev => [...prev, {
            id: uuidv4(),
            sender: 'bot',
            text: '**Session ended.** Thank you for chatting! Start a new conversation anytime.'
        }]);
    };

    // New conversation
    const handleNewConversation = async () => {
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;
        await storage.clearMessages(appIdRef.current);
        await storage.removeItem(appIdRef.current, 'senderId');
        const newId = uuidv4();
        await storage.setItem(appIdRef.current, 'senderId', newId);
        setSenderId(newId);
        setSessionEnded(false);
        const welcomeMsg = isAuthenticated && authUser
            ? `**Hi ${authUser}!**\n\nWelcome back. How can I help you today?`
            : `**Hi, I'm ${TITLE}** \u{1F44B}\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*`;
        setMessages([{ id: 'init', sender: 'bot', text: welcomeMsg }]);
    };

    // Clear history
    const handleClear = async () => {
        Alert.alert('Clear History', 'Clear all chat messages?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Clear', style: 'destructive', onPress: async () => {
                    await storage.clearMessages(appIdRef.current);
                    await storage.removeItem(appIdRef.current, 'senderId');
                    const newId = uuidv4();
                    await storage.setItem(appIdRef.current, 'senderId', newId);
                    setSenderId(newId);
                    setMessages([{ id: 'init', sender: 'bot', text: `Hello! Welcome to ${TITLE}. How can I help you?` }]);
                }
            },
        ]);
    };

    // Feedback
    const handleFeedback = async (messageId, type) => {
        const newMap = { ...feedbackMap, [messageId]: type };
        setFeedbackMap(newMap);
        await storage.setItem(appIdRef.current, 'feedbackMap', JSON.stringify(newMap));
        try {
            await sendToRasa(type === 'up' ? '/feedback_positive' : '/feedback_negative');
        } catch { /* ignore */ }
    };

    // Ticket filter
    const handleFilterSelect = (statusId) => {
        handleButtonClick(`/list_tickets{"status_id": ${statusId}}`);
    };

    // Ticket ID
    const handleTicketIdSubmit = (id) => {
        handleButtonClick(`/check_status{"ticket_id":"${id}"}`);
    };

    // Ticket FormSubmit
    const handleTicketFormSubmit = (data) => {
        const payload = `/submit_ticket_form${JSON.stringify(data)}`;
        handleButtonClick(payload);
    };

    // History — fetch conversation list from DB
    const fetchUserHistory = async () => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const rasaBase = await getApiUrl();
            const adminBase = rasaBase.replace(/:\d+$/, ':8181');
            const res = await fetch(`${adminBase}/api/user/conversations?user_name=${encodeURIComponent(authUser)}&app_id=${encodeURIComponent(appIdRef.current)}`);
            const resp = await res.json();
            if (resp.success) setHistoryList(resp.data);
        } catch (e) { console.error('Failed to fetch history', e); }
        finally { setHistoryLoading(false); }
    };

    // History — fetch messages for a selected session
    const fetchSessionMessages = async (session) => {
        setSessionLoading(true);
        try {
            const rasaBase = await getApiUrl();
            const adminBase = rasaBase.replace(/:\d+$/, ':8181');
            const res = await fetch(`${adminBase}/api/user/conversation/${encodeURIComponent(session.sender_id)}/messages`);
            const resp = await res.json();
            if (resp.success) {
                setSelectedSession({ ...session, messages: resp.data });
                setHistoryView('session');
            }
        } catch (e) { console.error('Failed to fetch session', e); }
        finally { setSessionLoading(false); }
    };

    // File attachment
    const handleFileAttach = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
            if (result.canceled) return;
            const file = result.assets[0];
            if (file.size > 2 * 1024 * 1024) {
                Alert.alert('File too large', 'Please select a file under 2MB.');
                return;
            }
            const userMsg = { id: uuidv4(), sender: senderId, text: `📎 ${file.name}` };
            setMessages(prev => [...prev, userMsg]);
            setIsLoading(true);
            lastActivityRef.current = Date.now();
            const data = await sendToRasa(`/upload_file{"filename": "${file.name}"}`);
            const responses = processResponse(data);
            if (responses.length > 0) setMessages(prev => [...prev, ...responses]);
        } catch (e) { console.error('File attach error:', e); }
        finally { setIsLoading(false); }
    };

    // Group history sessions by date label
    const groupSessionsByDate = (sessions) => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        const groups = {};
        for (const s of sessions) {
            const d = new Date(s.started_at);
            d.setHours(0, 0, 0, 0);
            let label;
            if (d.getTime() === today.getTime()) label = 'Today';
            else if (d.getTime() === yesterday.getTime()) label = 'Yesterday';
            else label = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
            if (!groups[label]) groups[label] = [];
            groups[label].push(s);
        }
        return groups;
    };

    if (!ready) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={THEME.primary} />
                <Text style={styles.loadingText}>Loading...</Text>
            </SafeAreaView>
        );
    }

    const welcomeBg = '#EEF2FA';

    return (
        <SafeAreaView style={[styles.container, isWelcomeState && { backgroundColor: welcomeBg }]} edges={['top']}>
            {/* Header — Gemini style: menu | title (centered) | avatar */}
            <View style={[styles.header, isWelcomeState && { backgroundColor: welcomeBg }]}>
                <TouchableOpacity
                    style={styles.headerIconBtn}
                    onPress={() => navigation.navigate('Settings')}
                >
                    <Ionicons name="menu-outline" size={24} color={THEME.text} />
                </TouchableOpacity>

                <Text style={styles.headerTitle}>{TITLE}</Text>

                <TouchableOpacity
                    style={styles.headerIconBtn}
                    onPress={isAuthenticated && !isGuest ? () => setShowUserMenu(true) : () => setShowLogin(true)}
                >
                    {isAuthenticated && authUser ? (
                        <View style={styles.avatarCircle}>
                            <Text style={styles.avatarLetter}>{authUser[0].toUpperCase()}</Text>
                        </View>
                    ) : (
                        <Ionicons name="person-circle-outline" size={28} color={THEME.textSecondary} />
                    )}
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}
            >
                {/* Welcome State */}
                {isWelcomeState ? (
                    <View style={styles.welcomeContainer}>
                        <Text style={styles.welcomeGreeting}>
                            Hi {isAuthenticated && authUser ? authUser : 'there'}
                        </Text>
                        <Text style={styles.welcomeQuestion}>Where should we start?</Text>
                        <View style={styles.welcomeChips}>
                            {WELCOME_ACTIONS.map((action, idx) => (
                                <TouchableOpacity
                                    key={idx}
                                    style={styles.welcomeChip}
                                    onPress={() => handleButtonClick(action.payload)}
                                    activeOpacity={0.75}
                                >
                                    <Text style={styles.welcomeChipText}>{action.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                ) : (
                    /* Messages */
                    <FlatList
                        ref={flatListRef}
                        data={messages}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item }) => (
                            <MessageBubble
                                message={item}
                                onButtonClick={handleButtonClick}
                                onFeedback={handleFeedback}
                                initialFeedback={feedbackMap[item.id]}
                            />
                        )}
                        contentContainerStyle={styles.messagesList}
                        onContentSizeChange={scrollToEnd}
                        showsVerticalScrollIndicator={false}
                        ListFooterComponent={isLoading ? (
                            <View style={styles.typingRow}>
                                <View style={styles.typingDot} />
                                <View style={styles.typingDot} />
                                <View style={styles.typingDot} />
                            </View>
                        ) : null}
                    />
                )}

                {/* Quick Actions bar — matches web */}
                {!isWelcomeState && !sessionEnded && (
                    <QuickActions onAction={handleButtonClick} />
                )}

                {/* Input Bar or New Conversation */}
                <SafeAreaView
                    edges={['bottom']}
                    style={[styles.inputSafeArea, isWelcomeState && { backgroundColor: welcomeBg }]}
                >
                    {sessionEnded ? (
                        /* New Conversation button shown when session is ended */
                        <View style={styles.newConvContainer}>
                            <TouchableOpacity
                                style={styles.newConvBtn}
                                onPress={handleNewConversation}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
                                <Text style={styles.newConvText}>New Conversation</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        /* Normal input bar */
                        <View style={[styles.inputContainer, isWelcomeState && { backgroundColor: welcomeBg }]}>
                            <View style={styles.inputRow}>
                                <TouchableOpacity style={styles.inputIconBtn} onPress={handleFileAttach}>
                                    <Ionicons name="attach" size={22} color={THEME.textSecondary} />
                                </TouchableOpacity>

                                <TextInput
                                    style={styles.textInput}
                                    value={inputText}
                                    onChangeText={setInputText}
                                    placeholder={`Ask ${TITLE}...`}
                                    placeholderTextColor="#9ca3af"
                                    multiline={false}
                                    returnKeyType="send"
                                    onSubmitEditing={handleSend}
                                />

                                {inputText.trim() ? (
                                    <TouchableOpacity
                                        onPress={handleSend}
                                        disabled={isLoading}
                                        style={[styles.sendBtn, isLoading && styles.sendBtnDisabled]}
                                    >
                                        <Ionicons
                                            name="send"
                                            size={18}
                                            color={!isLoading ? THEME.primary : THEME.border}
                                        />
                                    </TouchableOpacity>
                                ) : (
                                    <TouchableOpacity style={styles.inputIconBtn}>
                                        <Ionicons name="mic-outline" size={22} color={THEME.textSecondary} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    )}
                </SafeAreaView>
            </KeyboardAvoidingView>

            {/* Modals */}
            <LoginModal
                visible={showLogin}
                onClose={() => { setShowLogin(false); setLoginError(''); }}
                onLogin={handleLogin}
                isLoading={loginLoading}
                error={loginError}
            />
            <TicketFilterModal
                visible={showFilter}
                onClose={() => setShowFilter(false)}
                onSelect={handleFilterSelect}
            />
            <TicketIdModal
                visible={showTicketId}
                onClose={() => setShowTicketId(false)}
                onSubmit={handleTicketIdSubmit}
            />
            <TicketFormModal
                visible={showTicketForm}
                onClose={() => setShowTicketForm(false)}
                onSubmit={handleTicketFormSubmit}
            />

            {/* User Menu Dropdown */}
            <Modal visible={showUserMenu} transparent animationType="fade" onRequestClose={() => setShowUserMenu(false)}>
                <TouchableWithoutFeedback onPress={() => setShowUserMenu(false)}>
                    <View style={styles.menuOverlay}>
                        <TouchableWithoutFeedback>
                            <View style={styles.menuDropdown}>
                                <View style={styles.menuUserInfo}>
                                    <Text style={styles.menuUserName}>{authUser}</Text>
                                    <Text style={styles.menuUserSub}>{authUser}</Text>
                                </View>
                                <TouchableOpacity style={styles.menuItem}>
                                    <Text style={styles.menuItemTextMuted}>My Profile</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowUserMenu(false); fetchUserHistory(); setHistoryView('history'); }}>
                                    <Text style={styles.menuItemText}>History</Text>
                                </TouchableOpacity>
                                {!isWelcomeState && !sessionEnded && (
                                    <TouchableOpacity style={styles.menuItem} onPress={() => { setShowUserMenu(false); handleEndSession(); }}>
                                        <Text style={styles.menuItemText}>End This Conversation</Text>
                                    </TouchableOpacity>
                                )}
                                <View style={styles.menuDivider} />
                                <TouchableOpacity style={styles.menuItem} onPress={() => { setShowUserMenu(false); handleLogout(); }}>
                                    <Text style={styles.menuItemTextMuted}>Logout</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* History Panel */}
            <Modal visible={historyView !== 'chat'} animationType="slide" onRequestClose={() => { setHistoryView('chat'); setSelectedSession(null); }}>
                <SafeAreaView style={styles.historyContainer} edges={['top']}>
                    {/* History List View */}
                    {historyView === 'history' && (
                        <>
                            <View style={styles.historyHeader}>
                                <TouchableOpacity onPress={() => setHistoryView('chat')} style={styles.historyBackBtn}>
                                    <Ionicons name="arrow-back" size={22} color={THEME.text} />
                                </TouchableOpacity>
                                <Text style={styles.historyTitle}>Conversation History</Text>
                            </View>
                            {historyLoading ? (
                                <View style={styles.historyCentered}>
                                    <ActivityIndicator size="large" color={THEME.primary} />
                                </View>
                            ) : historyList.length === 0 ? (
                                <View style={styles.historyCentered}>
                                    <Ionicons name="time-outline" size={40} color="#d1d5db" />
                                    <Text style={styles.historyEmptyText}>No previous conversations</Text>
                                </View>
                            ) : (
                                <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false}>
                                    {Object.entries(groupSessionsByDate(historyList)).map(([label, sessions]) => (
                                        <View key={label}>
                                            <Text style={styles.historySectionLabel}>{label}</Text>
                                            {sessions.map(session => (
                                                <TouchableOpacity
                                                    key={session.sender_id}
                                                    style={styles.historyCard}
                                                    onPress={() => fetchSessionMessages(session)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text style={styles.historyCardTime}>
                                                        {new Date(session.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                        {' · '}
                                                        {new Date(session.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </Text>
                                                    <Text style={styles.historyCardPreview} numberOfLines={2}>
                                                        "{session.preview}"
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    ))}
                                </ScrollView>
                            )}
                        </>
                    )}

                    {/* Session Read-only View */}
                    {historyView === 'session' && selectedSession && (
                        <>
                            <View style={styles.historyHeader}>
                                <TouchableOpacity onPress={() => { setHistoryView('history'); setSelectedSession(null); }} style={styles.historyBackBtn}>
                                    <Ionicons name="arrow-back" size={22} color={THEME.text} />
                                </TouchableOpacity>
                                <Text style={styles.historyTitle} numberOfLines={1}>
                                    {selectedSession.preview?.substring(0, 30) || 'Conversation'}
                                </Text>
                            </View>
                            {sessionLoading ? (
                                <View style={styles.historyCentered}>
                                    <ActivityIndicator size="large" color={THEME.primary} />
                                </View>
                            ) : (
                                <FlatList
                                    data={selectedSession.messages || []}
                                    keyExtractor={item => item.id}
                                    contentContainerStyle={styles.messagesList}
                                    renderItem={({ item }) => (
                                        <MessageBubble
                                            message={item}
                                            readonly
                                        />
                                    )}
                                    ListFooterComponent={
                                        <View style={styles.readonlyFooter}>
                                            <Ionicons name="lock-closed-outline" size={13} color="#9ca3af" />
                                            <Text style={styles.readonlyText}>
                                                Read-only · {new Date(selectedSession.started_at).toLocaleString()}
                                            </Text>
                                        </View>
                                    }
                                />
                            )}
                        </>
                    )}
                </SafeAreaView>
            </Modal>

            {/* Privacy Consent */}
            <Modal visible={showPrivacyConsent} transparent animationType="fade" onRequestClose={() => {}}>
                <View style={styles.privacyOverlay}>
                    <View style={styles.privacyCard}>
                        <Text style={styles.privacyTitle}>Privacy Notice</Text>
                        <Text style={styles.privacyText}>
                            This chat may collect and process your messages to provide IT support services. Your conversations may be stored securely.{'\n\n'}
                            By continuing, you agree to our data processing practices.
                        </Text>
                        <TouchableOpacity
                            style={styles.privacyBtn}
                            onPress={async () => {
                                await storage.setItem(appIdRef.current, 'privacyDismissed', 'true');
                                setShowPrivacyConsent(false);
                            }}
                        >
                            <Text style={styles.privacyBtnText}>I Understand</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: THEME.background },
    flex: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: THEME.background },
    loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },

    // Header — Gemini style
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 10,
        backgroundColor: THEME.background,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '400',
        color: THEME.text,
        letterSpacing: 0.2,
    },
    headerIconBtn: { padding: 10, borderRadius: 20 },
    avatarCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#1a73e8',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarLetter: {
        color: '#ffffff',
        fontWeight: '700',
        fontSize: 14,
    },

    // Welcome screen
    welcomeContainer: {
        flex: 1,
        paddingHorizontal: 24,
        paddingTop: 36,
    },
    welcomeGreeting: {
        fontSize: 30,
        fontWeight: '400',
        color: THEME.text,
        marginBottom: 2,
    },
    welcomeQuestion: {
        fontSize: 30,
        fontWeight: '600',
        color: THEME.text,
        marginBottom: 36,
    },
    welcomeChips: {
        gap: 12,
    },
    welcomeChip: {
        paddingHorizontal: 22,
        paddingVertical: 16,
        backgroundColor: '#ffffff',
        borderRadius: 26,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
    },
    welcomeChipText: {
        fontSize: 15,
        color: THEME.text,
        fontWeight: '400',
    },

    // Messages
    messagesList: { paddingVertical: 12, paddingHorizontal: 12 },
    typingRow: { flexDirection: 'row', gap: 4, marginLeft: 16, marginTop: 8, marginBottom: 8 },
    typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#9ca3af' },

    // Input bar — Gemini style pill
    inputSafeArea: { backgroundColor: THEME.background },
    inputContainer: { backgroundColor: THEME.background },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f0f4f9',
        borderRadius: 30,
        marginHorizontal: 16,
        marginBottom: 16,
        paddingHorizontal: 8,
        paddingVertical: Platform.OS === 'ios' ? 8 : 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
    },
    inputIconBtn: { padding: 8 },
    textInput: {
        flex: 1,
        fontSize: 16,
        color: THEME.text,
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    sendBtn: { padding: 10, borderRadius: 20, marginLeft: 2 },
    sendBtnDisabled: { opacity: 0.3 },
    },

    // New conversation button
    newConvContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: 'center',
    },
    newConvBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: THEME.primary,
        paddingHorizontal: 28,
        paddingVertical: 14,
        borderRadius: 28,
        shadowColor: THEME.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    newConvText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },

    // User menu dropdown
    menuOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.15)',
    },
    menuDropdown: {
        position: 'absolute',
        top: 60,
        right: 12,
        width: 220,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.08)',
    },
    menuUserInfo: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.08)',
    },
    menuUserName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    menuUserSub: {
        fontSize: 12,
        color: '#9ca3af',
        marginTop: 2,
    },
    menuItem: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    menuItemText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
    },
    menuItemTextMuted: {
        fontSize: 14,
        color: '#4b5563',
    },
    menuDivider: {
        height: 1,
        backgroundColor: 'rgba(0,0,0,0.08)',
        marginVertical: 4,
    },

    // History panel
    historyContainer: { flex: 1, backgroundColor: '#f9fafb' },
    historyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 12,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    historyBackBtn: { padding: 8, borderRadius: 20 },
    historyTitle: {
        flex: 1,
        fontSize: 17,
        fontWeight: '600',
        color: THEME.text,
        textAlign: 'center',
        marginRight: 40,
    },
    historyCentered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    historyEmptyText: { fontSize: 14, color: '#9ca3af' },
    historyScroll: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
    historySectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 16,
        marginBottom: 8,
    },
    historyCard: {
        backgroundColor: '#ffffff',
        borderRadius: 12,
        padding: 14,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    historyCardTime: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
    historyCardPreview: { fontSize: 14, color: THEME.text, lineHeight: 20 },
    readonlyFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 16,
        paddingHorizontal: 16,
    },
    readonlyText: { fontSize: 12, color: '#9ca3af' },

    // Privacy consent
    privacyOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
        padding: 16,
    },
    privacyCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 24,
        marginBottom: 8,
    },
    privacyTitle: { fontSize: 17, fontWeight: '700', color: THEME.text, marginBottom: 12 },
    privacyText: { fontSize: 14, color: '#4b5563', lineHeight: 22, marginBottom: 20 },
    privacyBtn: {
        backgroundColor: THEME.primary,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    privacyBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
});

export default ChatScreen;
