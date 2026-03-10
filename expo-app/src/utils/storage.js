import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'glpi-chat-';

const key = (appId, name) => `${PREFIX}${appId}-${name}`;

export const storage = {
    // Auth/session data
    getItem: async (appId, name) => {
        try {
            return await AsyncStorage.getItem(key(appId, name));
        } catch { return null; }
    },

    setItem: async (appId, name, value) => {
        try {
            await AsyncStorage.setItem(key(appId, name), String(value));
        } catch { /* ignore */ }
    },

    removeItem: async (appId, name) => {
        try {
            await AsyncStorage.removeItem(key(appId, name));
        } catch { /* ignore */ }
    },

    // Messages (JSON serialized)
    getMessages: async (appId) => {
        try {
            const raw = await AsyncStorage.getItem(key(appId, 'messages'));
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { /* ignore */ }
        return null;
    },

    setMessages: async (appId, messages) => {
        try {
            await AsyncStorage.setItem(key(appId, 'messages'), JSON.stringify(messages));
        } catch { /* ignore */ }
    },

    clearMessages: async (appId) => {
        try {
            await AsyncStorage.removeItem(key(appId, 'messages'));
        } catch { /* ignore */ }
    },
};
