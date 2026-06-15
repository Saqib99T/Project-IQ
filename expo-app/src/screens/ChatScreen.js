import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    View, Text, TextInput, FlatList, TouchableOpacity,
    KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator, Alert,
    Modal, TouchableWithoutFeedback, ScrollView, Keyboard
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storage } from '../utils/storage';
import { getWebhookUrl, getAppId, getApiUrl, getAdminBaseUrl, THEME, APP_TITLE, IAM_CONFIG } from '../config';
import { useTheme } from '../context/ThemeContext';
import { useIamAuth } from '../hooks/useIamAuth';
import { useBiometric } from '../hooks/useBiometric';
import { prefillFromMessages } from '../utils/prefillTicket';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
// Hooks extracted from this file — TODO: replace inline socket/history code with these
import { useChatSocket }  from '../hooks/useChatSocket';
import { useChatHistory } from '../hooks/useChatHistory';
import MessageBubble from '../components/MessageBubble';
import QuickActions from '../components/QuickActions';
import LoginModal from '../components/LoginModal';
import { TicketFilterModal, TicketIdModal, TicketFormModal } from '../components/TicketModals';
import SessionFeedbackModal from '../components/SessionFeedbackModal';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { io } from 'socket.io-client';

// Fallback UUID generator for React Native to avoid crypto requirement
const uuidv4 = () => {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
};

const TITLE = APP_TITLE;

const WELCOME_ACTIONS = [
    { label: '📝 Create', payload: '/create_ticket' },
    { label: '📋 List', payload: '/list_tickets' },
    { label: '🔍 View', payload: '/check_status' },
    { label: '❓ Help', payload: '/help' },
];

const ChatScreen = ({ navigation }) => {
    // shadows the module-level THEME import so all component refs use dynamic theme
    const { theme: THEME } = useTheme(); // eslint-disable-line no-shadow
    const styles = useMemo(() => makeStyles(THEME), [THEME]);

    // ── IAM Authentication ────────────────────────────────────────────────────
    const iam = useIamAuth(IAM_CONFIG);
    const { authenticateWithBiometric } = useBiometric();

    // Prompt biometric when app comes to foreground with an active session
    useEffect(() => {
        const { AppState } = require('react-native');
        let lastState = AppState.currentState;
        const sub = AppState.addEventListener('change', async (next) => {
            if (lastState.match(/inactive|background/) && next === 'active') {
                if (iam.isAuthenticated) {
                    const ok = await authenticateWithBiometric();
                    if (!ok) iam.logout().catch(() => {});
                }
            }
            lastState = next;
        });
        return () => sub.remove();
    }, [iam.isAuthenticated, authenticateWithBiometric]);

    // State
    const [messages, setMessages] = useState([]);
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isGuest, setIsGuest] = useState(true);
    const [authUser, setAuthUser] = useState('');
    const [senderId, setSenderId] = useState('');
    const [handoffState, setHandoffState] = useState('bot_active');
    const [operatorName, setOperatorName] = useState('');
    const [queuePosition, setQueuePosition] = useState(null);
    const [waitMins, setWaitMins] = useState(null);
    const [operatorTyping, setOperatorTyping] = useState(false);
    const isAuthenticatedRef = useRef(false);
    const sessionTokenRef = useRef(null);
    const socketRef = useRef(null);
    const opTypingTimer = useRef(null);
    const [ready, setReady] = useState(false);
    const [appId, setAppIdState] = useState('IT');
    const appIdRef = useRef('IT');

    // Session ended state
    const [sessionEnded, setSessionEnded] = useState(false);

    // ── Notification state ────────────────────────────────────────────────────
    const [unreadCount, setUnreadCount] = useState(0);

    // ── Offline queue (mobile) ────────────────────────────────────────────────
    const { isOnline, enqueue: enqueueOffline } = useOfflineQueue(
        useCallback(async (text) => {
            const data = await sendToRasa(text);
            const responses = processResponse(data);
            if (responses.length > 0) setMessages(prev => [...prev, ...responses]);
        }, []) // sendToRasa captured via closure — stable after mount
    );

    // ── App icon badge — update whenever unread count changes ─────────────────
    useEffect(() => {
        Notifications.setBadgeCountAsync(unreadCount).catch(() => {});
    }, [unreadCount]);

    // ── Sync IAM → local auth state ───────────────────────────────────────────
    useEffect(() => {
        if (iam.isAuthenticated && iam.user && !iam.isLoading) {
            setIsAuthenticated(true);
            isAuthenticatedRef.current = true;
            setIsGuest(false);
            setAuthUser(iam.user.name || iam.user.username || iam.user.email || '');
            // Replace a stale single init message (e.g. leftover guest/logout text)
            // with a signed-in welcome so the user never sees logout text post-login.
            setMessages(prev => {
                if (prev.length === 1 && prev[0]?.id === 'init') {
                    const nm = iam.user.name || iam.user.username || iam.user.email || 'there';
                    return [{ id: 'init', sender: 'bot', text: `**Hi ${nm}!** 👋\n\nWelcome back. How can I help you today?` }];
                }
                return prev;
            });
            // Product-scoped session: choose the product, then senderId becomes
            // iam-{sub}-{product} (matches the chat proxy). Auto-restore the last
            // choice; auto-select if only one; otherwise force the picker.
            (async () => {
                const prods = (iam.user.subscriptions?.length ? iam.user.subscriptions
                              : iam.user.apps?.length ? iam.user.apps : iam.user.products) || [];
                const stored = await storage.getItem('__global__', 'selectedProduct').catch(() => null);
                const product = (stored && prods.includes(stored)) ? stored
                              : (prods.length === 1 ? prods[0] : null);
                if (product) {
                    await applyProduct(product);
                } else {
                    setShowProductSelector(true);   // require a choice before chatting
                }
            })();
        }
    }, [iam.isAuthenticated, iam.user, iam.isLoading]);

    const _registerPushToken = async (userId) => {
        try {
            if (!Device.isDevice) return;
            const { status } = await Notifications.requestPermissionsAsync();
            if (status !== 'granted') return;
            const tokenData = await Notifications.getExpoPushTokenAsync();
            const adminBase = await getAdminBaseUrl();
            await fetch(`${adminBase}/notifications/push-token`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', ...(iam.token ? { Authorization: `Bearer ${iam.token}` } : {}) },
                body:    JSON.stringify({ token: tokenData.data, platform: 'expo', sender_id: userId }),
            });
        } catch (e) { /* best-effort */ }
    };

    const _fetchUnreadCount = async (userId) => {
        try {
            const adminBase = await getAdminBaseUrl();
            const res  = await fetch(`${adminBase}/notifications?sender_id=${encodeURIComponent(userId)}`);
            const data = await res.json();
            if (data.success) setUnreadCount(data.unread_count ?? 0);
        } catch {}
    };

    useEffect(() => { isAuthenticatedRef.current = isAuthenticated; }, [isAuthenticated]);
    useEffect(() => { getApiUrl().then(setApiBaseUrl); }, []);

    // Inactivity timeout
    const [timeoutMinutes, setTimeoutMinutes] = useState(10);
    const lastActivityRef = useRef(Date.now());
    const warningShownRef = useRef(false);
    const inactivityIntervalRef = useRef(null);

    // Modals
    const [showProductSelector, setShowProductSelector] = useState(false);
    const [showLogin, setShowLogin] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showFilter, setShowFilter] = useState(false);
    const [showTicketId, setShowTicketId] = useState(false);
    const [showTicketForm, setShowTicketForm] = useState(false);
    const [showPrivacyConsent, setShowPrivacyConsent] = useState(false);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedbackLoading, setFeedbackLoading] = useState(false);
    const [pendingFeedbackQueueId, setPendingFeedbackQueueId] = useState(null);
    // timeout choice: { message, options: [{label,value}] }
    const [timeoutChoice, setTimeoutChoice] = useState(null);

    // History panel
    const [historyView, setHistoryView] = useState('chat'); // 'chat' | 'history' | 'session'
    const [historyList, setHistoryList] = useState([]);
    const [selectedSession, setSelectedSession] = useState(null);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [historySearch, setHistorySearch] = useState('');

    // Feedback persistence
    const [feedbackMap, setFeedbackMap] = useState({});
    const [isKeyboardVisible, setKeyboardVisible] = useState(false);
    const [apiBaseUrl, setApiBaseUrl] = useState('');

    const flatListRef = useRef(null);
    const insets = useSafeAreaInsets();

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
        const welcomeMsg = auth === 'true' && user
            ? `**Hi ${user}!**\n\nWelcome back. How can I help you today?`
            : `**Hi, I'm ${TITLE}** \u{1F44B}\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*`;
        if (saved && auth === 'true') {
            setMessages(saved);
        } else {
            setMessages([{ id: 'init', sender: 'bot', text: welcomeMsg }]);
        }

        const savedFeedback = await storage.getItem(targetAppId, 'feedbackMap');
        if (savedFeedback) {
            try { setFeedbackMap(JSON.parse(savedFeedback)); } catch { /* ignore */ }
        }
    };

    // Track keyboard visibility to eliminate the bottom inset gap when open
    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
        const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, []);

    // Fetch session timeout from admin config
    useEffect(() => {
        (async () => {
            try {
                const adminBase = await getAdminBaseUrl();
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
                setShowFeedback(true);
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

    // ── Socket.IO — handoff real-time events ───────────────────────────────
    useEffect(() => {
        if (!senderId) return;
        let cancelled = false;

        (async () => {
            const adminBase = await getAdminBaseUrl();
            if (cancelled) return;

            const socket = io(adminBase, { transports: ['websocket', 'polling'] });
            socketRef.current = socket;

            socket.on('connect', () => {
                socket.emit('join_user', { sender_id: senderId });
                // Restore handoff state after reconnect
                fetch(`${adminBase}/handoff/status/${encodeURIComponent(senderId)}`)
                    .then(r => r.json())
                    .then(d => {
                        const state = d.handoff_state || 'bot_active';
                        if (state === 'queued') {
                            setHandoffState('queued');
                            setQueuePosition(d.queue_position || 1);
                            setWaitMins(d.wait_mins || null);
                        } else if (state === 'assigned') {
                            setHandoffState('assigned');
                            setOperatorName(d.operator_name || 'an agent');
                        }
                    })
                    .catch(() => {});
            });

            socket.on('handoff_queued', (d) => {
                setHandoffState('queued');
                setQueuePosition(d.queue_position || 1);
                setWaitMins(d.wait_estimate_mins || null);
            });

            socket.on('wait_update', (d) => {
                setQueuePosition(d.queue_position);
                setWaitMins(d.wait_estimate_mins);
            });

            socket.on('handoff_assigned', (d) => {
                setHandoffState('assigned');
                setOperatorName(d.operator_name || 'an agent');
                setQueuePosition(null);
                setWaitMins(null);
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'bot',
                    text: d.message || `✅ **${d.operator_name || 'An agent'}** has joined the conversation.`,
                    type: 'system',
                }]);
            });

            socket.on('new_notification', (d) => {
                setUnreadCount(d.unread_count ?? 0);
            });
            socket.on('notification_count', (d) => {
                setUnreadCount(d.unread_count ?? 0);
            });

            socket.on('operator_message', (d) => {
                if (d.sender_id && d.sender_id !== senderId) return;
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'operator',
                    text: d.text,
                    operator_name: d.operator_name || operatorName,
                    timestamp: d.timestamp,
                }]);
                setOperatorTyping(false);
                clearTimeout(opTypingTimer.current);
            });

            socket.on('operator_typing', (d) => {
                setOperatorTyping(d.typing);
                if (d.typing) {
                    clearTimeout(opTypingTimer.current);
                    opTypingTimer.current = setTimeout(() => setOperatorTyping(false), 5000);
                } else {
                    clearTimeout(opTypingTimer.current);
                }
            });

            socket.on('handoff_resolved', (d) => {
                setHandoffState('bot_active');
                setOperatorName('');
                setOperatorTyping(false);
                setTimeoutChoice(null);
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'bot',
                    text: d.message || '✅ The agent session has ended. I\'m back to assist you.',
                    type: 'system',
                }]);
                // Show feedback form after operator resolves
                if (d.request_feedback) {
                    setPendingFeedbackQueueId(d.queue_id || null);
                    setShowFeedback(true);
                }
            });

            socket.on('handoff_abandoned', (d) => {
                setHandoffState('bot_active');
                setQueuePosition(null);
                setWaitMins(null);
                setTimeoutChoice(null);
                setMessages(prev => [...prev, {
                    id: uuidv4(),
                    sender: 'bot',
                    text: d.message || '⚠️ The queue wait exceeded our limit. I\'m back to assist you.',
                    type: 'system',
                }]);
            });

            // Queue timeout — ask user Remain or Leave
            socket.on('handoff_timeout_choice', (d) => {
                setTimeoutChoice({ message: d.message, options: d.options || [] });
            });
        })();

        return () => {
            cancelled = true;
            clearTimeout(opTypingTimer.current);
            if (socketRef.current) {
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [senderId]);

    // Auto-scroll
    const scrollToEnd = useCallback(() => {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }, []);

    useEffect(() => { scrollToEnd(); }, [messages]);

    // On Android, adjustResize (AndroidManifest) resizes the window when keyboard opens.
    // FlatList onLayout fires when its height changes → scroll to show latest messages.

    // API helper
    const sendToRasa = async (message) => {
        const currentAppId = appIdRef.current || await getAppId();
        const webhookUrl = await getWebhookUrl();
        const meta = { app_id: currentAppId };
        if (authUser) meta.user_name = authUser;
        if (sessionTokenRef.current) meta.session_token = sessionTokenRef.current;
        // Inject IAM identity + org context into Rasa metadata
        if (iam.user) {
            meta.iam_sub      = iam.user.sub;
            meta.iam_name     = iam.user.name;
            meta.iam_email    = iam.user.email;
            meta.iam_org_id   = iam.user.organization_id   || undefined;
            meta.iam_org_name = iam.user.organization_alias || undefined;
            meta.channel      = iam.user.organization_id ? 'internal' : undefined;
            meta.product_id   = currentAppId || undefined;
            meta.iam_token    = iam.token || undefined;
        }
        meta.is_authenticated = !!(isAuthenticatedRef.current || iam.user);
        const headers = { 'Content-Type': 'application/json' };
        if (iam.token) headers['Authorization'] = `Bearer ${iam.token}`;
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ sender: senderId, message, metadata: meta }),
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

        // Strip spurious fallback messages appended by Rasa's RulePolicy / TEDPolicy
        // alongside real handoff / action responses (same logic as admin proxy does for web)
        const FALLBACK_PREFIXES = [
            "I'm not sure I understand",
            "\u2019m not sure I understand",
            "I\u2019m not sure I understand",
            "I'm sorry, I didn't",
            "I'm sorry, I didn\u2019t",
        ];
        if (processed.length > 1) {
            const filtered = processed.filter(
                m => !FALLBACK_PREFIXES.some(p => (m.text || '').startsWith(p))
            );
            if (filtered.length > 0) return filtered;
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

        // Block while queued — user should wait
        if (handoffState === 'queued') return;

        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        // Offline — queue and show pending indicator
        if (!isOnline) {
            await enqueueOffline(text);
            setMessages(prev => [...prev,
                { id: uuidv4(), sender: senderId, text, pending: true },
                { id: uuidv4(), sender: 'bot', text: '📵 You\'re offline. Your message is queued and will be sent when you reconnect.' },
            ]);
            setInputText('');
            return;
        }

        // Skip guardrails during live human handoff
        if (!handoffState || handoffState !== 'assigned') {
            const error = validateInput(text);
            if (error) {
                setMessages(prev => [...prev, { id: uuidv4(), sender: 'bot', text: `⚠️ ${error}` }]);
                setInputText('');
                return;
            }
        }

        // Emit user typing stop
        if (socketRef.current && handoffState === 'assigned') {
            socketRef.current.emit('user_typing', { sender_id: senderId, typing: false });
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
            } else if (handoffState !== 'assigned' && handoffState !== 'queued') {
                // Fallback only when bot is active — not during human handoff
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
        console.log('[AUTH CHECK] isAuthenticated:', isAuthenticated, 'ref:', isAuthenticatedRef.current, 'payload:', payload);
        if (!isAuthenticatedRef.current && !isAuthenticated && restricted.some(p => payload.startsWith(p))) {
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

    // Authentication is IAM single sign-on only — no username/password handled here.

    // Logout
    const handleLogout = async () => {
        // End any active handoff before signing out
        if (socketRef.current && (handoffState === 'assigned' || handoffState === 'queued')) {
            socketRef.current.emit('user_end_session', { sender_id: senderId });
        }
        try {
            const adminBase = await getAdminBaseUrl();
            await fetch(`${adminBase}/handoff/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender_id: senderId }),
            });
        } catch (_) {}
        sessionTokenRef.current = null;
        setIsAuthenticated(false);
        isAuthenticatedRef.current = false;
        setIsGuest(true);
        setAuthUser('');
        setHandoffState('bot_active');
        await storage.removeItem(appIdRef.current, 'isAuthenticated');
        await storage.removeItem(appIdRef.current, 'authUser');
        await storage.clearMessages(appIdRef.current);
        const freshId = uuidv4();
        await storage.setItem(appIdRef.current, 'senderId', freshId);
        setSenderId(freshId);
        setMessages([{ id: 'init', sender: 'bot', text: "You've been signed out. Continuing as guest.\n\n📚 You can still search the Knowledge Base!\n🔑 Sign in anytime for full ticket features." }]);
        // Sign out of Keycloak if using IAM
        if (iam.isAuthenticated) {
            iam.logout().catch(() => {});
        }
    };

    // End session
    const handleEndSession = async () => {
        // End any active handoff
        if (socketRef.current && (handoffState === 'assigned' || handoffState === 'queued')) {
            socketRef.current.emit('user_end_session', { sender_id: senderId });
        }
        try {
            const adminBase = await getAdminBaseUrl();
            await fetch(`${adminBase}/handoff/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender_id: senderId }),
            });
        } catch (_) {}
        setHandoffState('bot_active');
        clearInterval(inactivityIntervalRef.current);
        setSessionEnded(true);
        setShowFeedback(true);
        setMessages(prev => [...prev, {
            id: uuidv4(),
            sender: 'bot',
            text: '**Session ended.** Thank you for chatting! Start a new conversation anytime.'
        }]);
    };

    // New conversation
    const handleNewConversation = async () => {
        // End any active handoff under current senderId
        if (socketRef.current && (handoffState === 'assigned' || handoffState === 'queued')) {
            socketRef.current.emit('user_end_session', { sender_id: senderId });
        }
        try {
            const adminBase = await getAdminBaseUrl();
            await fetch(`${adminBase}/handoff/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender_id: senderId }),
            });
        } catch (_) {}
        setHandoffState('bot_active');
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

    // Apply a product for the signed-in user: product-scoped senderId
    // (iam-{sub}-{product}, consistent with the chat proxy), persisted so it
    // auto-selects next time.
    const applyProduct = async (product) => {
        if (!product) return;
        appIdRef.current = product;
        setAppIdState(product);
        const sub = iam.user?.sub;
        let sid = sub ? `iam-${sub}-${product}` : await storage.getItem(product, 'senderId');
        if (!sid) { sid = uuidv4(); }
        setSenderId(sid);
        await storage.setItem('__global__', 'selectedProduct', product).catch(() => {});
        await storage.setItem(product, 'senderId', sid).catch(() => {});
        if (iam.isAuthenticated) {
            await storage.setItem(product, 'isAuthenticated', 'true').catch(() => {});
            await storage.setItem(product, 'authUser', iam.user?.username || '').catch(() => {});
        }
        _registerPushToken(sid);
        _fetchUnreadCount(sid);
    };

    // Switch product → end the current session everywhere, then start fresh.
    const switchProduct = async (product) => {
        setShowProductSelector(false);
        setShowUserMenu(false);
        if (!product || product === appIdRef.current) return;
        const oldSender = senderId;
        if (socketRef.current) {
            try { socketRef.current.emit('user_end_session', { sender_id: oldSender }); } catch { /* ignore */ }
        }
        try {
            const adminBase = await getAdminBaseUrl();
            await fetch(`${adminBase}/handoff/end`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(iam.token ? { Authorization: `Bearer ${iam.token}` } : {}) },
                body: JSON.stringify({ sender_id: oldSender }),
            });
        } catch { /* ignore */ }
        setHandoffState('bot_active');
        setSessionEnded(false);
        lastActivityRef.current = Date.now();
        await applyProduct(product);
        const label = PRODUCT_LABELS[product] || product;
        setMessages([{ id: 'init', sender: 'bot',
            text: `**Switched to ${label}.**\n\nHow can I help you with ${label} today?` }]);
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
    const fetchUserHistory = async (search = '') => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const adminBase = await getAdminBaseUrl();
            // Use preferred_username (stored in DB), not display name
            const historyUserName = iam.user?.username || authUser;
            const params = new URLSearchParams({ user_name: historyUserName });
            if (search) params.set('search', search);
            const res  = await fetch(`${adminBase}/api/user/conversations?${params}`);
            const resp = await res.json();
            if (resp.success) setHistoryList(resp.data);
        } catch (e) { console.error('Failed to fetch history', e); }
        finally { setHistoryLoading(false); }
    };

    // History — fetch messages for a selected session
    const fetchSessionMessages = async (session) => {
        setSessionLoading(true);
        try {
            const adminBase = await getAdminBaseUrl();
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

    // Session feedback
    const handleSessionFeedback = async (feedbackData) => {
        setFeedbackLoading(true);
        try {
            const adminBase = await getAdminBaseUrl();
            const response = await fetch(`${adminBase}/api/user/session/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: senderId,
                    user_id:   authUser,
                    app_id:    appIdRef.current,
                    rating:    feedbackData.rating,
                    comments:  feedbackData.comments,
                    queue_id:  pendingFeedbackQueueId || undefined,
                })
            });
            const result = await response.json();
            if (result.success) {
                setShowFeedback(false);
                setPendingFeedbackQueueId(null);
            } else {
                Alert.alert('Error', 'Failed to save feedback. Please try again.');
            }
        } catch (e) {
            console.error('Feedback error:', e);
            Alert.alert('Error', 'Failed to save feedback.');
        } finally {
            setFeedbackLoading(false);
        }
    };

    const PRODUCT_LABELS = { IT: 'IT Support', Accounting: 'Accounting', shipnest: 'ShipNest', greenloop: 'GreenLoop', 'account-wise': 'AccountWise', accountwise: 'AccountWise', 'stock-wise': 'StockWise', 'stock-wise-app': 'StockWise App', 'project-iq': 'Project IQ', 'brain-box': 'BrainBox', 'e-manifest_app': 'e-Manifest', 'app-1': 'App 1', 'clear-portal': 'Clear Portal', General: 'General' };

    const cleanPreview = (p) => {
        if (!p || p.startsWith('/')) return 'New conversation';
        return p.length > 60 ? p.slice(0, 60) + '…' : p;
    };

    const dateLabel = (iso) => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        const d = new Date(iso); d.setHours(0, 0, 0, 0);
        if (d.getTime() === today.getTime()) return 'Today';
        if (d.getTime() === yesterday.getTime()) return 'Yesterday';
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // Group sessions by product (app_id) then by date
    const groupSessionsByProduct = (sessions) => {
        const byProduct = {};
        for (const s of sessions) {
            const pid = s.app_id || 'General';
            if (!byProduct[pid]) byProduct[pid] = {};
            const dl = dateLabel(s.started_at);
            if (!byProduct[pid][dl]) byProduct[pid][dl] = [];
            byProduct[pid][dl].push(s);
        }
        return byProduct;
    };

    if (!ready) {
        return (
            <SafeAreaView style={styles.loadingContainer} edges={['top', 'bottom']}>
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
                    onPress={() => {
                        if (historyView !== 'chat') {
                            setHistoryView('chat');
                            setSelectedSession(null);
                        } else if (isAuthenticated && !isGuest) {
                            fetchUserHistory();
                            setHistoryView('history');
                        } else {
                            navigation.navigate('Settings');
                        }
                    }}
                >
                    <Ionicons
                        name={historyView !== 'chat' ? 'arrow-back' : 'time-outline'}
                        size={24}
                        color={historyView !== 'chat' ? THEME.primary : THEME.text}
                    />
                </TouchableOpacity>

                <Text style={styles.headerTitle}>{TITLE}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {(isAuthenticated || iam.isAuthenticated) && (
                    <TouchableOpacity
                        style={[styles.headerIconBtn, { marginRight: 0 }]}
                        onPress={() => navigation.navigate('Notifications', { userId: senderId })}
                    >
                        <View>
                            <Ionicons name="notifications-outline" size={23} color={THEME.text} />
                            {unreadCount > 0 && (
                                <View style={styles.notifBadge}>
                                    <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    style={styles.headerIconBtn}
                    onPress={isAuthenticated && !isGuest
                        ? () => setShowUserMenu(true)
                        : () => setShowLogin(true)
                    }
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
            </View>

            <KeyboardAvoidingView
                style={styles.flex}
                behavior={isKeyboardVisible ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}
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
                    <View style={{flex: 1}}>
                        {handoffState === 'queued' && (
                            <View style={styles.handoffBar}>
                                <Text style={styles.handoffBarText}>
                                    ⏳ Waiting for an agent{queuePosition != null ? ` — position ${queuePosition}` : ''}{waitMins != null ? ` · ~${waitMins} min` : ''}
                                </Text>
                            </View>
                        )}
                        {handoffState === 'assigned' && (
                            <View style={[styles.handoffBar, {backgroundColor: '#f0fdf4', borderBottomColor: '#bbf7d0'}]}>
                                <Text style={[styles.handoffBarText, {color: '#166534'}]}>
                                    💬 Connected to {operatorName || 'an agent'}
                                </Text>
                            </View>
                        )}
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
                                apiBaseUrl={apiBaseUrl}
                            />
                        )}
                        contentContainerStyle={styles.messagesList}
                        onContentSizeChange={scrollToEnd}
                        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
                        showsVerticalScrollIndicator={false}
                        ListFooterComponent={
                            operatorTyping && handoffState === 'assigned' ? (
                                <View style={styles.typingRow}>
                                    <View style={{width:24,height:24,borderRadius:12,backgroundColor:'#16a34a',alignItems:'center',justifyContent:'center',marginRight:6}}>
                                        <Text style={{fontSize:10,color:'#fff',fontWeight:'700'}}>{(operatorName||'A')[0].toUpperCase()}</Text>
                                    </View>
                                    <Text style={{fontSize:12,color:'#16a34a',marginRight:6,fontWeight:'500'}}>{operatorName || 'Agent'} is typing</Text>
                                    <View style={[styles.typingDot,{backgroundColor:'#16a34a'}]} />
                                    <View style={[styles.typingDot,{backgroundColor:'#16a34a'}]} />
                                    <View style={[styles.typingDot,{backgroundColor:'#16a34a'}]} />
                                </View>
                            ) : isLoading ? (
                                <View style={styles.typingRow}>
                                    <View style={styles.typingDot} />
                                    <View style={styles.typingDot} />
                                    <View style={styles.typingDot} />
                                </View>
                            ) : null
                        }
                    />
                    </View>
                )}

                {/* Quick Actions bar */}
                {!isWelcomeState && !sessionEnded && handoffState === 'bot_active' && (
                    <QuickActions onAction={handleButtonClick} isAuthenticated={isAuthenticated && !isGuest} />
                )}

                {/* Input Bar or New Conversation */}
                <View
                    style={[styles.inputSafeArea, { paddingBottom: isKeyboardVisible ? 0 : insets.bottom }, isWelcomeState && { backgroundColor: welcomeBg }]}
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
                                    onChangeText={(t) => {
                                        setInputText(t);
                                        if (socketRef.current && handoffState === 'assigned') {
                                            socketRef.current.emit('user_typing', { sender_id: senderId, typing: !!t.trim() });
                                        }
                                    }}
                                    placeholder={handoffState === 'assigned' ? 'Reply to agent…' : `Ask ${TITLE}...`}
                                    placeholderTextColor="#9ca3af"
                                    multiline={false}
                                    editable={handoffState !== 'queued'}
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
                                    <TouchableOpacity
                                        style={styles.inputIconBtn}
                                        onPress={() => Alert.alert(
                                            'Voice Input',
                                            'Tap the 🎤 microphone button on your keyboard to dictate.',
                                            [{ text: 'Got it', style: 'default' }]
                                        )}
                                    >
                                        <Ionicons name="mic-outline" size={22} color={THEME.textSecondary} />
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>
                    )}
                </View>
            </KeyboardAvoidingView>

            {/* Queue timeout choice — Remain or Leave */}
            <Modal visible={!!timeoutChoice} transparent animationType="fade" onRequestClose={() => setTimeoutChoice(null)}>
                <View style={styles.menuOverlay}>
                    <View style={[styles.menuDropdown, {maxWidth: 320, padding: 20}]}>
                        <Text style={{fontSize:14,color:'#374151',marginBottom:16,lineHeight:20}}>
                            {timeoutChoice?.message || 'Your wait time has been extended. Would you like to remain in the queue?'}
                        </Text>
                        <View style={{flexDirection:'row',gap:10}}>
                            {(timeoutChoice?.options || []).map((opt, i) => (
                                <TouchableOpacity
                                    key={i}
                                    style={{flex:1,paddingVertical:10,borderRadius:8,alignItems:'center',
                                        backgroundColor: i === 0 ? '#f59e0b' : 'transparent',
                                        borderWidth: i === 0 ? 0 : 1, borderColor:'#d1d5db'}}
                                    onPress={() => {
                                        setTimeoutChoice(null);
                                        if (opt.value !== 'remain') {
                                            handleButtonClick('/cancel_handoff');
                                        }
                                    }}
                                >
                                    <Text style={{fontSize:13,fontWeight:'600',
                                        color: i === 0 ? '#fff' : '#374151'}}>
                                        {opt.label}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modals */}
            <LoginModal
                visible={showLogin}
                onClose={() => setShowLogin(false)}
                onIamLogin={iam.login ? () => { setShowLogin(false); iam.login(); } : null}
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
                prefill={prefillFromMessages(messages)}
                apiBaseUrl={apiBaseUrl}
            />
            <SessionFeedbackModal
                visible={showFeedback}
                onClose={() => setShowFeedback(false)}
                onSubmit={handleSessionFeedback}
                isLoading={feedbackLoading}
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
                                <TouchableOpacity
                                    style={styles.menuItem}
                                    onPress={() => {
                                        setShowUserMenu(false);
                                        navigation.navigate('Profile', {
                                            authUser,
                                            appId: appIdRef.current,
                                            onLogout: handleLogout,
                                        });
                                    }}
                                >
                                    <Text style={styles.menuItemText}>My Profile</Text>
                                </TouchableOpacity>
                                {((iam.user?.subscriptions?.length ? iam.user.subscriptions : iam.user?.apps?.length ? iam.user.apps : iam.user?.products) || []).length > 1 && (
                                    <TouchableOpacity
                                        style={styles.menuItem}
                                        onPress={() => { setShowUserMenu(false); setShowProductSelector(true); }}
                                    >
                                        <Text style={styles.menuItemText}>
                                            Switch Product{appIdRef.current ? ` (${PRODUCT_LABELS[appIdRef.current] || appIdRef.current})` : ''}
                                        </Text>
                                    </TouchableOpacity>
                                )}
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
                <SafeAreaView style={styles.historyContainer} edges={['top', 'bottom']}>
                    {/* History List View */}
                    {historyView === 'history' && (
                        <>
                            <View style={styles.historyHeader}>
                                <TouchableOpacity onPress={() => setHistoryView('chat')} style={styles.historyBackBtn}>
                                    <Ionicons name="arrow-back" size={22} color={THEME.text} />
                                </TouchableOpacity>
                                <Text style={styles.historyTitle}>Conversation History</Text>
                            </View>
                            {/* Search bar */}
                            <View style={styles.searchBar}>
                                <Ionicons name="search-outline" size={16} color={THEME.textSecondary} style={{ marginRight: 6 }} />
                                <TextInput
                                    style={styles.searchInput}
                                    value={historySearch}
                                    onChangeText={t => {
                                        setHistorySearch(t);
                                        clearTimeout(window._mhTimer);
                                        window._mhTimer = setTimeout(() => fetchUserHistory(t), 350);
                                    }}
                                    placeholder="Search conversations…"
                                    placeholderTextColor="#9ca3af"
                                    returnKeyType="search"
                                /></View>
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
                                <ScrollView style={styles.historyScroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                                    {Object.entries(groupSessionsByProduct(historyList)).map(([productId, dateGroups]) => (
                                        <View key={productId} style={{ marginBottom: 16 }}>
                                            {/* Product header */}
                                            <View style={styles.historyProductHeader}>
                                                <Text style={styles.historyProductLabel}>{PRODUCT_LABELS[productId] || productId}</Text>
                                                <View style={styles.historyProductLine} />
                                            </View>
                                            {Object.entries(dateGroups).map(([dl, sessions]) => (
                                                <View key={dl}>
                                                    <Text style={styles.historySectionLabel}>{dl}</Text>
                                                    {sessions.map(session => (
                                                        <TouchableOpacity
                                                            key={session.sender_id}
                                                            style={styles.historyCard}
                                                            onPress={() => fetchSessionMessages(session)}
                                                            activeOpacity={0.7}
                                                        >
                                                            <View style={styles.historyCardHeader}>
                                                                <View style={{ flex: 1 }}>
                                                                    <Text style={styles.historyCardTime}>
                                                                        {new Date(session.started_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                                    </Text>
                                                                    <Text style={styles.historyCardPreview} numberOfLines={2}>
                                                                        {cleanPreview(session.preview)}
                                                                    </Text>
                                                                </View>
                                                                {session.rating && (
                                                                    <View style={styles.ratingBadge}>
                                                                        <Ionicons name="star" size={14} color="#fbbf24" />
                                                                        <Text style={styles.ratingText}>{session.rating}</Text>
                                                                    </View>
                                                                )}
                                                            </View>
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
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
                                <TouchableOpacity
                                    onPress={() => { setHistoryView('history'); setSelectedSession(null); }}
                                    style={styles.historyBackBtn}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                >
                                    <Ionicons name="arrow-back" size={22} color={THEME.text} />
                                </TouchableOpacity>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.historyTitle} numberOfLines={1}>
                                        {new Date(selectedSession.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </Text>
                                    <Text style={{ fontSize: 11, color: THEME.textSecondary, marginTop: 1 }} numberOfLines={1}>
                                        {cleanPreview(selectedSession.preview)}
                                    </Text>
                                </View>
                                <TouchableOpacity
                                    style={styles.historyBackBtn}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                    onPress={async () => {
                                        try {
                                            const Print   = await import('expo-print');
                                            const Sharing = await import('expo-sharing');
                                            const msgs    = selectedSession.messages || [];
                                            const rows    = msgs.map(m => `
                                                <div class="${m.sender === 'bot' ? 'bot' : 'user'}">
                                                    <strong>${m.sender === 'bot' ? '🤖 Bot' : '👤 You'}</strong>
                                                    <p>${(m.text || '').replace(/</g,'&lt;')}</p>
                                                </div>`).join('');
                                            const html = `<html><head><style>
                                                body{font-family:sans-serif;padding:20px;font-size:13px}
                                                .bot{background:#f3f4f6;border-radius:8px;padding:8px 12px;margin:6px 0}
                                                .user{background:#dbeafe;border-radius:8px;padding:8px 12px;margin:6px 0;text-align:right}
                                                strong{font-size:11px;color:#6b7280}
                                                p{margin:4px 0}
                                            </style></head><body>
                                                <h2>Conversation — ${new Date(selectedSession.started_at).toLocaleDateString()}</h2>
                                                ${rows}
                                            </body></html>`;
                                            const { uri } = await Print.default.printToFileAsync({ html });
                                            await Sharing.default.shareAsync(uri, { mimeType: 'application/pdf' });
                                        } catch (e) { Alert.alert('Export failed', e.message); }
                                    }}
                                >
                                    <Ionicons name="share-outline" size={22} color={THEME.primary} />
                                </TouchableOpacity>
                            </View>
                            {sessionLoading ? (
                                <View style={styles.historyCentered}>
                                    <ActivityIndicator size="large" color={THEME.primary} />
                                </View>
                            ) : (
                                <FlatList
                                    data={selectedSession.messages || []}
                                    keyExtractor={item => item.id}
                                    contentContainerStyle={[styles.messagesList, { paddingTop: 8 }]}
                                    renderItem={({ item }) => (
                                        <MessageBubble
                                            message={item}
                                            readonly
                                        />
                                    )}
                                    showsVerticalScrollIndicator={false}
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

            {/* ── Product Selector (IAM entitlement-driven) ──────────────────── */}
            <Modal
                visible={showProductSelector}
                transparent
                animationType="fade"
                onRequestClose={() => setShowProductSelector(false)}
            >
                <TouchableWithoutFeedback onPress={() => setShowProductSelector(false)}>
                    <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
                        <TouchableWithoutFeedback>
                            <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360 }}>
                                <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 }}>
                                    Which product do you need help with?
                                </Text>
                                <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                                    Your account has access to multiple products.
                                </Text>
                                {((iam.user?.subscriptions?.length ? iam.user.subscriptions : iam.user?.apps?.length ? iam.user.apps : iam.user?.products) || []).map(pid => (
                                    <TouchableOpacity
                                        key={pid}
                                        onPress={() => switchProduct(pid)}
                                        style={{
                                            borderWidth: 1,
                                            borderColor: pid === appIdRef.current ? THEME.primary : '#e5e7eb',
                                            backgroundColor: pid === appIdRef.current ? 'rgba(0,0,0,0.03)' : '#fff',
                                            borderRadius: 10,
                                            padding: 14,
                                            marginBottom: 10,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.primary, marginRight: 12 }} />
                                        <Text style={{ fontSize: 14, fontWeight: '500', color: THEME.text }}>
                                            {PRODUCT_LABELS[pid] || pid}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity
                                    onPress={() => setShowProductSelector(false)}
                                    style={{ marginTop: 4, padding: 10, alignItems: 'center' }}
                                >
                                    <Text style={{ fontSize: 13, color: '#9ca3af' }}>Continue without selecting</Text>
                                </TouchableOpacity>
                            </View>
                        </TouchableWithoutFeedback>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>
        </SafeAreaView>
    );
};

const makeStyles = (THEME) => StyleSheet.create({
    container: { flex: 1, backgroundColor: THEME.background },
    flex: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: THEME.background },
    loadingText: { marginTop: 12, color: '#6b7280', fontSize: 14 },

    // Handoff status bar
    handoffBar: {
        backgroundColor: '#fffbeb',
        borderBottomWidth: 1,
        borderBottomColor: '#fde68a',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    handoffBarText: {
        fontSize: 13,
        color: '#92400e',
        fontWeight: '500',
    },

    // Header — Gemini style
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingVertical: 10,
        minHeight: 56,
        backgroundColor: THEME.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: THEME.border,
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
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    welcomeChip: {
        paddingHorizontal: 22,
        paddingVertical: 16,
        backgroundColor: THEME.background,
        borderRadius: 26,
        borderWidth: 1,
        borderColor: THEME.border,
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
        backgroundColor: THEME.userBubble,
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
        backgroundColor: THEME.background,
        borderRadius: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 10,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: THEME.border,
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
        color: THEME.text,
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
        color: THEME.text,
    },
    menuItemTextMuted: {
        fontSize: 14,
        color: THEME.textSecondary,
    },
    menuDivider: {
        height: 1,
        backgroundColor: 'rgba(0,0,0,0.08)',
        marginVertical: 4,
    },

    // History panel
    historyContainer: { flex: 1, backgroundColor: THEME.background },
    historyHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 12,
        paddingTop: 14,
        backgroundColor: THEME.background,
        borderBottomWidth: 1,
        borderBottomColor: THEME.border,
        minHeight: 56,
    },
    notifBadge: {
        position: 'absolute',
        top: -4,
        right: -4,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: THEME.primary,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 2,
    },
    notifBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },
    historyBackBtn: { padding: 8, borderRadius: 20, marginRight: 4 },
    historyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: THEME.text,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: THEME.userBubble,
        borderRadius: 10,
        marginHorizontal: 16,
        marginVertical: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    searchInput: { flex: 1, fontSize: 14, color: THEME.text },
    historyProductHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
        gap: 8,
    },
    historyProductLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: THEME.primary,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    historyProductLine: {
        flex: 1,
        height: 1,
        backgroundColor: '#dbeafe',
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
        backgroundColor: THEME.background,
        borderRadius: 12,
        padding: 14,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: THEME.border,
    },
    historyCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    historyCardTime: { fontSize: 12, color: '#9ca3af', marginBottom: 4 },
    historyCardPreview: { fontSize: 14, color: THEME.text, lineHeight: 20, flex: 1 },
    ratingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#fef3c7',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginLeft: 8,
    },
    ratingText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#92400e',
    },
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
