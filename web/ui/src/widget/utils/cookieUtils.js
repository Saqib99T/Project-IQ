/**
 * Cookie utility helpers for the chat widget.
 * Used for auth/session data — small values that benefit from cookie security features.
 * Large data (messages, feedback) should stay in localStorage.
 */

const DEFAULT_OPTIONS = {
    path: '/',
    sameSite: 'Lax',
    maxAge: 30 * 24 * 60 * 60, // 30 days
};

/**
 * Get a cookie value by name.
 * @param {string} name - Cookie name
 * @returns {string|null} Cookie value or null if not found
 */
export function getCookie(name) {
    const cookies = document.cookie.split('; ');
    for (const cookie of cookies) {
        const [key, ...valueParts] = cookie.split('=');
        if (key === name) {
            return decodeURIComponent(valueParts.join('='));
        }
    }
    return null;
}

/**
 * Set a cookie.
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {object} [options] - Override default options (path, sameSite, maxAge, secure, session)
 *   - session: if true, omits max-age so cookie expires when browser closes
 */
export function setCookie(name, value, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    let cookieStr = `${name}=${encodeURIComponent(value)}`;

    cookieStr += `; path=${opts.path}`;
    cookieStr += `; SameSite=${opts.sameSite}`;

    // Only add max-age for persistent cookies (not session cookies)
    if (!opts.session && opts.maxAge) {
        cookieStr += `; max-age=${opts.maxAge}`;
    }

    // Add Secure flag on HTTPS
    if (opts.secure || window.location.protocol === 'https:') {
        cookieStr += '; Secure';
    }

    document.cookie = cookieStr;
}

/**
 * Delete a cookie by name.
 * @param {string} name - Cookie name
 * @param {string} [path='/'] - Cookie path (must match the path used when setting)
 */
export function deleteCookie(name, path = '/') {
    document.cookie = `${name}=; path=${path}; max-age=0`;
}
