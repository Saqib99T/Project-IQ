import AsyncStorage from '@react-native-async-storage/async-storage';

// Auto-detect environment: localhost for web browser, production URL for mobile/other
const getDefaultApiUrl = () => {
    if (typeof window !== 'undefined' && window.location) {
        // Running in browser
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:5005';
        }
    }
    // Default to production for mobile and other environments
    return 'http://198.233.100.77:5005';
};

const DEFAULT_API_URL = getDefaultApiUrl();
const WEBHOOK_PATH = '/webhooks/rest/webhook';
const DEFAULT_APP_ID = 'IT';
const APP_TITLE = 'Project IQ Bot';

export const THEME = {
    primary: '#3b82f6', // Project IQ Blue
    secondary: '#eff6ff', // Light Blue background
    background: '#ffffff',
    userBubble: '#f0f4f9',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    success: '#10b981',
    error: '#ef4444',
};

export const APP_ID_OPTIONS = [
    { label: 'IT', value: 'IT' },
    { label: 'Accounting', value: 'Accounting' },
];

export const getApiUrl = async () => {
    // Unconditionally return the exact validated URL to prevent 
    // any stored schema typos from crashing React Native fetch.
    return DEFAULT_API_URL;
};

export const setApiUrl = async (url) => {
    await AsyncStorage.setItem('rasa_api_url', url);
};

export const getAppId = async () => {
    try {
        const id = await AsyncStorage.getItem('app_id');
        return id || DEFAULT_APP_ID;
    } catch {
        return DEFAULT_APP_ID;
    }
};

export const setAppId = async (id) => {
    await AsyncStorage.setItem('app_id', id);
};

export const getWebhookUrl = async () => {
    const base = await getApiUrl();
    return `${base}${WEBHOOK_PATH}`;
};

// Auto-detect admin API base URL (for history, feedback, etc.)
export const getAdminBaseUrl = async () => {
    try {
        // Check cached value first
        const cached = await AsyncStorage.getItem('admin_api_base');
        if (cached) return cached;
    } catch (e) {
        console.error('Error reading admin_api_base cache:', e);
    }

    // Auto-detect the admin base
    const adminBase = await detectAdminBase();

    // Cache it for future use
    try {
        await AsyncStorage.setItem('admin_api_base', adminBase);
    } catch (e) {
        console.error('Error caching admin_api_base:', e);
    }

    return adminBase;
};

const detectAdminBase = async () => {
    // Web browser detection
    if (typeof window !== 'undefined' && window.location) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return 'http://localhost:8181';
        }
    }

    // Mobile: try localhost first with timeout
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch('http://localhost:8181/admin/config/SESSION_TIMEOUT_MINUTES', {
            method: 'GET',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            console.log('Detected local admin API at localhost:8181');
            return 'http://localhost:8181';
        }
    } catch (e) {
        // localhost not available, fall back to production
    }

    console.log('Defaulting to production admin API');
    return 'http://198.233.100.77:8181';
};

export { WEBHOOK_PATH, APP_TITLE };
