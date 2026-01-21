/**
 * Admin Authentication Module
 * Handles login/logout and session management for admin dashboard
 */

const AdminAuth = {
    API_BASE: '/admin',
    SESSION_KEY: 'admin_session_token',
    USER_KEY: 'admin_user',

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!sessionStorage.getItem(this.SESSION_KEY);
    },

    /**
     * Get stored session token
     */
    getSessionToken() {
        return sessionStorage.getItem(this.SESSION_KEY);
    },

    /**
     * Get stored user info
     */
    getUser() {
        const userStr = sessionStorage.getItem(this.USER_KEY);
        return userStr ? JSON.parse(userStr) : null;
    },

    /**
     * Login with username and password
     */
    async login(username, password) {
        try {
            const response = await fetch(`${this.API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem(this.SESSION_KEY, data.session_token);
                sessionStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
                return { success: true, user: data.user };
            } else {
                return { success: false, error: data.error || 'Authentication failed' };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Connection error. Please try again.' };
        }
    },

    /**
     * Logout and clear session
     */
    async logout() {
        try {
            const token = this.getSessionToken();
            if (token) {
                await fetch(`${this.API_BASE}/logout`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-Session-Token': token
                    },
                    body: JSON.stringify({ session_token: token })
                });
            }
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            sessionStorage.removeItem(this.SESSION_KEY);
            sessionStorage.removeItem(this.USER_KEY);
            this.showLoginOverlay();
        }
    },

    /**
     * Verify existing session on page load
     */
    async verifySession() {
        const token = this.getSessionToken();
        if (!token) {
            return false;
        }

        try {
            const response = await fetch(`${this.API_BASE}/verify`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Session-Token': token
                },
                body: JSON.stringify({ session_token: token })
            });

            const data = await response.json();
            if (data.valid) {
                sessionStorage.setItem(this.USER_KEY, JSON.stringify(data.user));
                return true;
            }
        } catch (error) {
            console.error('Session verify error:', error);
        }

        // Session invalid - clear and show login
        sessionStorage.removeItem(this.SESSION_KEY);
        sessionStorage.removeItem(this.USER_KEY);
        return false;
    },

    /**
     * Show login overlay
     */
    showLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        const content = document.getElementById('main-content');
        if (overlay) overlay.classList.remove('hidden');
        if (content) content.classList.add('hidden');
    },

    /**
     * Hide login overlay and show content
     */
    hideLoginOverlay() {
        const overlay = document.getElementById('login-overlay');
        const content = document.getElementById('main-content');
        if (overlay) overlay.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        
        // Update user display
        const user = this.getUser();
        const userDisplay = document.getElementById('user-display');
        if (userDisplay && user) {
            userDisplay.textContent = user.firstname || user.name || 'Admin';
        }
    },

    /**
     * Initialize auth - call on page load
     */
    async init() {
        const isValid = await this.verifySession();
        if (isValid) {
            this.hideLoginOverlay();
        } else {
            this.showLoginOverlay();
        }
    }
};

// Login form handler
function handleLoginSubmit(event) {
    event.preventDefault();
    
    const username = document.getElementById('admin-username').value;
    const password = document.getElementById('admin-password').value;
    const errorDiv = document.getElementById('login-error');
    const submitBtn = document.getElementById('login-submit');
    
    if (!username || !password) {
        errorDiv.textContent = 'Please enter both username and password';
        errorDiv.classList.remove('hidden');
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    errorDiv.classList.add('hidden');
    
    AdminAuth.login(username, password).then(result => {
        if (result.success) {
            AdminAuth.hideLoginOverlay();
            // Reload analytics data
            if (typeof loadAnalyticsData === 'function') {
                loadAnalyticsData();
            }
        } else {
            errorDiv.textContent = result.error;
            errorDiv.classList.remove('hidden');
        }
    }).finally(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
    });
}

// Logout handler
function handleLogout() {
    AdminAuth.logout();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    AdminAuth.init();
});
