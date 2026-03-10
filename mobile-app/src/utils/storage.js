/**
 * Storage utilities for mobile app.
 * Replaces cookie-based storage from the web widget with Capacitor Preferences
 * for auth data, and localStorage for large data (messages).
 *
 * In browser (dev), falls back gracefully to localStorage.
 * On native (Capacitor), uses native Preferences API.
 */

import { Preferences } from '@capacitor/preferences';

// Detect if running in Capacitor native context
const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

/**
 * Get a persisted value by key.
 */
export async function getItem(key) {
    if (isNative) {
        try {
            const { value } = await Preferences.get({ key });
            return value;
        } catch {
            return localStorage.getItem(key);
        }
    }
    return localStorage.getItem(key);
}

/**
 * Set a persisted value.
 */
export async function setItem(key, value) {
    if (isNative) {
        try {
            await Preferences.set({ key, value: String(value) });
            return;
        } catch { /* fall through */ }
    }
    localStorage.setItem(key, value);
}

/**
 * Remove a persisted value.
 */
export async function removeItem(key) {
    if (isNative) {
        try {
            await Preferences.remove({ key });
            return;
        } catch { /* fall through */ }
    }
    localStorage.removeItem(key);
}

/**
 * Get a value synchronously from localStorage (for messages/large data).
 * Messages stay in localStorage even on mobile since they can be large.
 */
export function getLocalItem(key) {
    return localStorage.getItem(key);
}

export function setLocalItem(key, value) {
    localStorage.setItem(key, value);
}

export function removeLocalItem(key) {
    localStorage.removeItem(key);
}
