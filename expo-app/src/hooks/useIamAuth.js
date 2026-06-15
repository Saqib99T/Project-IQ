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
            scopes:       ['openid', 'profile', 'email'],
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

    // Proactive token refresh
    const scheduleRefresh = useCallback((accessToken, refreshToken) => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        const exp = tokenExpiry(accessToken);
        if (!exp) return;
        const msUntilRefresh = Math.max(5000, exp - Date.now() - 120_000); // 2 min before exp
        refreshTimer.current = setTimeout(async () => {
            if (!refreshToken) return;
            try {
                const result = await AuthSession.refreshAsync(
                    { clientId, refreshToken },
                    discovery
                );
                await applyTokens(result.accessToken, result.refreshToken || refreshToken);
            } catch {
                // Refresh failed — clear auth state
                await logout();
            }
        }, msUntilRefresh);
    }, [clientId, discovery]); // eslint-disable-line

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
                        // Token expired — try refresh
                        try {
                            const result = await AuthSession.refreshAsync(
                                { clientId, refreshToken: storedRefresh },
                                discovery
                            );
                            await applyTokens(result.accessToken, result.refreshToken || storedRefresh);
                        } catch {
                            // Refresh failed — treat as guest
                            await clearStoredTokens();
                        }
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

    const clearStoredTokens = async () => {
        await SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {});
        await SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {});
        await SecureStore.deleteItemAsync(KEY_USER).catch(() => {});
    };

    const login = useCallback(async () => {
        if (request) await promptAsync();
    }, [request, promptAsync]);

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
        logout,
        requestReady: !!request,
    };
}
