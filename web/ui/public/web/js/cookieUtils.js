/**
 * Cookie utility helpers for admin dashboard (plain JS, non-module).
 * Used for admin session auth data.
 */

const CookieUtils = {
    /**
     * Get a cookie value by name.
     * @param {string} name - Cookie name
     * @returns {string|null} Cookie value or null
     */
    get(name) {
        const cookies = document.cookie.split('; ');
        for (const cookie of cookies) {
            const [key, ...valueParts] = cookie.split('=');
            if (key === name) {
                return decodeURIComponent(valueParts.join('='));
            }
        }
        return null;
    },

    /**
     * Set a cookie.
     * @param {string} name - Cookie name
     * @param {string} value - Cookie value
     * @param {object} [options] - Options: path, sameSite, maxAge, secure, session
     */
    set(name, value, options = {}) {
        const opts = Object.assign({
            path: '/',
            sameSite: 'Lax',
        }, options);

        let cookieStr = name + '=' + encodeURIComponent(value);
        cookieStr += '; path=' + opts.path;
        cookieStr += '; SameSite=' + opts.sameSite;

        // Session cookies: no max-age (expire when browser closes)
        if (!opts.session && opts.maxAge) {
            cookieStr += '; max-age=' + opts.maxAge;
        }

        if (opts.secure || window.location.protocol === 'https:') {
            cookieStr += '; Secure';
        }

        document.cookie = cookieStr;
    },

    /**
     * Delete a cookie by name.
     * @param {string} name - Cookie name
     * @param {string} [path='/'] - Cookie path
     */
    delete(name, path) {
        path = path || '/';
        document.cookie = name + '=; path=' + path + '; max-age=0';
    }
};
