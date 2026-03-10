import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_API_URL = 'http://192.168.71.36:5005';
const WEBHOOK_PATH = '/webhooks/rest/webhook';
const DEFAULT_APP_ID = 'IT';

export const APP_ID_OPTIONS = [
    { label: 'IT', value: 'IT' },
    { label: 'Accounting', value: 'Accounting' },
];

export const getApiUrl = async () => {
    try {
        const url = await AsyncStorage.getItem('rasa_api_url');
        return url || DEFAULT_API_URL;
    } catch {
        return DEFAULT_API_URL;
    }
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

export { WEBHOOK_PATH };
