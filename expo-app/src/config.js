import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_URL = 'http://198.233.100.77:5005';
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

export { WEBHOOK_PATH, APP_TITLE };
