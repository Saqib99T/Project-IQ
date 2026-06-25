import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, Paperclip, Minimize2, X, User, Lock, XCircle, Sparkles, History, ChevronLeft, ChevronDown, Mic, MicOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import MessageBubble from './MessageBubble';
import AnimatedChatIcon from './AnimatedChatIcon';
import ProfilePanel from './ProfilePanel';
import NotificationBell from './NotificationBell';
import { v4 as uuidv4 } from 'uuid';
import { getCookie, setCookie, deleteCookie } from '../utils/cookieUtils';
import { useChatSocket }  from '../hooks/useChatSocket';
import { useChatHistory } from '../hooks/useChatHistory';
import { useIam } from '../hooks/useIam';
import { prefillFromMessages } from '../utils/prefillTicket';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

// All API calls (including Rasa proxy) go through the admin server on the same origin.
// This ensures the passive-mode gate in chat_webhook_proxy() fires correctly.
const ADMIN_API_URL = window.location.origin;
const RASA_API_URL  = `${ADMIN_API_URL}/webhooks/rest/webhook`;

// Storage keys with appId prefix for multi-widget support
// Cookies: auth data (senderId, isAuthenticated, authUser, privacyDismissed)
// localStorage: large data (messages)
const getStorageKey = (appId, key) => `glpi-chat-${appId}-${key}`;


const ChatWindow = ({ title = "Project IQ", appId = "General", theme = null }) => {
    // ── IAM integration ───────────────────────────────────────────────────────
    const iam = useIam();
    // When IAM authenticates, override local auth state
    const iamAuthenticated = iam.isAuthenticated && !!iam.user;

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
    // Authenticated users get a deterministic ID so their session survives across
    // browsers / devices.  Guests get a random UUID.
    const [senderId, setSenderId] = useState(() => {
        const stored = getCookie(getStorageKey(appId, 'senderId'));
        if (stored) return stored;
        const newId = uuidv4();
        setCookie(getStorageKey(appId, 'senderId'), newId);
        return newId;
    });

    // ── Per-session epoch ─────────────────────────────────────────────────────
    // Each chat session must be its OWN record in history. For signed-in users
    // the id is iam-{sub}-{product}-{epoch}; a new epoch ⇒ new sender_id ⇒ new
    // conversations row ⇒ separate history entry. The epoch is bumped on a fresh
    // login (Keycloak sid changes) and on "New conversation", but is stable
    // across reloads (persisted), so a reload stays in the same session.
    const [sessionEpoch, setSessionEpoch] = useState(
        () => getCookie(getStorageKey(appId, 'sessionEpoch')) || '');
    const newEpoch = () => `s${Date.now().toString(36)}`;

    // ── IAM-aware fetch headers ───────────────────────────────────────────────
    const getAuthHeaders = useCallback(() => {
        const h = { 'Content-Type': 'application/json' };
        if (iam.token) h['Authorization'] = `Bearer ${iam.token}`;
        return h;
    }, [iam.token]);

    // ── Selected product (IAM subscription-driven) ────────────────────────────
    // Sessions are product-scoped: sender_id = iam-{sub}-{product}. The user must
    // pick a product before chatting; the choice is persisted per-device and
    // auto-restored next time. Products come from the IAM `products` claim
    // (subscribed/active products); `apps` is only a fallback.
    const [selectedProductId, setSelectedProductId] = useState(
        () => getCookie(getStorageKey(appId, 'selectedProduct')) || null
    );
    // Subscribed products fetched from the backend (org's ACTIVE subscriptions).
    // Authoritative source for the picker — the token doesn't carry them.
    const [subscribedProducts, setSubscribedProducts] = useState(null);

    // The product list for this user. Priority:
    //  1. `subscriptions` — org's active subscribed apps (when IAM emits it on the token)
    //  2. `apps` — the apps the USER holds application roles in (resource_access) ← workaround
    //  3. `products` — last resort (currently just ["itsm"])
    const productList = useMemo(() => {
        if (Array.isArray(subscribedProducts) && subscribedProducts.length) return subscribedProducts;
        const subs = iam.user?.subscriptions;
        if (Array.isArray(subs) && subs.length) return subs;
        const a = iam.user?.apps;
        if (Array.isArray(a) && a.length) return a;
        return iam.user?.products || [];
    }, [subscribedProducts, iam.user?.subscriptions, iam.user?.apps, iam.user?.products]);

    // Fetch the org's active subscribed products from the backend (it resolves
    // them from IAM org subscriptions, since the JWT doesn't include them).
    useEffect(() => {
        if (!iamAuthenticated || !iam.token) return;
        let cancelled = false;
        fetch(`${ADMIN_API_URL}/api/my-products`, {
            headers: { Authorization: `Bearer ${iam.token}` },
        })
            .then(r => (r.ok ? r.json() : null))
            .then(d => {
                if (cancelled) return;
                // Always mark as resolved (even on empty) so the resolver below can run.
                // Empty array → productList falls back to the token-derived list.
                setSubscribedProducts(d && Array.isArray(d.products) && d.products.length ? d.products : []);
            })
            .catch(() => { if (!cancelled) setSubscribedProducts([]); });
        return () => { cancelled = true; };
    }, [iamAuthenticated, iam.token]);

    const PRODUCT_LABELS = { IT: 'IT Support', Accounting: 'Accounting', shipnest: 'ShipNest',
        greenloop: 'GreenLoop', 'account-wise': 'AccountWise', accountwise: 'AccountWise',
        'stock-wise': 'StockWise', 'stock-wise-app': 'StockWise App', 'project-iq': 'Project IQ',
        'brain-box': 'BrainBox', 'e-manifest_app': 'e-Manifest', 'app-1': 'App 1',
        'clear-portal': 'Clear Portal', General: 'General' };
    const productLabel = (id) => PRODUCT_LABELS[id]
        || String(id).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Resolve the active product once IAM loads: keep a valid current/persisted
    // choice, else auto-select when there's only one, else leave null (→ picker).
    useEffect(() => {
        if (!iamAuthenticated || !productList.length) return;
        // Wait for the AUTHORITATIVE subscription list before auto-resolving. Otherwise
        // the resolver runs against the short token fallback and discards a valid
        // persisted choice (e.g. resets "stock-wise" → "project-iq") before the real
        // list arrives. subscribedProducts === null means "fetch not settled yet".
        if (subscribedProducts === null) return;
        setSelectedProductId(prev => {
            if (prev && productList.includes(prev)) return prev;
            const stored = getCookie(getStorageKey(appId, 'selectedProduct'));
            if (stored && productList.includes(stored)) return stored;
            if (productList.length === 1) return productList[0];
            if (appId && productList.includes(appId)) return appId;
            return null;
        });
    }, [iamAuthenticated, productList, appId, subscribedProducts]);

    // Persist the selection so it auto-selects next visit.
    useEffect(() => {
        if (selectedProductId) setCookie(getStorageKey(appId, 'selectedProduct'), selectedProductId);
    }, [selectedProductId, appId]);

    // Chat is gated for authenticated users until a product is chosen.
    const productGateActive = iamAuthenticated && !selectedProductId;

    // ── Login via IAM ─────────────────────────────────────────────────────────
    const handleIamLogin = useCallback(() => {
        iam.login({ redirectUri: window.location.href });
    }, [iam]);

    // ── Sync IAM → local auth state ───────────────────────────────────────────
    // senderId is product-scoped (iam-{sub}-{product}) and MUST match what the
    // chat proxy computes server-side, so socket rooms / handoff status line up.
    // Start a NEW session record on each fresh login: when the Keycloak session
    // id (sid) differs from the one our current epoch was minted for, bump the
    // epoch. Reloads restore the same sid ⇒ same epoch ⇒ same session record.
    useEffect(() => {
        if (!iamAuthenticated || !iam.user?.sid) return;
        const lastSid = getCookie(getStorageKey(appId, 'sessionSid'));
        if (iam.user.sid !== lastSid) {
            const ep = newEpoch();
            setCookie(getStorageKey(appId, 'sessionEpoch'), ep);
            setCookie(getStorageKey(appId, 'sessionSid'), iam.user.sid);
            setSessionEpoch(ep);
        }
    }, [iamAuthenticated, iam.user?.sid, appId]);

    useEffect(() => {
        if (iamAuthenticated && iam.user) {
            // iam-{sub}-{product}-{epoch}: product-scoped AND session-scoped, so
            // each login / new conversation is its own record (see sessionEpoch).
            const base = `iam-${iam.user.sub}`;
            const prod = selectedProductId ? `-${selectedProductId}` : '';
            const ep   = sessionEpoch ? `-${sessionEpoch}` : '';
            const iamSenderId = `${base}${prod}${ep}`;
            setSenderId(iamSenderId);
            setCookie(getStorageKey(appId, 'senderId'), iamSenderId);
            setIsAuthenticated(true);
            setIsGuest(false);
            setAuthUser(iam.user.name || iam.user.username || iam.user.email);
            setCookie(getStorageKey(appId, 'isAuthenticated'), 'true');
            setCookie(getStorageKey(appId, 'authUser'), iam.user.username || '');
        }
    }, [iamAuthenticated, iam.user, appId, selectedProductId, sessionEpoch]);

    // When the identity (senderId) changes to a NEW session — e.g. a fresh login
    // — start with a clean chat so the previous session's messages never carry
    // over. Explicit handlers (new conversation / switch product / logout) set
    // skipAutoClearRef because they render their own context-specific welcome.
    const sessionIdentityRef = useRef(senderId);
    const skipAutoClearRef   = useRef(false);
    useEffect(() => {
        if (sessionIdentityRef.current === senderId) return;
        sessionIdentityRef.current = senderId;
        if (skipAutoClearRef.current) { skipAutoClearRef.current = false; return; }
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        const welcome = (isAuthenticated && authUser)
            ? `**Hi ${authUser}!**\n\nHow can I help you today?`
            : `**Hi, I'm ${title}** 👋\n\nHow can I help you today?`;
        setMessages([{ id: 'init', sender: 'bot', text: welcome }]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senderId]);

    // Authentication state - check cookies for persisted login.
    // If this browser has an active operator session (op_token in localStorage),
    // never auto-restore a chatbot user session — operators should not appear
    // as regular chat users inside the widget.
    const _operatorBrowser = !!localStorage.getItem('op_token');

    const [isAuthenticated, setIsAuthenticated] = useState(() => {
        return getCookie(getStorageKey(appId, 'isAuthenticated')) === 'true';
    });
    const [isGuest, setIsGuest] = useState(() => {
        const loggedIn = getCookie(getStorageKey(appId, 'isAuthenticated')) === 'true';
        return !loggedIn;
    });
    const [authUser, setAuthUser] = useState(() => {
        return getCookie(getStorageKey(appId, 'authUser')) || '';
    });
    const [showLoginPrompt, setShowLoginPrompt] = useState(false);
    const [showProfile, setShowProfile] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('piq_dark') === 'true');
    const toggleDark = () => setIsDarkMode(v => { localStorage.setItem('piq_dark', !v); return !v; });

    // ── Centralised metadata builder ──────────────────────────────────────────
    const buildMetadata = useCallback((extra = {}) => ({
        // Per-turn correlation id — threaded through Admin API → Rasa → actions →
        // itsm so one turn can be traced across services. Sent in metadata (not a
        // header) to avoid a CORS preflight on the cross-origin widget embed.
        request_id:       uuidv4().replace(/-/g, '').slice(0, 8),
        app_id:           selectedProductId || appId,
        product_id:       selectedProductId || appId || undefined,
        product_name:     selectedProductId ? productLabel(selectedProductId) : undefined,
        user_name:        authUser || undefined,
        is_authenticated: !!(isAuthenticated || iamAuthenticated),
        iam_sub:          iam.user?.sub,
        iam_name:         iam.user?.name,
        iam_email:        iam.user?.email,
        iam_org_id:       iam.user?.organization_id || undefined,
        iam_org_name:     iam.user?.organization_alias || undefined,
        channel:          iam.user?.organization_id ? 'internal' : undefined,
        iam_token:        iam.token || undefined,
        session_token:    getCookie(getStorageKey(appId, 'glpiSessionToken')) || undefined,
        ...extra,
    }), [selectedProductId, appId, authUser, isAuthenticated, iamAuthenticated, iam.user]);

    const darkBg      = '#111827';
    const darkText    = '#f9fafb';
    const effectiveBg = isDarkMode ? darkBg   : bgColor;
    const effectiveTx = isDarkMode ? darkText : textColor;

    // Unified dark/light palette — use `c.*` throughout instead of hardcoded colors
    const c = {
        bg:         effectiveBg,
        text:       effectiveTx,
        surface:    isDarkMode ? '#1e2533' : '#ffffff',
        surfaceAlt: isDarkMode ? '#252d3d' : '#f9fafb',
        border:     isDarkMode ? '#2e3a4e' : '#e5e7eb',
        borderLight:isDarkMode ? '#2e3a4e' : '#f3f4f6',
        textMuted:  isDarkMode ? '#9ca3af' : '#6b7280',
        textSub:    isDarkMode ? '#6b7280' : '#9ca3af',
        inputBg:    isDarkMode ? '#1e2533' : '#f3f4f6',
        msgUser:    isDarkMode ? '#2d3a50' : '#f0f4f9',
        hover:      isDarkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.04)',
        welcomeBg:  isDarkMode ? '#151e2e' : '#EEF2FA',
    };

    const [isListening, setIsListening] = useState(false);
    const [voiceError, setVoiceError]   = useState('');
    const recognitionRef = useRef(null);
    const voiceErrTimer  = useRef(null);

    const _showVoiceErr = (msg) => {
        setVoiceError(msg);
        if (voiceErrTimer.current) clearTimeout(voiceErrTimer.current);
        voiceErrTimer.current = setTimeout(() => setVoiceError(''), 4000);
    };

    const startVoice = useCallback(() => {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        if (isListening) { recognitionRef.current?.stop(); return; }
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.onresult = (e) => {
            const transcript = Array.from(e.results)
                .map(r => r[0].transcript)
                .join('');
            setInputText(transcript);
        };
        rec.onend   = () => setIsListening(false);
        rec.onerror = (e) => {
            setIsListening(false);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                _showVoiceErr('Microphone access denied — check browser permissions.');
            } else if (e.error === 'no-speech') {
                _showVoiceErr('No speech detected. Try again.');
            } else if (e.error === 'network') {
                _showVoiceErr('Voice input requires an internet connection.');
            } else {
                _showVoiceErr('Microphone unavailable.');
            }
        };
        recognitionRef.current = rec;
        try {
            rec.start();
            setIsListening(true);
        } catch (err) {
            _showVoiceErr('Could not start microphone: ' + (err.message || err));
        }
    }, [isListening]); // eslint-disable-line
    const [webUnreadCount, setWebUnreadCount] = useState(0);
    const [historySearch, setHistorySearch] = useState('');

    // ── Tab title badge + PWA badge API ───────────────────────────────────────
    useEffect(() => {
        const base = title || 'Project IQ';
        if (webUnreadCount > 0) {
            document.title = `(${webUnreadCount}) ${base}`;
            // Web App Badge API — works when installed as PWA (Chrome/Edge)
            if ('setAppBadge' in navigator) {
                navigator.setAppBadge(webUnreadCount).catch(() => {});
            }
        } else {
            document.title = base;
            if ('clearAppBadge' in navigator) {
                navigator.clearAppBadge().catch(() => {});
            }
        }
        // Clear badge when tab is visible
        const onVisible = () => {
            if (document.visibilityState === 'visible' && webUnreadCount === 0) {
                document.title = base;
            }
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [webUnreadCount, title]);

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
        // Different welcome for logged-in vs guest users (never use operator browser's chatbot session)
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
    // Welcome state = a fresh conversation (only the init message). Shows the
    // "Where should we start?" screen with quick-action buttons — for BOTH guests
    // and signed-in users (the screen has an authenticated button set).
    const isWelcomeState = messages.length === 1 && messages[0]?.id === 'init' && !sessionEnded;

    // After IAM sign-in, replace any stale single init message (e.g. the leftover
    // "You've been signed out" guest message restored from localStorage) with a
    // proper signed-in welcome, so the user never sees the logout text post-login.
    useEffect(() => {
        if (!iamAuthenticated || !iam.user) return;
        setMessages(prev => {
            if (prev.length === 1 && prev[0]?.id === 'init') {
                const name = iam.user.name || iam.user.username || authUser || 'there';
                // While in the welcome state, the greeting reflects product status:
                // selected → tell them which product; not selected → ask them to pick.
                const text = selectedProductId
                    ? `**Hi ${name}!** 👋\n\nYou're chatting about **${productLabel(selectedProductId)}**. How can I help you today?`
                    : `**Hi ${name}!** 👋\n\nPlease select a product below to get started.`;
                return [{ id: 'init', sender: 'bot', text }];
            }
            return prev;
        });
    }, [iamAuthenticated, iam.user, authUser, selectedProductId]);

    // Inactivity timeout
    const [timeoutMinutes, setTimeoutMinutes] = useState(10);
    // Lead time (minutes before timeout) for the "Still there?" warning — configurable.
    const [warningMinutes, setWarningMinutes] = useState(5);
    const lastActivityRef = useRef(Date.now());
    const warningShownRef = useRef(false);
    const sessionEndedRef = useRef(false);
    const inactivityIntervalRef = useRef(null);
    const [showTicketFilterPopup, setShowTicketFilterPopup] = useState(false);
    const [filterLimit, setFilterLimit] = useState(5); // No. of records to fetch on filter
    const [showTicketIdPopup, setShowTicketIdPopup] = useState(false);
    const [ticketIdInput, setTicketIdInput] = useState('');
    const [inputText, setInputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [historyView, setHistoryView] = useState('chat'); // 'chat' | 'history' | 'session'
    const [selectedSession, setSelectedSession] = useState(null);
    const [sessions, setSessions] = useState([]);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showProductDropdown, setShowProductDropdown] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [sessionLoading, setSessionLoading] = useState(false);
    const userMenuRef = useRef(null);
    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    // ── Handoff state ──────────────────────────────────────────────────────
    // 'bot_active' | 'queued' | 'assigned'
    const [handoffState,    setHandoffState]    = useState('bot_active');
    const [queuePosition,   setQueuePosition]   = useState(null);
    const [waitMins,        setWaitMins]        = useState(null);
    const [operatorName,    setOperatorName]    = useState('');
    const [operatorTyping,  setOperatorTyping]  = useState(false);
    // timeout choice: { message, options: [{label,value}] }
    const [timeoutChoice,   setTimeoutChoice]   = useState(null);
    // feedback request shown after operator resolves: { queueId, conversationId } or null
    const [pendingFeedback,  setPendingFeedback]  = useState(null);
    const [feedbackHover,    setFeedbackHover]    = useState(0);   // star hovered (preview)
    const [feedbackRating,   setFeedbackRating]   = useState(0);   // star selected
    const [feedbackComment,  setFeedbackComment]  = useState('');  // comment text
    const [feedbackDone,     setFeedbackDone]     = useState(false);
    const socketRef       = useRef(null);
    const opTypingTimer   = useRef(null);
    const userTypingTimer = useRef(null);
    const isUserTypingRef = useRef(false);
    const handoffStateRef = useRef('bot_active');
    // Watermark of the most recent operator message already shown (ISO string).
    // Used to back-fill any operator messages missed while the socket was asleep
    // (background tab) without re-adding ones we already have. The DB is the
    // source of truth; the socket is just a fast path.
    const lastOpTsRef     = useRef(null);

    // Hooks — socket and history logic extracted for maintainability.
    // TODO: replace the inline useEffect/handlers below with these hooks once tested.
    // useChatSocket provides: socketRef, opTypingTimer, userTypingTimer, emitUserEndSession, emitUserTyping
    // useChatHistory provides: sessions, historyLoading, sessionLoading, selectedSession, historyView, fetchUserHistory, fetchSessionMessages

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    // Keep handoffStateRef in sync so inactivity timeout can read current state
    useEffect(() => { handoffStateRef.current = handoffState; }, [handoffState]);

    // Initialise the operator-message watermark once from any persisted messages,
    // so the first back-fill won't re-add operator messages we already restored.
    useEffect(() => {
        const times = messages
            .filter(m => m.sender === 'operator' && m.timestamp)
            .map(m => new Date(m.timestamp).getTime())
            .filter(t => !Number.isNaN(t));
        if (times.length) lastOpTsRef.current = new Date(Math.max(...times)).toISOString();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Back-fill operator messages from the DB (source of truth) that we missed
    // while the socket was asleep. Appends only ones newer than the watermark, so
    // it's safe to call on every (re)connect and tab focus.
    const backfillOperatorMessages = useCallback(async () => {
        if (!senderId) return;
        try {
            const res  = await fetch(`${ADMIN_API_URL}/api/user/conversation/${encodeURIComponent(senderId)}/messages`);
            const data = await res.json();
            if (!data?.success || !Array.isArray(data.data)) return;
            const watermark = lastOpTsRef.current ? new Date(lastOpTsRef.current).getTime() : 0;
            const fresh = data.data.filter(m =>
                m.sender === 'operator' && m.text &&
                m.timestamp && new Date(m.timestamp).getTime() > watermark
            );
            if (!fresh.length) return;
            const maxTs = Math.max(...fresh.map(m => new Date(m.timestamp).getTime()));
            lastOpTsRef.current = new Date(maxTs).toISOString();
            setMessages(prev => [
                ...prev,
                ...fresh.map(m => ({ id: uuidv4(), sender: 'operator', text: m.text, timestamp: m.timestamp })),
            ]);
        } catch { /* non-fatal — socket will catch up, or next focus retries */ }
    }, [senderId]);

    // Notify backend when user ends session during an active handoff
    const emitUserEndSession = useCallback(() => {
        if (handoffStateRef.current === 'bot_active') return;
        // Socket.IO notification
        if (socketRef.current) {
            socketRef.current.emit('user_end_session', { sender_id: senderId });
        }
        // REST fallback — ensures handoff is cleaned up even if Socket is laggy
        fetch(`${ADMIN_API_URL}/handoff/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender_id: senderId }),
        }).catch(() => {});
        setHandoffState('bot_active');
        setOperatorName('');
        setQueuePosition(null);
        setWaitMins(null);
        setTimeoutChoice(null);
    }, [senderId]);

    // Emit user typing events when assigned to an operator
    const emitUserTyping = useCallback((typing) => {
        if (!socketRef.current || handoffState !== 'assigned') return;
        if (typing === isUserTypingRef.current) return;
        isUserTypingRef.current = typing;
        socketRef.current.emit('user_typing', {
            sender_id: senderId,
            typing,
        });
    }, [handoffState, senderId]);

    const handleInputTyping = () => {
        emitUserTyping(true);
        clearTimeout(userTypingTimer.current);
        userTypingTimer.current = setTimeout(() => emitUserTyping(false), 3000);
    };

    // Save messages to localStorage whenever they change
    useEffect(() => {
        localStorage.setItem(getStorageKey(appId, 'messages'), JSON.stringify(messages));
    }, [messages, appId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Fetch session timeout + warning lead time from admin config on mount
    useEffect(() => {
        fetch(`${ADMIN_API_URL}/admin/config/SESSION_TIMEOUT_MINUTES`)
            .then(r => r.json())
            .then(d => {
                const val = parseInt(d.value || d.SESSION_TIMEOUT_MINUTES || '10', 10);
                if (!isNaN(val) && val > 0) setTimeoutMinutes(val);
            })
            .catch(() => {}); // silently fall back to default 10
        fetch(`${ADMIN_API_URL}/admin/config/SESSION_WARNING_MINUTES`)
            .then(r => r.json())
            .then(d => {
                const val = parseInt(d.value || d.SESSION_WARNING_MINUTES || '5', 10);
                if (!isNaN(val) && val > 0) setWarningMinutes(val);
            })
            .catch(() => {}); // silently fall back to default 5
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

    // ── Socket.IO — handoff real-time events ───────────────────────────────
    useEffect(() => {
        const socket = io(ADMIN_API_URL, { transports: ['websocket', 'polling'] });
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('join_user', { sender_id: senderId });

            // Pull any operator messages we missed while disconnected.
            backfillOperatorMessages();

            // Restore handoff state after reconnect / page refresh
            fetch(`${ADMIN_API_URL}/handoff/status/${encodeURIComponent(senderId)}`)
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
                    // bot_active — nothing to restore, already default
                })
                .catch(() => {}); // non-fatal — push events will sync if server is up
        });

        // Entered the queue
        socket.on('handoff_queued', (d) => {
            setHandoffState('queued');
            setQueuePosition(d.queue_position || 1);
            setWaitMins(d.wait_estimate_mins || null);
            setTimeoutChoice(null);
        });

        // Wait position refreshed every 60 s
        socket.on('wait_update', (d) => {
            setQueuePosition(d.queue_position);
            setWaitMins(d.wait_estimate_mins);
        });

        // Operator claimed the chat
        socket.on('handoff_assigned', (d) => {
            setHandoffState('assigned');
            setOperatorName(d.operator_name || 'an agent');
            setQueuePosition(null);
            setWaitMins(null);
            setTimeoutChoice(null);
            setMessages(prev => [...prev, {
                id: uuidv4(),
                sender: 'bot',
                text: d.message || `✅ **${d.operator_name || 'An agent'}** has joined the conversation.`,
                type: 'system',
            }]);
        });

        // Operator sent a message
        socket.on('operator_message', (d) => {
            // Ignore if this message is not for this conversation
            if (d.sender_id && d.sender_id !== senderId) return;
            // Dedup against back-fill: skip anything at/older than the watermark
            // (back-fill may have already appended this exact message).
            const ts = d.timestamp ? new Date(d.timestamp).getTime() : 0;
            if (ts && lastOpTsRef.current && ts <= new Date(lastOpTsRef.current).getTime()) return;
            if (ts) lastOpTsRef.current = d.timestamp;
            setMessages(prev => [...prev, {
                id: uuidv4(),
                sender: 'operator',
                text: d.text,
                timestamp: d.timestamp,
            }]);
            // Clear operator typing when message arrives
            setOperatorTyping(false);
            clearTimeout(opTypingTimer.current);
        });

        // Operator is typing
        socket.on('operator_typing', (d) => {
            setOperatorTyping(d.typing);
            if (d.typing) {
                clearTimeout(opTypingTimer.current);
                opTypingTimer.current = setTimeout(() => setOperatorTyping(false), 5000);
            } else {
                clearTimeout(opTypingTimer.current);
            }
        });

        // Handoff resolved — return to bot or closed
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
            // Agent closed the support session → end it: hide the quick-action
            // buttons and surface the "New Conversation" button (matches the
            // inactivity / manual-end behaviour).
            setSessionEnded(true);
            sessionEndedRef.current = true;
            // Show feedback form if requested
            if (d.request_feedback) {
                setFeedbackRating(0);
                setFeedbackHover(0);
                setFeedbackComment('');
                setFeedbackDone(false);
                setPendingFeedback({
                    queueId:        d.queue_id || null,
                    conversationId: d.conversation_id || null,
                });
            }
        });

        // Abandoned — queue timeout expired
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

        // Queue timeout — ask Remain or Leave email
        socket.on('handoff_timeout_choice', (d) => {
            setTimeoutChoice({ message: d.message, options: d.options });
        });

        return () => {
            clearTimeout(opTypingTimer.current);
            clearTimeout(userTypingTimer.current);
            socket.disconnect();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [senderId]);

    // Self-heal a stale/zombie socket. A tab left open a long time can lose its
    // ping/pong (e.g. dropped by a firewall) and end up "connected" client-side
    // while the server no longer has it in any room — every operator_message
    // then lands in an empty room (members=0) and is silently lost. When the tab
    // regains focus/visibility, reconnect if needed and re-join the user room.
    useEffect(() => {
        const rejoin = () => {
            const s = socketRef.current;
            if (!s) return;
            if (!s.connected) { try { s.connect(); } catch { /* noop */ } }
            try { s.emit('join_user', { sender_id: senderId }); } catch { /* noop */ }
            // Pull anything that arrived while this tab was backgrounded/asleep.
            backfillOperatorMessages();
        };
        const onVisible = () => { if (document.visibilityState === 'visible') rejoin(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', rejoin);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', rejoin);
        };
    }, [senderId]);

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
            // Warn `warningMinutes` before timeout (clamped so it stays positive).
            const lead = Math.min(Math.max(warningMinutes, 1), timeoutMinutes - 1);
            const warningMs = (timeoutMinutes - lead) * 60 * 1000;

            if (idleMs >= timeoutMs) {
                clearInterval(inactivityIntervalRef.current);
                emitUserEndSession();
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
                        text: `⏰ **Still there?** You've been inactive for ${timeoutMinutes - lead} minute${timeoutMinutes - lead !== 1 ? 's' : ''}. Your session will end automatically in **${lead} minute${lead !== 1 ? 's' : ''}** if there's no activity.`,
                        type: 'warning',
                    }];
                });
            }
        }, 15000);

        return () => clearInterval(inactivityIntervalRef.current);
    }, [isOpen, timeoutMinutes, warningMinutes, emitUserEndSession]);

    // Scroll to bottom when chat opens (for history reload)
    useEffect(() => {
        if (isOpen) {
            // Use instant scroll on open so user sees latest messages immediately
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
            }, 100);
        }
    }, [isOpen]);

    // Fetch conversation history list from DB
    const fetchUserHistory = async (search = '') => {
        if (!authUser) return;
        setHistoryLoading(true);
        try {
            const params = new URLSearchParams({ user_name: authUser });
            if (search) params.set('search', search);
            const res  = await fetch(`${ADMIN_API_URL}/api/user/conversations?${params}`);
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

    // Local-only sign-out: tears down the widget's signed-in state (cookies,
    // session markers, messages) and drops back to guest. Does NOT call
    // iam.logout() — used by both the explicit Logout button (which then also
    // signs out of Keycloak) and the external-logout detector below (where IAM
    // has already ended the session elsewhere).
    const signOutLocal = ({ external = false } = {}) => {
        // End handoff under current senderId via both Socket.IO and REST
        emitUserEndSession();
        fetch(`${ADMIN_API_URL}/handoff/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender_id: senderId }),
        }).catch(() => {});
        setIsAuthenticated(false);
        setIsGuest(true);
        setShowProfile(false);
        sessionEndedRef.current = false;
        setSessionEnded(false);
        setAuthUser('');
        deleteCookie(getStorageKey(appId, 'isAuthenticated'));
        deleteCookie(getStorageKey(appId, 'authUser'));
        deleteCookie(getStorageKey(appId, 'glpiSessionToken'));
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        // New guest session; clear the signed-in session markers so a later
        // login is detected as a fresh session. We set our own welcome below.
        deleteCookie(getStorageKey(appId, 'sessionEpoch'));
        deleteCookie(getStorageKey(appId, 'sessionSid'));
        setSessionEpoch('');
        skipAutoClearRef.current = true;
        const freshId = uuidv4();
        setCookie(getStorageKey(appId, 'senderId'), freshId);
        setSenderId(freshId);
        setMessages([{ id: 'init', sender: 'bot', text: external
            ? `You've been signed out.\n\n📚 You can still search the Knowledge Base!\n🔑 Sign in anytime for full ticket features.`
            : `You've been signed out. Continuing as guest.\n\n📚 You can still search the Knowledge Base!\n🔑 Sign in anytime for full ticket features.` }]);
    };

    // Handle Logout - returns to guest mode
    const handleLogout = () => {
        signOutLocal({ external: false });
        // If authenticated via IAM, sign out of Keycloak too
        if (iamAuthenticated) {
            iam.logout({ redirectUri: window.location.href });
        }
    };

    // External-logout detector. The widget's signed-in state is restored from a
    // cookie and otherwise only changes on the explicit Logout button — so when
    // IAM ends the session elsewhere (logout in another tab / the IAM app, or a
    // revoked/expired SSO session) the widget would keep showing the user as
    // logged in. useIam() flips iam.isAuthenticated to false in that case (it
    // actively re-validates on focus/poll); here we mirror that into the
    // widget. Covers both the live case and a stale cookie restored on reload.
    const externalLogoutHandledRef = useRef(false);
    useEffect(() => {
        if (iam.isLoading) return;                 // wait for check-sso to settle
        if (iamAuthenticated) { externalLogoutHandledRef.current = false; return; }
        if (externalLogoutHandledRef.current) return;
        const cookieAuthed = getCookie(getStorageKey(appId, 'isAuthenticated')) === 'true';
        if (isAuthenticated || cookieAuthed) {
            externalLogoutHandledRef.current = true;
            signOutLocal({ external: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [iamAuthenticated, iam.isLoading, appId]);

    const handleEndSession = () => {
        emitUserEndSession();
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
        // End any active handoff under current senderId
        fetch(`${ADMIN_API_URL}/handoff/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sender_id: senderId }),
        }).catch(() => {});
        setHandoffState('bot_active');
        setOperatorName('');
        setQueuePosition(null);
        setWaitMins(null);
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;
        sessionEndedRef.current = false;
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        // New conversation = a brand-new session record. Signed-in: bump the
        // epoch (senderId effect recomputes iam-{sub}-{product}-{epoch}); guest:
        // a fresh UUID. We set our own welcome, so skip the auto-clear effect.
        skipAutoClearRef.current = true;
        if (iamAuthenticated) {
            const ep = newEpoch();
            setCookie(getStorageKey(appId, 'sessionEpoch'), ep);
            setSessionEpoch(ep);
        } else {
            deleteCookie(getStorageKey(appId, 'senderId'));
            const newId = uuidv4();
            setCookie(getStorageKey(appId, 'senderId'), newId);
            setSenderId(newId);
        }
        setSessionEnded(false);
        const welcomeMsg = isAuthenticated && authUser
            ? `**Hi ${authUser}!**\n\nWelcome back. How can I help you today?`
            : `**Hi, I'm ${title}** 👋\n\nI'm here to help you with:\n\n*   **Finding answers** in our knowledge base\n*   **Answering** general IT questions\n*   **Managing** your support tickets\n\n*Log in to unlock full ticket management features.*`;
        setMessages([{ id: 'init', sender: 'bot', text: welcomeMsg }]);
    };

    // ── Switch product → end current session everywhere, start a fresh one ────
    const switchProduct = (newPid) => {
        setShowUserMenu(false);
        if (!newPid || newPid === selectedProductId) return;
        // End the OLD product's session everywhere (bot + assigned operator).
        emitUserEndSession();
        fetch(`${ADMIN_API_URL}/handoff/end`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ sender_id: senderId }),
        }).catch(() => {});
        // Switch → the senderId effect recomputes to iam-{sub}-{newPid}-{epoch}:
        // a brand new session on both bot and operator. We set our own welcome,
        // so skip the auto-clear effect that the senderId change would trigger.
        skipAutoClearRef.current = true;
        setSelectedProductId(newPid);
        setCookie(getStorageKey(appId, 'selectedProduct'), newPid);
        // Reset the conversation UI for the new product.
        setHandoffState('bot_active');
        setOperatorName('');
        setQueuePosition(null);
        setWaitMins(null);
        sessionEndedRef.current = false;
        setSessionEnded(false);
        lastActivityRef.current = Date.now();
        localStorage.removeItem(getStorageKey(appId, 'messages'));
        setMessages([{ id: 'init', sender: 'bot',
            text: `**Switched to ${productLabel(newPid)}.**\n\nHow can I help you with ${productLabel(newPid)} today?` }]);
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
                        metadata: buildMetadata()
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
        // Block profanity — whole words only (\b…\b) so legitimate words that merely
        // contain these substrings (e.g. "hello" → "hell", "scrap" → "crap") are NOT flagged.
        const profanityRe = /\b(damn|hell|crap|stupid|idiot)\b/i;
        if (profanityRe.test(message)) {
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
                    metadata: buildMetadata()
                })
            });
            console.log(`Feedback ${feedbackType} sent for message ${messageId}`);
        } catch (error) {
            console.error('Error sending feedback:', error);
        }
    };

    // Submit session feedback after operator resolves
    const submitSessionFeedback = async () => {
        if (!feedbackRating) return;
        setFeedbackDone(true);
        try {
            await fetch(`${ADMIN_API_URL}/api/user/session/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sender_id: senderId,
                    rating:    feedbackRating,
                    comments:  feedbackComment.trim() || undefined,
                    app_id:    appId,
                    user_id:   authUser || undefined,
                    queue_id:  pendingFeedback?.queueId || undefined,
                }),
            });
        } catch (_) { /* non-fatal */ }
        setTimeout(() => setPendingFeedback(null), 2500);
    };

    const handleTicketFilterSubmit = (statusId) => {
        setShowTicketFilterPopup(false);
        // Include the chosen record limit so the action fetches only that many.
        const payload = `/list_tickets{"status_id": ${statusId}, "limit": ${filterLimit}}`;
        handleButtonClick(payload); // Recursive call but now it acts as manual send
    };

    // Handle button clicks from fallback suggestions
    const handleButtonClick = async (payload) => {
        // Block while queued
        if (handoffState === 'queued') return;
        // Stop typing emission
        emitUserTyping(false);
        clearTimeout(userTypingTimer.current);
        // Reset inactivity timer on user action
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        // Handle login button click
        if (payload === '__LOGIN__' || payload === '/trigger_login') {
            setShowLoginPrompt(true);
            return;
        }

        // Guest mode restrictions - require login for ticket operations
        const restrictedPayloads = ['/create_ticket', '/list_tickets', '/check_status', '/update_ticket', '/verify_resolution'];
        if (!isAuthenticated && restrictedPayloads.some(p => payload.startsWith(p))) {
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
        const msgType = payload.startsWith('/submit_ticket_form') ? 'ticket_summary' : undefined;
        const userMsg = { id: uuidv4(), sender: senderId, text: displayText, ...(msgType && { type: msgType }) };
        setMessages(prev => [...prev, userMsg]);
        setIsLoading(true);

        try {
            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    sender: senderId,
                    message: message,
                    metadata: buildMetadata()
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
                            ticket_form: msg.custom?.ticket_form,
                            ticketList: msg.custom?.ticket_list,
                            ticketDetail: msg.custom?.ticket_detail
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
                    } else if (msg.custom?.ticket_list && lastTextMessage) {
                        lastTextMessage.ticketList = msg.custom.ticket_list;
                    } else if (msg.custom?.ticket_list) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticketList: msg.custom.ticket_list
                        });
                    } else if (msg.custom?.ticket_detail && lastTextMessage) {
                        // Rasa splits text + json_message into two items; attach the
                        // detail to the preceding text bubble (which then renders the
                        // structured badges and suppresses its own markdown text).
                        lastTextMessage.ticketDetail = msg.custom.ticket_detail;
                    } else if (msg.custom?.ticket_detail) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticketDetail: msg.custom.ticket_detail
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

    // ── Offline queue (web) ───────────────────────────────────────────────────
    const { isOnline, enqueue: enqueueOffline } = useOfflineQueue(
        useCallback((text) => {
            setMessages(prev => [...prev, { id: uuidv4(), sender: senderId, text }]);
            return fetch(RASA_API_URL, {
                method: 'POST', headers: getAuthHeaders(),
                body: JSON.stringify({ sender: senderId, message: text,
                    metadata: buildMetadata() })
            }).then(r => r.json()).then(data => {
                if (data?.length) setMessages(prev => [...prev, ...data.filter(m => m.text).map(m => ({ id: uuidv4(), sender: 'bot', text: m.text, buttons: m.buttons }))]);
            });
        }, [senderId, appId, authUser, isAuthenticated, iamAuthenticated, iam.user])
    );

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!inputText.trim()) return;

        // Block while queued — user should wait
        if (handoffState === 'queued') return;

        // Offline — queue the message and show pending indicator
        if (!isOnline) {
            enqueueOffline(inputText.trim());
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: senderId, text: inputText,
                pending: true
            }]);
            setMessages(prev => [...prev, {
                id: uuidv4(), sender: 'bot',
                text: '📵 You appear to be offline. Your message has been queued and will be sent when your connection is restored.'
            }]);
            setInputText('');
            return;
        }

        // Stop typing emission before sending
        emitUserTyping(false);
        clearTimeout(userTypingTimer.current);

        // Reset inactivity timer on user action
        lastActivityRef.current = Date.now();
        warningShownRef.current = false;

        // Guard Rails: Validate input (skip during live human handoff)
        if (handoffState !== 'assigned') {
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
        }

        const userMsg = { id: uuidv4(), sender: senderId, text: inputText };
        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsLoading(true);

        try {
            const response = await fetch(RASA_API_URL, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    sender: senderId,
                    message: userMsg.text,
                    metadata: buildMetadata()
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
                            ticket_form: msg.custom?.ticket_form,
                            ticketList: msg.custom?.ticket_list,
                            ticketDetail: msg.custom?.ticket_detail
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
                    } else if (msg.custom?.ticket_list && lastTextMessage) {
                        lastTextMessage.ticketList = msg.custom.ticket_list;
                    } else if (msg.custom?.ticket_list) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticketList: msg.custom.ticket_list
                        });
                    } else if (msg.custom?.ticket_detail && lastTextMessage) {
                        // Rasa splits text + json_message into two items; attach the
                        // detail to the preceding text bubble (which then renders the
                        // structured badges and suppresses its own markdown text).
                        lastTextMessage.ticketDetail = msg.custom.ticket_detail;
                    } else if (msg.custom?.ticket_detail) {
                        processedMessages.push({
                            id: uuidv4(),
                            sender: 'bot',
                            text: '',
                            ticketDetail: msg.custom.ticket_detail
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
            } else if (handoffState !== 'assigned' && handoffState !== 'queued') {
                // Fallback only when bot is active — not during human handoff
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
                            backgroundColor: effectiveBg,
                            borderRadius: `${borderRadius}px`,
                            color: effectiveTx
                        }}
                    >
                        {/* Header — Gemini style: hamburger | title | avatar */}
                        <div
                            className="flex items-center justify-between px-2 py-3"
                            style={{ backgroundColor: c.bg, color: c.text, borderBottom: `1px solid ${c.borderLight}` }}
                        >
                            {/* Left: minimize + history toggle */}
                            <div className="flex items-center gap-0.5">
                                <button
                                    onClick={() => setIsOpen(false)}
                                    className="p-2 rounded-full transition-colors"
                                    style={{ color: c.textMuted }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = c.hover}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                    title="Close"
                                >
                                    <Minimize2 size={18} />
                                </button>
                                {isAuthenticated && !isGuest && (
                                    <button
                                        onClick={() => { if (historyView === 'chat') { fetchUserHistory(); setHistoryView('history'); } else { setHistoryView('chat'); setSelectedSession(null); } }}
                                        className="p-2 rounded-full transition-colors"
                                        style={{ color: historyView !== 'chat' ? '#3b82f6' : c.textMuted }}
                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = c.hover}
                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        title="Chat history"
                                    >
                                        <History size={18} />
                                    </button>
                                )}
                            </div>

                            {/* Center: title */}
                            <h1
                                className="font-normal tracking-wide"
                                style={{ fontSize: `${parseInt(headerFontSize) + 2}px`, color: c.text }}
                            >
                                {title}
                            </h1>

                            {/* Right: notification bell + avatar dropdown / login */}
                            <div className="flex items-center gap-1" ref={userMenuRef}>
                                {(isAuthenticated || iamAuthenticated) && (
                                    <NotificationBell
                                        userId={senderId}
                                        socket={socketRef.current}
                                        primaryColor={primaryColor}
                                        onUnreadChange={setWebUnreadCount}
                                    />
                                )}
                                {isAuthenticated && !isGuest ? (
                                    <div className="relative">
                                        <button
                                            onClick={() => { setShowUserMenu(v => !v); setShowProductDropdown(false); }}
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
                                                        onClick={() => { setShowUserMenu(false); setShowProfile(true); }}
                                                    >
                                                        My Profile
                                                    </button>
                                                    {/* Product switcher — collapsible dropdown; switching ends the current session and starts a new one */}
                                                    {productList.length > 0 && (
                                                        <div className="px-2 py-1" style={{ borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                                                            <button
                                                                onClick={() => setShowProductDropdown(v => !v)}
                                                                className="w-full text-left px-2 py-2 rounded-md text-sm flex items-center justify-between transition-colors"
                                                                style={{ color: '#4b5563' }}
                                                                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                                            >
                                                                <span className="flex flex-col">
                                                                    <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Product</span>
                                                                    <span style={{ color: '#111827' }}>{productLabel(selectedProductId) || 'Select product'}</span>
                                                                </span>
                                                                <ChevronDown size={16} style={{ color: '#9ca3af', transition: 'transform 0.15s', transform: showProductDropdown ? 'rotate(180deg)' : 'none' }} />
                                                            </button>
                                                            {showProductDropdown && (
                                                                <div className="flex flex-col gap-0.5 mt-0.5 mb-1 max-h-48 overflow-y-auto">
                                                                    {productList.map(pid => (
                                                                        <button
                                                                            key={pid}
                                                                            onClick={() => { setShowProductDropdown(false); switchProduct(pid); }}
                                                                            className="w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center justify-between transition-colors"
                                                                            style={{ color: pid === selectedProductId ? primaryColor : '#4b5563',
                                                                                     backgroundColor: pid === selectedProductId ? 'rgba(0,0,0,0.04)' : 'transparent' }}
                                                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.04)'}
                                                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = pid === selectedProductId ? 'rgba(0,0,0,0.04)' : 'transparent'}
                                                                        >
                                                                            <span>{productLabel(pid)}</span>
                                                                            {pid === selectedProductId && <span style={{ color: primaryColor }}>✓</span>}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
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
                                        className="p-1.5 rounded-full transition-colors"
                                        style={{ color: c.textMuted }}
                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = c.hover}
                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        title="Login"
                                    >
                                        <User size={18} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* ── Handoff status bar ─────────────────────────────────────────── */}
                        <AnimatePresence>
                            {handoffState === 'queued' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="bg-amber-50 border-b border-amber-200 px-4 py-2"
                                >
                                    <div className="flex items-center gap-2 text-amber-800 text-xs font-medium">
                                        <svg className="animate-spin w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                                        <span>
                                            Waiting for an agent
                                            {queuePosition != null && ` — position ${queuePosition} in queue`}
                                            {waitMins != null && ` · ~${waitMins} min`}
                                        </span>
                                    </div>
                                </motion.div>
                            )}
                            {handoffState === 'assigned' && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="bg-green-50 border-b border-green-200 px-4 py-2"
                                >
                                    <div className="flex items-center gap-2 text-green-800 text-xs font-medium">
                                        <span className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0"></span>
                                        Connected to <strong>{operatorName || 'an agent'}</strong>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* ── Product selector (IAM subscription-driven) ────────────────── */}
                        {/* When no product is chosen, we ask the user to pick one via a
                            dropdown and hide the chat input below until they do. */}
                        <AnimatePresence>
                            {productGateActive && productList.length > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    className="border-b px-4 py-3"
                                    style={{ borderColor: c.border, backgroundColor: c.surfaceAlt }}
                                >
                                    <p className="text-xs font-medium mb-2" style={{ color: c.textMuted }}>
                                        Please select a product first to start chatting.
                                    </p>
                                    <div className="relative">
                                        <select
                                            value=""
                                            onChange={e => { if (e.target.value) setSelectedProductId(e.target.value); }}
                                            className="w-full appearance-none rounded-lg text-sm font-medium px-3 py-2.5 pr-9 focus:outline-none focus:ring-2 cursor-pointer"
                                            style={{
                                                border: `1px solid ${primaryColor}`,
                                                color: c.text,
                                                backgroundColor: c.inputBg,
                                                '--tw-ring-color': `${primaryColor}80`,
                                            }}
                                        >
                                            <option value="" disabled>Select a product…</option>
                                            {productList.map(pid => (
                                                <option key={pid} value={pid}>{productLabel(pid)}</option>
                                            ))}
                                        </select>
                                        <ChevronDown
                                            size={18}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                                            style={{ color: primaryColor }}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* ── Timeout choice overlay ──────────────────────────────────────── */}
                        <AnimatePresence>
                            {timeoutChoice && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute bottom-20 left-4 right-4 z-50 bg-white border border-amber-200 rounded-xl shadow-xl p-4"
                                >
                                    <p className="text-sm text-gray-700 mb-3">{timeoutChoice.message}</p>
                                    <div className="flex gap-2">
                                        {(timeoutChoice.options || []).map((opt, i) => (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    setTimeoutChoice(null);
                                                    if (opt.value === 'remain') {
                                                        // User stays — nothing extra needed, server already knows
                                                    } else {
                                                        // Leave email — trigger leave_email intent via Rasa proxy
                                                        handleButtonClick('/cancel_handoff');
                                                    }
                                                }}
                                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                    i === 0
                                                        ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* ── Session feedback overlay (shown after operator resolves) ─── */}
                        <AnimatePresence>
                            {pendingFeedback && (
                                <motion.div
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 20 }}
                                    className="absolute bottom-20 left-3 right-3 z-50 bg-white border border-blue-200 rounded-xl shadow-xl p-4"
                                >
                                    {!feedbackDone ? (
                                        <>
                                            <p className="text-sm font-semibold text-gray-800 mb-0.5">How was your experience?</p>
                                            <p className="text-xs text-gray-400 mb-3">Rate your session with the agent</p>

                                            {/* Stars */}
                                            <div className="flex justify-center gap-1.5 mb-3">
                                                {[1,2,3,4,5].map(star => (
                                                    <button
                                                        key={star}
                                                        onClick={() => setFeedbackRating(star)}
                                                        onMouseEnter={() => setFeedbackHover(star)}
                                                        onMouseLeave={() => setFeedbackHover(0)}
                                                        className={`text-3xl transition-transform hover:scale-110 leading-none ${
                                                            (feedbackHover || feedbackRating) >= star
                                                                ? 'text-amber-400'
                                                                : 'text-gray-200'
                                                        }`}
                                                    >★</button>
                                                ))}
                                            </div>

                                            {/* Comment box — always visible */}
                                            <textarea
                                                rows={3}
                                                placeholder="Add a comment (optional)…"
                                                value={feedbackComment}
                                                onChange={e => setFeedbackComment(e.target.value)}
                                                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-300 text-gray-700 placeholder-gray-300 mb-3"
                                            />

                                            {/* Actions */}
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={submitSessionFeedback}
                                                    disabled={!feedbackRating}
                                                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                                                        feedbackRating
                                                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                            : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                                    }`}
                                                >Submit</button>
                                                <button
                                                    onClick={() => setPendingFeedback(null)}
                                                    className="px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-gray-600 border border-gray-200 hover:bg-gray-50"
                                                >Skip</button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-center py-2">
                                            <div className="text-3xl mb-1 text-amber-400">{'★'.repeat(feedbackRating)}{'☆'.repeat(5 - feedbackRating)}</div>
                                            <p className="text-sm font-semibold text-green-700">Thank you for your feedback!</p>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>

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

                                        <div className="px-4 pt-4 flex items-center justify-between gap-2">
                                            <label className="text-sm font-medium text-gray-700">No. of records</label>
                                            <select
                                                value={filterLimit}
                                                onChange={(e) => setFilterLimit(Number(e.target.value))}
                                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1"
                                                style={{ '--tw-ring-color': primaryColor }}
                                            >
                                                {[2, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
                                            </select>
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

                        {/* IAM Sign In Prompt */}
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
                                        className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden"
                                    >
                                        <div className="p-5 border-b border-gray-100 flex justify-between items-center" style={{ backgroundColor: primaryColor }}>
                                            <h3 className="font-semibold text-white text-base">Sign in to continue</h3>
                                            <button onClick={() => setShowLoginPrompt(false)} className="text-white/70 hover:text-white p-1">
                                                <XCircle size={20} />
                                            </button>
                                        </div>
                                        <div className="p-5 flex flex-col gap-3">
                                            <button
                                                onClick={() => { setShowLoginPrompt(false); handleIamLogin(); }}
                                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-white transition-all hover:opacity-90"
                                                style={{ backgroundColor: primaryColor }}
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                </svg>
                                                Sign in with IAM
                                            </button>
                                            <button onClick={() => setShowLoginPrompt(false)} className="text-xs text-gray-400 hover:text-gray-600 text-center">
                                                Continue as guest
                                            </button>
                                        </div>
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
                                    style={{ backgroundColor: c.bg }}
                                >
                                    {/* Panel header */}
                                    <div className="flex items-center gap-2 px-2 py-3" style={{ backgroundColor: c.bg, borderBottom: `1px solid ${c.borderLight}` }}>
                                        <button
                                            onClick={() => setHistoryView('chat')}
                                            className="p-2 rounded-full transition-colors"
                                            style={{ color: c.textMuted }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = c.hover}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <h2 className="font-normal text-base flex-1 text-center pr-8" style={{ color: c.text }}>Conversation History</h2>
                                    </div>
                                    {/* Search */}
                                    <div className="px-3 py-2" style={{ borderBottom: `1px solid ${c.borderLight}` }}>
                                        <input
                                            type="text"
                                            placeholder="Search conversations…"
                                            value={historySearch}
                                            onChange={e => {
                                                setHistorySearch(e.target.value);
                                                clearTimeout(window._hsTimer);
                                                window._hsTimer = setTimeout(() => fetchUserHistory(e.target.value), 350);
                                            }}
                                            className="w-full text-sm px-3 py-1.5 rounded-lg focus:outline-none"
                                            style={{ backgroundColor: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
                                        />
                                    </div>

                                    {/* Session list grouped by product then date */}
                                    <div className="flex-1 overflow-y-auto p-3 space-y-1" style={{ backgroundColor: c.surfaceAlt }}>
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
                                            const fmtDate = (iso) => {
                                                const d = new Date(iso);
                                                const today = new Date();
                                                const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                                                if (d.toDateString() === today.toDateString()) return 'Today';
                                                if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
                                                return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
                                            };
                                            const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                            const cleanPreview = (p) => {
                                                if (!p || p.startsWith('/')) return 'New conversation';
                                                return p.length > 55 ? p.slice(0, 55) + '…' : p;
                                            };
                                            const productLabels = { IT: 'IT Support', Accounting: 'Accounting', shipnest: 'ShipNest', greenloop: 'GreenLoop', accountwise: 'AccountWise', General: 'General' };
                                            const byProduct = sessions.reduce((acc, s) => {
                                                const pid = s.app_id || 'General';
                                                (acc[pid] = acc[pid] || []).push(s);
                                                return acc;
                                            }, {});
                                            return Object.entries(byProduct).map(([productId, productSessions]) => {
                                                const byDate = productSessions.reduce((acc, s) => {
                                                    const lbl = fmtDate(s.started_at);
                                                    (acc[lbl] = acc[lbl] || []).push(s);
                                                    return acc;
                                                }, {});
                                                return (
                                                    <div key={productId} className="mb-4">
                                                        <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
                                                            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">{productLabels[productId] || productId}</span>
                                                            <div className="flex-1 h-px bg-blue-100" />
                                                        </div>
                                                        {Object.entries(byDate).map(([dateLabel, group]) => (
                                                            <div key={dateLabel}>
                                                                <div className="text-xs font-medium text-gray-400 px-1 py-1">{dateLabel}</div>
                                                                {group.map(session => (
                                                                    <button
                                                                        key={session.sender_id}
                                                                        onClick={() => fetchSessionMessages(session)}
                                                                        disabled={sessionLoading}
                                                                        className="w-full text-left rounded-xl px-3 py-2.5 mb-1 shadow-sm transition-all disabled:opacity-50"
                                                                        style={{ backgroundColor: c.surface, border: `1px solid ${c.border}` }}
                                                                        onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
                                                                        onMouseLeave={e => e.currentTarget.style.borderColor = c.border}
                                                                    >
                                                                        <div className="text-xs mb-0.5" style={{ color: c.textSub }}>{fmtTime(session.started_at)}</div>
                                                                        <div className="text-sm leading-snug" style={{ color: c.text }}>{cleanPreview(session.preview)}</div>
                                                                        {session.rating && <div className="text-xs text-amber-500 mt-0.5">{'★'.repeat(session.rating)}</div>}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            });
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
                                    style={{ backgroundColor: c.bg }}
                                >
                                    {/* Panel header */}
                                    <div className="flex items-center gap-2 px-2 py-3" style={{ backgroundColor: c.bg, borderBottom: `1px solid ${c.borderLight}` }}>
                                        <button
                                            onClick={() => { setHistoryView('history'); setSelectedSession(null); }}
                                            className="p-2 rounded-full transition-colors"
                                            style={{ color: c.textMuted }}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = c.hover}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                            <ChevronLeft size={18} />
                                        </button>
                                        <h2 className="font-normal text-sm flex-1 truncate pr-2" style={{ color: c.textMuted }}>
                                            {new Date(selectedSession.started_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} · {new Date(selectedSession.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                        </h2>
                                    </div>
                                    {/* Messages read-only */}
                                    <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ fontSize: `${messageFontSize}px`, backgroundColor: c.bg }}>
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
                                    <div className="px-4 py-2.5 flex items-center justify-between text-xs" style={{ borderTop: `1px solid ${c.borderLight}`, backgroundColor: c.surfaceAlt, color: c.textMuted }}>
                                        <div className="flex items-center gap-1.5">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                            Read-only · {new Date(selectedSession.started_at).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}
                                        </div>
                                        <button
                                            onClick={() => {
                                                const msgs  = selectedSession.messages || [];
                                                const rows  = msgs.map(m => `<div style="background:${m.sender==='bot'?'#f3f4f6':'#dbeafe'};border-radius:8px;padding:8px 12px;margin:6px 0${m.sender!=='bot'?';text-align:right':''}"><strong style="font-size:11px;color:#6b7280">${m.sender==='bot'?'🤖 Bot':'👤 You'}</strong><p style="margin:4px 0">${(m.text||'').replace(/</g,'&lt;')}</p></div>`).join('');
                                                const w = window.open('', '_blank');
                                                w.document.write(`<html><head><title>Conversation Export</title><style>body{font-family:sans-serif;padding:20px;max-width:700px;margin:auto}@media print{button{display:none}}</style></head><body><h2>Conversation — ${new Date(selectedSession.started_at).toLocaleDateString()}</h2>${rows}<br><button onclick="window.print()">🖨️ Print / Save as PDF</button></body></html>`);
                                                w.document.close();
                                            }}
                                            className="text-blue-500 hover:text-blue-700 font-medium"
                                        >
                                            Export PDF
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Profile Panel */}
                        {showProfile && (
                            <ProfilePanel
                                authUser={authUser}
                                appId={appId}
                                primaryColor={primaryColor}
                                isDark={isDarkMode}
                                onToggleDark={toggleDark}
                                onClose={() => setShowProfile(false)}
                                onLogout={() => { setShowProfile(false); handleLogout(); }}
                            />
                        )}

                        {/* Sign In Screen */}
                        {!isAuthenticated && !isGuest ? (
                            <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4 overflow-y-auto" style={{ backgroundColor: c.bg }}>
                                <div
                                    className="w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl shadow-lg"
                                    style={{ backgroundColor: primaryColor }}
                                >
                                    🔐
                                </div>
                                <div className="text-center">
                                    <h2 className="text-lg font-semibold" style={{ color: c.text }}>Sign in to continue</h2>
                                    <p className="text-sm mt-1" style={{ color: c.textMuted }}>Access full support features with your account.</p>
                                </div>
                                <div className="w-full max-w-xs flex flex-col gap-3">
                                    <button
                                        onClick={handleIamLogin}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 px-5 rounded-xl font-semibold text-white shadow-md hover:opacity-90 transition-all"
                                        style={{ backgroundColor: primaryColor }}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                        </svg>
                                        Sign in with IAM
                                    </button>
                                </div>
                                <button onClick={() => setIsGuest(true)} className="text-xs transition-colors" style={{ color: c.textSub }}
                                    onMouseEnter={e => e.currentTarget.style.color = c.textMuted}
                                    onMouseLeave={e => e.currentTarget.style.color = c.textSub}
                                >
                                    Continue as guest (KB only)
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* Messages Area */}
                                {isWelcomeState ? (
                                    /* Welcome state — Gemini style */
                                    <div className="flex-1 overflow-y-auto p-5" style={{ backgroundColor: c.welcomeBg }}>
                                        {/* Greeting row: name on the left, active product pill on the far right. */}
                                        <div className="mb-1 flex items-center justify-between gap-2">
                                            <div className="text-2xl font-normal" style={{ color: c.text }}>
                                                Hi {isAuthenticated && authUser ? authUser : 'there'}
                                            </div>
                                            {isAuthenticated && selectedProductId && (
                                                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0"
                                                     style={{ backgroundColor: `${primaryColor}15`, color: primaryColor, border: `1px solid ${primaryColor}40` }}>
                                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primaryColor }} />
                                                    {productLabel(selectedProductId)}
                                                </div>
                                            )}
                                        </div>
                                        <div className="mb-5 text-2xl font-semibold" style={{ color: c.text }}>
                                            Where should we start?
                                        </div>
                                        {/* Hide the quick-action chips until a product is selected,
                                            so the user can't bypass the product gate. */}
                                        {!productGateActive && (
                                            <div className="flex flex-wrap gap-2">
                                                {(isAuthenticated ? [
                                                    { label: '📝 Create Ticket', payload: '/create_ticket' },
                                                    { label: '📋 My Tickets', payload: '/list_tickets' },
                                                    { label: '🔍 Check Status', payload: '/check_status' },
                                                    { label: '❓ Get Help', payload: '/help' },
                                                ] : [
                                                    { label: '🔑 Login', payload: '/login' },
                                                    { label: '📚 Search Knowledge Base', payload: '/ask_knowledge' },
                                                ]).map((action, idx) => (
                                                    <button
                                                        key={idx}
                                                        onClick={() => handleButtonClick(action.payload)}
                                                        className="px-4 py-2 rounded-full shadow-sm hover:shadow-md text-sm font-normal transition-shadow whitespace-nowrap"
                                                        style={{ backgroundColor: c.surface, color: c.text, border: `1px solid ${c.border}` }}
                                                    >
                                                        {action.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ fontSize: `${messageFontSize}px`, backgroundColor: c.bg }}>
                                        {messages.map((msg, idx) => (
                                            <MessageBubble
                                                key={msg.id}
                                                message={msg}
                                                onButtonClick={handleButtonClick}
                                                onFeedback={handleFeedback}
                                                themeColor={primaryColor}
                                                isDark={isDarkMode}
                                                botIcon={botIcon}
                                                botIconColor={botIconColor}
                                                userIcon={userIcon}
                                                userIconColor={userIconColor}
                                                buttonFontSize={buttonFontSize}
                                                ticketPrefill={msg.ticket_form ? prefillFromMessages(messages.slice(0, idx)) : {}}
                                                sessionToken={getCookie(getStorageKey(appId, 'glpiSessionToken')) || undefined}
                                            />
                                        ))}
                                        {isLoading && handoffState === 'bot_active' && (
                                            <div className="flex items-center space-x-2 text-gray-400 text-sm ml-2">
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                            </div>
                                        )}
                                        {operatorTyping && handoffState === 'assigned' && (
                                            <div className="flex items-center gap-2 text-green-700 text-xs ml-2">
                                                <span className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center text-green-600 font-bold text-xs flex-shrink-0">
                                                    {operatorName ? operatorName[0].toUpperCase() : 'A'}
                                                </span>
                                                <span className="flex items-center gap-0.5">
                                                    {operatorName || 'Agent'} is typing
                                                    <span className="flex gap-0.5 ml-1">
                                                        {[0, 1, 2].map(i => (
                                                            <span key={i} className="w-1 h-1 bg-green-500 rounded-full animate-bounce"
                                                                style={{ animationDelay: `${i * 0.15}s` }} />
                                                        ))}
                                                    </span>
                                                </span>
                                            </div>
                                        )}
                                        <div ref={messagesEndRef} />
                                    </div>
                                )}

                                {/* Quick Actions - authenticated users only, hidden during handoff */}
                                {isAuthenticated && !isWelcomeState && !sessionEnded && handoffState === 'bot_active' && (
                                    <div className="px-3 py-1.5 flex gap-1.5" style={{ borderTop: `1px solid ${c.borderLight}`, backgroundColor: c.bg }}>
                                        {[
                                            { label: 'Create Ticket', payload: '/create_ticket' },
                                            { label: 'List Tickets', payload: '/list_tickets' },
                                            { label: 'Check Status', payload: '/check_status' },
                                            { label: 'Help', payload: '/help' }
                                        ].map((action, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handleButtonClick(action.payload)}
                                                className="flex-1 py-1 rounded-full transition-colors text-center"
                                                style={{ fontSize: '11px', backgroundColor: 'transparent', border: `1px solid ${c.border}`, color: c.textMuted }}
                                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = c.hover; e.currentTarget.style.color = c.text; }}
                                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = c.textMuted; }}
                                            >
                                                {action.label}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => handleButtonClick('/request_human_agent')}
                                            className="flex-1 py-1 border rounded-full transition-colors text-center font-medium"
                                            style={{ fontSize: '11px', backgroundColor: `${primaryColor}15`, borderColor: `${primaryColor}50`, color: primaryColor }}
                                        >
                                            👤 Talk to Human
                                        </button>
                                    </div>
                                )}

                                {/* Input Area or New Conversation */}
                                {sessionEnded ? (
                                    <div
                                        className="p-4 flex justify-center"
                                        style={{ backgroundColor: c.bg, borderTop: `1px solid ${c.borderLight}` }}
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
                                ) : productGateActive ? null : (
                                    <form
                                        onSubmit={handleSendMessage}
                                        className="p-4 flex items-center gap-2"
                                        style={{ backgroundColor: isWelcomeState ? c.welcomeBg : c.bg, borderTop: `1px solid ${c.borderLight}` }}
                                    >
                                        <div className="flex-1 flex items-center rounded-full px-4 py-2 focus-within:ring-2 transition-all shadow-sm"
                                            style={{ backgroundColor: c.inputBg, border: `1px solid ${c.border}`, '--tw-ring-color': `${primaryColor}80` }}>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                className="hidden"
                                                onChange={handleFileSelect}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handoffState === 'bot_active' && !productGateActive && fileInputRef.current?.click()}
                                                disabled={handoffState !== 'bot_active' || productGateActive}
                                                className="transition-colors mr-2 disabled:opacity-30 disabled:cursor-not-allowed"
                                                style={{ color: c.textMuted }}
                                                onMouseEnter={(e) => handoffState === 'bot_active' && !productGateActive && (e.target.style.color = primaryColor)}
                                                onMouseLeave={(e) => e.target.style.color = c.textMuted}
                                                title={handoffState === 'bot_active' ? 'Attach File' : 'Unavailable during handoff'}
                                            >
                                                <Paperclip size={20} />
                                            </button>
                                            <input
                                                type="text"
                                                value={inputText}
                                                onChange={(e) => { setInputText(e.target.value); handleInputTyping(); }}
                                                placeholder={productGateActive ? 'Select a product above to start…' : handoffState === 'assigned' ? 'Reply to agent…' : `Message ${selectedProductId ? productLabel(selectedProductId) : title}…`}
                                                disabled={handoffState === 'queued' || productGateActive}
                                                className="flex-1 bg-transparent focus:outline-none font-light py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                                style={{ fontSize: `${inputFontSize}px`, color: c.text }}
                                            />
                                            <button
                                                type="submit"
                                                disabled={!inputText.trim() || isLoading || handoffState === 'queued' || productGateActive}
                                                className="text-gray-400 hover:text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-2"
                                                onMouseEnter={(e) => !e.target.disabled && (e.target.style.color = primaryColor)}
                                                onMouseLeave={(e) => !e.target.disabled && (e.target.style.color = '#9ca3af')}
                                            >
                                                <Send size={20} />
                                            </button>
                                            {/* Voice input — Web Speech API (Chrome/Edge/Safari) */}
                                            {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                                                <div className="relative">
                                                    <button
                                                        type="button"
                                                        onClick={startVoice}
                                                        className={`transition-colors ml-1 ${isListening ? 'text-red-500 animate-pulse' : 'text-gray-400 hover:text-gray-600'}`}
                                                        title={isListening ? 'Stop listening' : 'Speak'}
                                                    >
                                                        {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                                                    </button>
                                                    {voiceError && (
                                                        <div
                                                            className="absolute bottom-8 right-0 z-50 rounded-lg px-3 py-2 text-xs text-white shadow-lg whitespace-nowrap"
                                                            style={{ backgroundColor: '#ef4444', maxWidth: 260 }}
                                                        >
                                                            {voiceError}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
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
                <div
                    onClick={() => setIsOpen(true)}
                    className="cursor-pointer"
                    style={{ display: 'block' }}
                >
                    <AnimatedChatIcon size={64} themeColor={primaryColor} />
                </div>
            )}
        </div >
    );
};

export default ChatWindow;
