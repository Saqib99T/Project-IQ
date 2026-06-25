/**
 * useIamAuth — Keycloak PKCE OAuth hook for Expo / React Native.
 *
 * Implements the Authorization Code + PKCE flow against Keycloak.
 * Tokens are stored in expo-secure-store (encrypted on-device).
 *
 * Returns:
 *   { isAuthenticated, isGuest, isLoading, user, token, login, logout }
 *
 * user shape (matches web useIam.js):
 *   { sub, username, email, name, apps, realm_roles, is_super_admin, is_operator, ... }
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';

WebBrowser.maybeCompleteAuthSession();

// Keys for SecureStore
const KEY_ACCESS  = 'iam_access_token';
const KEY_REFRESH = 'iam_refresh_token';
const KEY_USER    = 'iam_user';

function getDiscovery(keycloakUrl, realm) {
    const base = `${keycloakUrl}/realms/${realm}/protocol/openid-connect`;
    return {
        authorizationEndpoint: `${base}/auth`,
        tokenEndpoint:         `${base}/token`,
        revocationEndpoint:    `${base}/logout`,
    };
}

function parseUser(tokenPayload, clientId = 'project-iq') {
    if (!tokenPayload) return null;
    try {
        const t = typeof tokenPayload === 'string'
            ? JSON.parse(atob(tokenPayload.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
            : tokenPayload;
        const resourceAccess = t.resource_access || {};
        const clientRoles = resourceAccess[clientId]?.roles || [];
        const products = Array.isArray(t.products) ? t.products : [];
        const _subRaw = t.subscriptions;
        const subscriptions = Array.isArray(_subRaw)
            ? _subRaw.map(s => {
                if (typeof s === 'string') return s;
                if (s && (s.status === undefined || String(s.status).toLowerCase() === 'active')) {
                    return s.app || s.name || s.applicationName || s.appName || null;
                }
                return null;
            }).filter(Boolean)
            : [];
        const _SYS_CLIENTS = ['account', 'account-console', 'broker', 'realm-management', 'security-admin-console'];
        const apps = t.apps || Object.keys(resourceAccess).filter(
            k => !_SYS_CLIENTS.includes(k) && resourceAccess[k]?.roles?.length > 0
        );
        const _orgRaw = t.organization;
        const org = Array.isArray(_orgRaw) ? (_orgRaw[0] || {}) : (_orgRaw || {});
        const realmRoles = t.realm_access?.roles || [];
        return {
            sub:             t.sub,
            username:        t.preferred_username || '',
            email:           t.email || '',
            name:            t.name || `${t.given_name || ''} ${t.family_name || ''}`.trim(),
            given_name:      t.given_name || '',
            family_name:     t.family_name || '',
            apps,
            products,
            subscriptions,
            realm_roles:     realmRoles,
            client_roles:    clientRoles,
            // Project IQ client roles
            is_admin:        clientRoles.includes('Admin'),
            is_operator:     clientRoles.includes('Operator'),
            is_member:       clientRoles.includes('Member'),
            // Realm roles
            is_super_admin:  realmRoles.includes('super_admin'),
            is_org_admin:    realmRoles.includes('org_admin'),
            organization_id:    org.id    || '',
            organization_alias: org.alias || '',
        };
    } catch {
        return null;
    }
}

function tokenExpiry(accessToken) {
    try {
        const payload = JSON.parse(
            atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
        );
        return (payload.exp || 0) * 1000; // ms
    } catch {
        return 0;
    }
}

export function useIamAuth(iamConfig) {
    const {
        keycloakUrl = 'http://localhost:8081',
        realm       = '99-iam',
        clientId    = 'project-iq',
    } = iamConfig || {};

    const [isLoading, setIsLoading]         = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser]                   = useState(null);
    const [token, setToken]                 = useState(null);
    const refreshTimer                      = useRef(null);

    const discovery = getDiscovery(keycloakUrl, realm);
    // makeRedirectUri returns exp://... in Expo Go, projectiq://callback in production builds
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'projectiq', path: 'callback', native: 'projectiq://callback' });

    const [request, response, promptAsync] = AuthSession.useAuthRequest(
        {
            clientId,
            redirectUri,
            responseType: AuthSession.ResponseType.Code,
            // offline_access → a long-lived (offline) refresh token so the user
            // stays logged in across app restarts and after the chat session ends,
            // until they explicitly sign out.
            scopes:       ['openid', 'profile', 'email', 'offline_access'],
            usePKCE:      true,
        },
        discovery
    );

    // Store tokens and derive user
    const applyTokens = useCallback(async (accessToken, refreshToken) => {
        const parsedUser = parseUser(accessToken, clientId);
        await SecureStore.setItemAsync(KEY_ACCESS,  accessToken);
        if (refreshToken) await SecureStore.setItemAsync(KEY_REFRESH, refreshToken);
        if (parsedUser)   await SecureStore.setItemAsync(KEY_USER, JSON.stringify(parsedUser));
        setToken(accessToken);
        setUser(parsedUser);
        setIsAuthenticated(!!parsedUser);
        scheduleRefresh(accessToken, refreshToken);
    }, []); // eslint-disable-line

    // Exchange auth code for tokens
    useEffect(() => {
        if (response?.type === 'success' && request?.codeVerifier) {
            const { code } = response.params;
            AuthSession.exchangeCodeAsync(
                { clientId, redirectUri, code, extraParams: { code_verifier: request.codeVerifier } },
                discovery
            ).then(result => {
                applyTokens(result.accessToken, result.refreshToken);
            }).catch(err => {
                console.warn('[IAM] token exchange error', err);
            });
        }
    }, [response]); // eslint-disable-line

    // Refresh the access token using the stored (offline_access) refresh token.
    // Returns true on success. CRITICAL: never sign the user out on a transient
    // or network error — the session must survive flaky connectivity and only
    // ends when the refresh token itself is rejected (invalid_grant) or the user
    // explicitly signs out. This is what keeps the user logged in indefinitely.
    const refreshSession = useCallback(async () => {
        const rt = await SecureStore.getItemAsync(KEY_REFRESH).catch(() => null);
        if (!rt) return false;
        try {
            const result = await AuthSession.refreshAsync({ clientId, refreshToken: rt }, discovery);
            await applyTokens(result.accessToken, result.refreshToken || rt);
            return result.accessToken;   // return the fresh token for immediate use
        } catch (e) {
            const msg = String(e?.message || e?.error || e || '').toLowerCase();
            if (msg.includes('invalid_grant') || msg.includes('invalid_token') || msg.includes('invalid_refresh')) {
                // Refresh token genuinely revoked/expired — only now is re-login required.
                await logout();
            }
            // Otherwise keep the user signed in; the next tick / foreground retries.
            return false;
        }
    }, [clientId, discovery, applyTokens]); // eslint-disable-line

    // Proactive token refresh — re-arms on success (via applyTokens); on a
    // transient failure it retries in 60s instead of logging the user out.
    const scheduleRefresh = useCallback((accessToken /* refreshToken unused: read live */) => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        const exp = tokenExpiry(accessToken);
        if (!exp) return;
        const msUntilRefresh = Math.max(5000, exp - Date.now() - 120_000); // 2 min before exp
        refreshTimer.current = setTimeout(async () => {
            const ok = await refreshSession();
            if (!ok) {
                refreshTimer.current = setTimeout(() => refreshSession(), 60_000);
            }
        }, msUntilRefresh);
    }, [refreshSession]); // eslint-disable-line

    // Return a guaranteed-valid access token, refreshing first if the current one
    // is missing or within 60s of expiry. Callers use this right before an
    // authenticated request so a call never goes out with a stale token (the
    // self-healing safety net on top of the scheduled / foreground refreshes).
    const getFreshToken = useCallback(async () => {
        const current = token;
        if (current) {
            const exp = tokenExpiry(current);
            if (exp && exp > Date.now() + 60_000) return current; // still good
        }
        const refreshed = await refreshSession();   // new token string, or false
        return refreshed || current || null;
    }, [token, refreshSession]); // eslint-disable-line

    // Restore session on mount
    useEffect(() => {
        (async () => {
            try {
                const storedToken = await SecureStore.getItemAsync(KEY_ACCESS);
                const storedRefresh = await SecureStore.getItemAsync(KEY_REFRESH);
                const storedUser = await SecureStore.getItemAsync(KEY_USER);
                if (storedToken && storedUser) {
                    const exp = tokenExpiry(storedToken);
                    if (exp > Date.now() + 30_000) {
                        // Token still valid
                        setToken(storedToken);
                        setUser(JSON.parse(storedUser));
                        setIsAuthenticated(true);
                        scheduleRefresh(storedToken, storedRefresh);
                    } else if (storedRefresh) {
                        // Access token expired — refresh it. refreshSession keeps the
                        // stored tokens on a transient failure (only invalid_grant signs
                        // out) and we retry shortly, so a flaky cold start still recovers
                        // instead of dropping the user to guest.
                        const ok = await refreshSession();
                        if (!ok) setTimeout(() => { refreshSession(); }, 30_000);
                    }
                }
            } catch (e) {
                console.warn('[IAM] restore session error', e);
            } finally {
                setIsLoading(false);
            }
        })();

        return () => {
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
        };
    }, []); // eslint-disable-line

    // Keep the session alive across backgrounding AND detect an external logout.
    // JS timers are paused/throttled while backgrounded, so the scheduled refresh
    // may never fire. On every return to the foreground we force a refresh-token
    // exchange (throttled) — this both re-arms the session and surfaces a
    // server-side revoke: refreshSession() logs out on invalid_grant, so a logout
    // on another device / the IAM app reflects promptly instead of lingering
    // until the access token expires. It's a no-op for guests (no stored refresh
    // token), and a *successful* refresh keeps the user signed in indefinitely
    // while the offline_access refresh token stays valid.
    const lastFgCheckRef = useRef(0);
    useEffect(() => {
        const sub = AppState.addEventListener('change', (state) => {
            if (state !== 'active') return;
            const now = Date.now();
            if (now - lastFgCheckRef.current < 30_000) return; // throttle rapid app-switching
            lastFgCheckRef.current = now;
            refreshSession();
        });
        return () => sub.remove();
    }, [refreshSession]); // eslint-disable-line

    const clearStoredTokens = async () => {
        await SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {});
        await SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {});
        await SecureStore.deleteItemAsync(KEY_USER).catch(() => {});
    };

    const login = useCallback(async () => {
        if (request) await promptAsync();
    }, [request, promptAsync]);

    // In-app login (no browser): Keycloak Direct Access Grants (password grant).
    // Requires the `project-iq` client to have "Direct Access Grants Enabled".
    // The password is collected by the native form and sent straight to the token
    // endpoint — never persisted; only the returned tokens are stored (encrypted).
    const loginWithPassword = useCallback(async (username, password) => {
        const body = new URLSearchParams({
            grant_type: 'password',
            client_id:  clientId,
            username,
            password,
            scope:      'openid profile email offline_access',
        }).toString();
        const resp = await fetch(discovery.tokenEndpoint, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        let data = {};
        try { data = await resp.json(); } catch { /* non-JSON error */ }
        if (!resp.ok || !data.access_token) {
            const msg = data.error_description || data.error
                || (resp.status === 401 ? 'Invalid username or password' : `Login failed (${resp.status})`);
            throw new Error(msg);
        }
        await applyTokens(data.access_token, data.refresh_token);
        return true;
    }, [clientId, discovery, applyTokens]);

    const logout = useCallback(async () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        const storedToken = await SecureStore.getItemAsync(KEY_ACCESS).catch(() => null);
        await clearStoredTokens();
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
        // Revoke session in Keycloak (optional, fire-and-forget)
        if (storedToken) {
            AuthSession.revokeAsync(
                { token: storedToken, clientId },
                { revocationEndpoint: discovery.revocationEndpoint }
            ).catch(() => {});
        }
    }, [clientId, discovery]);

    return {
        isAuthenticated,
        isGuest: !isAuthenticated,
        isLoading,
        user,
        token,
        login,
        loginWithPassword,
        logout,
        refreshSession,
        getFreshToken,
        requestReady: !!request,
    };
}
