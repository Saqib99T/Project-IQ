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
let _productsSynced = false;  // guard: sync IAM→itsm products once per page load

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
    const _SYS_CLIENTS = ['account', 'account-console', 'broker', 'realm-management', 'security-admin-console'];
    const apps = t.apps || Object.keys(resourceAccess).filter(
        k => !_SYS_CLIENTS.includes(k) && resourceAccess[k]?.roles?.length > 0
    );
    // Subscribed/active products of the user's tenant (authoritative source for
    // the chatbot's product picker). `apps` = client roles and is only a fallback.
    const products = Array.isArray(t.products) ? t.products : [];
    // Active subscribed apps emitted on the token by IAM (see /v1/organization/
    // {org}/subscription). May be a string array of app names, or objects with
    // {app|name|applicationName, status} — keep only active and normalise to name.
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
    const _orgRaw = t.organization;
    const org = Array.isArray(_orgRaw) ? (_orgRaw[0] || {}) : (_orgRaw || {});
    const realmRoles = t.realm_access?.roles || [];
    return {
        sub:             t.sub,
        // Keycloak SSO session id — changes on a fresh login, stable across
        // reloads (silent SSO restores the same session). Used by the widget to
        // start a NEW chat session/record on each login.
        sid:             t.sid || t.session_state || '',
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
        is_user:         clientRoles.includes('User'),
        is_bot:          clientRoles.includes('Bot'),
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

    // Flip the widget to a clean logged-out (guest) state. Used both when the
    // user logs out here and when we detect an *external* IAM logout (below).
    const applyLoggedOut = useCallback((kc) => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        try { kc?.clearToken(); } catch { /* ignore */ }
        setIsAuthenticated(false);
        setUser(null);
        setToken(null);
    }, []);

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
                // Refresh-token exchange failed → the SSO session is gone
                // (logged out / revoked / expired). Don't hijack the host page
                // with kc.login(); just show the logged-out widget UI.
                applyLoggedOut(kc);
            }
        }, msUntilRefresh);
    }, [applyLoggedOut]);

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
                console.info('[IAM] check-sso result: authenticated =', authenticated,
                             '| token present =', !!kc.token);
                if (authenticated) {
                    setIsAuthenticated(true);
                    setUser(parseUser(kc));
                    setToken(kc.token);
                    scheduleRefresh(kc);
                    // On login, project the org's IAM-subscribed products into
                    // itsm-service (once per page load, fire-and-forget — never
                    // block the auth flow). See /api/sync-products.
                    if (!_productsSynced) {
                        _productsSynced = true;
                        fetch('/api/sync-products', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${kc.token}`, 'Content-Type': 'application/json' },
                        }).catch(() => {});
                    }
                }
            })
            .catch((err) => {
                // Surfaces the real cause of a login loop: code-exchange/CORS
                // failure, redirect_uri not registered on the Keycloak client, etc.
                console.error('[IAM] init/login-callback error — check Keycloak client '
                    + 'redirect URIs & web origins for this origin', err);
            })
            .finally(() => setIsLoading(false));

        kc.onAuthRefreshSuccess = () => {
            setToken(kc.token);
            setUser(parseUser(kc));
            scheduleRefresh(kc);
        };
        kc.onAuthLogout = () => applyLoggedOut(kc);

        // ── External-logout detection ──────────────────────────────────────
        // This widget is embedded cross-origin, so Keycloak's login-status
        // iframe is disabled (checkLoginIframe: false — it needs third-party
        // cookies the browser blocks). That means an IAM logout in another tab
        // is NOT pushed to us, and the widget keeps showing the user as logged
        // in on its still-valid access token. So we actively re-validate the
        // SSO session: whenever the tab regains focus/visibility (and on a slow
        // poll), force a refresh-token exchange. If IAM ended the session the
        // exchange fails and we flip to logged-out. A large minValidity forces
        // a real server round-trip every call (not a no-op on a still-valid
        // access token), which is what surfaces the revoked session.
        let validating = false;
        const validateSession = async () => {
            if (validating || !kc.authenticated) return;
            validating = true;
            try {
                await kc.updateToken(Number.MAX_SAFE_INTEGER);
                // onAuthRefreshSuccess already updated token/user state.
            } catch {
                applyLoggedOut(kc);
            } finally {
                validating = false;
            }
        };
        const onVisible = () => { if (document.visibilityState === 'visible') validateSession(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', validateSession);
        const sessionPoll = setInterval(validateSession, 60000);

        return () => {
            if (refreshTimer.current) clearTimeout(refreshTimer.current);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', validateSession);
            clearInterval(sessionPoll);
        };
    }, [scheduleRefresh, applyLoggedOut]);

    const login = useCallback(async (opts = {}) => {
        const kc = getOrCreateKc();
        // keycloak-js needs init() to have loaded the OIDC endpoints before
        // login() can build the auth URL — otherwise the click silently no-ops.
        try { if (_initPromise) await _initPromise; } catch (e) { console.warn('[IAM] init not ready before login', e); }
        try {
            await kc.login({ redirectUri: window.location.href, ...opts });
        } catch (e) {
            // Most common causes: Keycloak unreachable / CORS, or the current
            // origin is not in the client's Valid Redirect URIs / Web Origins.
            console.error('[IAM] login failed — check Keycloak reachability and client redirect URIs/web origins', e);
        }
    }, []);

    const logout = useCallback(async (opts = {}) => {
        const kc = getOrCreateKc();
        try { if (_initPromise) await _initPromise; } catch { /* ignore */ }
        try { await kc.logout(opts); } catch (e) { console.error('[IAM] logout failed', e); }
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
