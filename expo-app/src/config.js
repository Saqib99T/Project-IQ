import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_URL = 'http://198.233.100.77:8181';

export const IAM_CONFIG = {
    keycloakUrl: 'https://id.dev.iam.99technologies.com',
    realm:       '99-iam',
    clientId:    'project-iq',
};
const WEBHOOK_PATH = '/webhooks/rest/webhook';
const DEFAULT_APP_ID = 'IT';
const APP_TITLE = 'Project IQ Bot';

export const THEME = {
    primary: '#3b82f6',
    secondary: '#eff6ff',
    background: '#ffffff',
    userBubble: '#f0f4f9',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    success: '#10b981',
    error: '#ef4444',
};

export const THEME_DARK = {
    primary: '#60a5fa',
    secondary: '#1e3a5f',
    background: '#111827',
    userBubble: '#1f2937',
    text: '#f9fafb',
    textSecondary: '#9ca3af',
    border: '#374151',
    success: '#34d399',
    error: '#f87171',
};

export const APP_ID_OPTIONS = [
    { label: 'IT', value: 'IT' },
    { label: 'Accounting', value: 'Accounting' },
];

export const getApiUrl = async () => {
    try {
        const stored = await AsyncStorage.getItem('rasa_api_url');
        if (stored && stored.startsWith('http')) {
            // Migrate: old installs may have port 5005 (direct Rasa) saved.
            // All traffic must go through the admin proxy on 8181 for handoff interception.
            const migrated = stored.replace(/:5005\b/, ':8181');
            if (migrated !== stored) {
                await AsyncStorage.setItem('rasa_api_url', migrated);
            }
            return migrated;
        }
    } catch {}
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

// Admin base URL — same as API URL since all traffic now routes through 8181
export const getAdminBaseUrl = async () => getApiUrl();

export { WEBHOOK_PATH, APP_TITLE };
