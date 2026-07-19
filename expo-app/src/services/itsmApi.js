import { getApiUrl } from '../config';

/**
 * Thin REST client for itsm-service, reused for the read-mostly RCA/Recording
 * screens (specs/08 mobile parity). Goes through the same same-origin proxy
 * the web app uses (bp_itsm_proxy.py forwards /itsm-api/* -> itsm-service
 * /api/v1/*), authenticated with the mobile app's own Keycloak bearer token
 * — the proxy only forwards Authorization/X-Tenant-ID, it doesn't care
 * whether the caller is the web app or this app.
 *
 * `getToken` must be a function returning a fresh (non-expired) access token
 * — pass `useIamAuth().getFreshToken`, never the raw `token` field, so a call
 * made right before expiry doesn't silently 401.
 */
export function createItsmApi(getToken) {
    async function call(path, options = {}) {
        const base = await getApiUrl();
        const token = await getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        };
        const resp = await fetch(`${base}/itsm-api${path}`, { ...options, headers });
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ error: resp.statusText }));
            const errBody = body.error;
            const message = (errBody && typeof errBody === 'object')
                ? (errBody.message || errBody.code)
                : (errBody || body.detail);
            const err = new Error(message || `HTTP ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        if (resp.status === 204) return null;
        return resp.json();
    }

    const get = (path, params) => call(withQuery(path, params));
    const post = (path, body) => call(path, { method: 'POST', body: JSON.stringify(body || {}) });
    const patch = (path, body) => call(path, { method: 'PATCH', body: JSON.stringify(body || {}) });

    return { get, post, patch };
}

function withQuery(path, params) {
    if (!params) return path;
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return qs ? `${path}?${qs}` : path;
}
