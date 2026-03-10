/**
 * App Configuration
 * API URL can be overridden via Settings screen (persisted in storage)
 */

import { getItem, setItem } from './utils/storage';

// Default API URL - change this to your Rasa server's LAN IP for mobile testing
const DEFAULT_API_URL = 'http://192.168.1.100:5005';

export const getApiUrl = async () => {
    const stored = await getItem('rasa_api_url');
    return stored || DEFAULT_API_URL;
};

export const setApiUrl = async (url) => {
    await setItem('rasa_api_url', url);
};

export const WEBHOOK_PATH = '/webhooks/rest/webhook';
