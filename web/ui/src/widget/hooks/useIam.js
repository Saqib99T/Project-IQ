/**
 * useIam — Keycloak-js singleton hook for the Project IQ chat widget.
 *
 * Drop-in compatible with @99technologies-ai/iam-react's useIam() interface.
 * When that package becomes available, replace this file with:
 *   export { useIam, useUser, useRoles } from '@99technologies-ai/iam-react'
 *
 * Reads config from window.__IAM_CONFIG__ injected by the embedding page, or
 * falls back to VITE_ env vars for dev mode.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import Keycloak from 'keycloak-js';

// Singleton — only one Keycloak instance per page
let _kc = null;
let _initPromise = null;

function getKcConfig() {
    // Embedding page can inject: window.__IAM_CONFIG__ = { url, realm, clientId }
    if (window.__IAM_CONFIG__) return window.__IAM_CONFIG__;
    return {
        url:      import.meta.env.VITE_KEYCLOAK_URL  || 'https://id.dev.iam.99technologies.com',
        realm:    import.meta.env.VITE_REALM         || '99-iam',
        clientId: import.meta.env.VITE_CLIENT_ID     || 'project-iq',
    };
}

function getOrCreateKc() {
    if (!_kc) {
        _kc = new Keycloak(getKcConfig());
    }
    return _kc;
}

/** Normalise Keycloak token claims into a flat user object. */
function parseUser(kc) {
    if (!kc?.authenticated || !kc.tokenParsed) return null;
    const t = kc.tokenParsed;
    const resourceAccess = t.resource_access || {};
    const config = getKcConfig();
    const clientRoles = resourceAccess[config.clientId]?.roles || [];
    const apps = t.apps || Object.keys(resourceAccess).filter(
        k => !['account', 'account-console', 'broker'].includes(k) &&
             resourceAccess[k]?.roles?.length > 0
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
}

/**
 * Primary hook — call once at the app root level.
 * Returns { isAuthenticated, isGuest, isLoading, user, token, login, logout, kc }
 */
export function useIam() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading]             = useState(true);
    const [user, setUser]                       = useState(null);
    const [token, setToken]                     = useState(null);
    const refreshTimer = useRef(null);

    const scheduleRefresh = useCallback((kc) => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        const exp = kc.tokenParsed?.exp;
        if (!exp) return;
        // Refresh 2 min before expiry
        const msUntilRefresh = Math.max(0, (exp - 120) * 1000 - Date.now());
        refreshTimer.current = setTimeout(async () => {
            try {
                const refreshed = await kc.updateToken(130);
                if (refreshed) {
                    setToken(kc.token);
                    scheduleRefresh(kc);
                }
            } catch {
                kc.login();
            }
        }, msUntilRefresh);
    }, []);

    useEffect(() => {
        const kc = getOrCreateKc();

        if (!_initPromise) {
            _initPromise = kc.init({
                onLoad:           'check-sso',
                silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
                pkceMethod:       'S256',
                checkLoginIframe: false,
            });
        }

        _initPromise
            .then((authenticated) => {
                if (authenticated) {
                    setIsAuthenticated(true);
                    setUser(parseUser(kc));
                    setToken(kc.token);
                    scheduleRefresh(kc);
                }
            })
            .catch((err) => {
                console.warn('[IAM] init error', err);
            })
            .finally(() => setIsLoading(false));

        kc.onAuthRefreshSuccess = () => {
            setToken(kc.token);
            setUser(parseUser(kc));
            scheduleRefresh(kc);
        };
        kc.onAuthLogout = () => {
            setIsAuthenticated(false);
            setUser(null);
            setToken(null);
        };

        return () => {
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
        };
    }, [scheduleRefresh]);

    const login = useCallback((opts = {}) => {
        getOrCreateKc().login(opts);
    }, []);

    const logout = useCallback((opts = {}) => {
        getOrCreateKc().logout(opts);
    }, []);

    return {
        isAuthenticated,
        isGuest:   !isAuthenticated,
        isLoading,
        user,
        token,
        login,
        logout,
        kc: _kc,
    };
}

/** Convenience hook — returns the user object or null. */
export function useUser() {
    const { user } = useIam();
    return user;
}

/** Convenience hook — returns the array of realm roles. */
export function useRoles() {
    const { user } = useIam();
    return user?.realm_roles || [];
}

/** Convenience hook — returns array of app client IDs user has a role in. */
export function useApps() {
    const { user } = useIam();
    return user?.apps || [];
}
