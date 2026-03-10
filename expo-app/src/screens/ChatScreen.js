import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity,
    KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../utils/storage';
import { getWebhookUrl, getAppId } from '../config';
import MessageBubble from '../components/MessageBubble';
import QuickActions from '../components/QuickActions';
import LoginModal from '../components/LoginModal';
import { TicketFilterModal, TicketIdModal } from '../components/TicketModals';

const TITLE = 'Project IQ';

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

    // Modals
    const [showLogin, setShowLogin] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [showFilter, setShowFilter] = useState(false);
    const [showTicketId, setShowTicketId] = useState(false);

    const flatListRef = useRef(null);

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
    };

    // Initialize on mount
    useEffect(() => {
        (async () => {
            const currentAppId = await getAppId();
            await loadSession(currentAppId);
            setReady(true);
        })();
    }, []);

    // Re-check app-id when screen gains focus (works reliably on web + native)
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

    // API helper — always reads fresh app-id from storage
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
        return null;
    };

    // Send message
    const handleSend = async () => {
        const text = inputText.trim();
        if (!text) return;

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
        if (payload === '__LOGIN__') { setShowLogin(true); return; }

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
            if (responses.length > 0) setMessages(prev => [...prev, ...responses]);
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

    if (!ready) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#000" />
                <Text style={styles.loadingText}>Loading...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Header */}
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <View style={styles.onlineDot} />
                    <Text style={styles.headerTitle}>{TITLE}</Text>
                    {isAuthenticated && authUser ? (
                        <Text style={styles.headerUser}>({authUser})</Text>
                    ) : null}
                    {isGuest ? (
                        <View style={styles.guestBadge}>
                            <Text style={styles.guestText}>Guest</Text>
                        </View>
                    ) : null}
                </View>
                <View style={styles.headerRight}>
                    <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={styles.headerBtn}>
                        <Ionicons name="settings-outline" size={20} color="#6b7280" />
                    </TouchableOpacity>
                    {isGuest ? (
                        <TouchableOpacity style={styles.loginBadge} onPress={() => setShowLogin(true)}>
                            <Text style={styles.loginBadgeText}>🔑 Login</Text>
                        </TouchableOpacity>
                    ) : (
                        <>
                            <TouchableOpacity onPress={handleLogout} style={styles.headerBtn}>
                                <Ionicons name="log-out-outline" size={20} color="#6b7280" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleClear} style={styles.headerBtn}>
                                <Ionicons name="trash-outline" size={20} color="#6b7280" />
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={0}
            >
                {/* Messages */}
                <FlatList
                    ref={flatListRef}
                    data={messages}
                    keyExtractor={(item) => item.id}
                    renderItem={({ item }) => (
                        <MessageBubble
                            message={item}
                            onButtonClick={handleButtonClick}
                            onFeedback={handleFeedback}
                        />
                    )}
                    contentContainerStyle={styles.messagesList}
                    onContentSizeChange={scrollToEnd}
                    showsVerticalScrollIndicator={false}
                    ListFooterComponent={isLoading ? (
                        <View style={styles.typingRow}>
                            <View style={[styles.typingDot, { animationDelay: '0s' }]} />
                            <View style={[styles.typingDot, { animationDelay: '0.1s' }]} />
                            <View style={[styles.typingDot, { animationDelay: '0.2s' }]} />
                        </View>
                    ) : null}
                />

                {/* Quick Actions */}
                <QuickActions onAction={handleButtonClick} />

                {/* Input */}
                <SafeAreaView edges={['bottom']} style={styles.inputSafeArea}>
                    <View style={styles.inputContainer}>
                        <View style={styles.inputRow}>
                            <TextInput
                                style={styles.textInput}
                                value={inputText}
                                onChangeText={setInputText}
                                placeholder="Message Project IQ..."
                                placeholderTextColor="#9ca3af"
                                multiline={false}
                                returnKeyType="send"
                                onSubmitEditing={handleSend}
                            />
                            <TouchableOpacity
                                onPress={handleSend}
                                disabled={!inputText.trim() || isLoading}
                                style={[styles.sendBtn, (!inputText.trim() || isLoading) && styles.sendBtnDisabled]}
                            >
                                <Ionicons name="send" size={18} color={inputText.trim() && !isLoading ? '#000' : '#d1d5db'} />
                            </TouchableOpacity>
                        </View>
                    </View>
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
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9fafb' },
    flex: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
    loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
    headerUser: { fontSize: 12, color: '#6b7280' },
    guestBadge: { backgroundColor: '#f3f4f6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
    guestText: { fontSize: 11, color: '#6b7280', fontWeight: '500' },
    headerBtn: { padding: 8, borderRadius: 20 },
    loginBadge: { backgroundColor: '#000', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
    loginBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },

    // Messages
    messagesList: { paddingVertical: 12, paddingHorizontal: 12 },
    typingRow: { flexDirection: 'row', gap: 4, marginLeft: 16, marginTop: 8, marginBottom: 8 },
    typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#9ca3af' },

    // Input
    inputSafeArea: { backgroundColor: '#fff' },
    inputContainer: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f3f4f6',
        borderRadius: 24,
        paddingHorizontal: 16,
        paddingVertical: Platform.OS === 'ios' ? 10 : 4,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    textInput: {
        flex: 1,
        fontSize: 16,
        color: '#111',
        paddingVertical: 6,
    },
    sendBtn: { padding: 8, borderRadius: 16, marginLeft: 8 },
    sendBtnDisabled: { opacity: 0.3 },
});

export default ChatScreen;
