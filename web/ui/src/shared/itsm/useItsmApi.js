import { useCallback, useEffect, useState } from 'react'
import { useIam } from '../../widget/hooks/useIam'
import { useItsmTenant } from './ItsmTenantContext'

/**
 * Talks to itsm-service through the same-origin proxy at /itsm-api/*
 * (see web/api/blueprints/bp_itsm_proxy.py — forwards to itsm-service /api/v1/*).
 *
 * Tenant users: the backend resolves their tenant from the JWT — no extra work here.
 * Platform users (super_admin): pass `tenantId` to scope calls to one tenant via
 * the X-Tenant-ID header, exactly like the platform-tier auth in itsm-service expects.
 *
 * When no explicit `tenantId` argument is given, falls back to whatever
 * ItsmTenantProvider/TenantSwitcher currently has selected — so pages nested
 * under a tenant-aware layout get X-Tenant-ID "for free" via plain useItsmApi().
 * Pass `null` explicitly to force the cross-tenant view regardless of context.
 */
export function useItsmApi(explicitTenantId) {
    const { kc } = useIam()
    const { tenantId: contextTenantId } = useItsmTenant()
    const tenantId = explicitTenantId !== undefined ? explicitTenantId : contextTenantId

    const call = useCallback(async (path, options = {}) => {
        const token = kc?.token
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
            ...(options.headers || {}),
        }
        const resp = await fetch(`/itsm-api${path}`, { ...options, headers })
        if (!resp.ok) {
            const body = await resp.json().catch(() => ({ error: resp.statusText }))
            // itsm-service errors come back as { error: { code, message } };
            // the proxy's own errors as { error: "<string>" }.
            const errBody = body.error
            const message = (errBody && typeof errBody === 'object')
                ? (errBody.message || errBody.code)
                : (errBody || body.detail)
            const err = new Error(message || `HTTP ${resp.status}`)
            err.status = resp.status
            err.code = (errBody && typeof errBody === 'object') ? errBody.code : undefined
            throw err
        }
        if (resp.status === 204) return null
        return resp.json()
    }, [kc, tenantId])

    const get    = useCallback((path, params, options) => call(withQuery(path, params), options), [call])
    const post   = useCallback((path, body)   => call(path, { method: 'POST',  body: JSON.stringify(body) }), [call])
    const put    = useCallback((path, body)   => call(path, { method: 'PUT',   body: JSON.stringify(body) }), [call])
    const patch  = useCallback((path, body)   => call(path, { method: 'PATCH', body: JSON.stringify(body) }), [call])
    const remove = useCallback((path)         => call(path, { method: 'DELETE' }), [call])

    return { call, get, post, put, patch, remove }
}

/**
 * Loads the platform tenant directory (id -> display name) so cross-tenant
 * "All tenants" views can render a Tenant column/badge per row.
 *
 * Tenant-tier users get a 403 from /platform/tenants — swallowed, returns {}.
 * Only fetches when `enabled` (callers pass `tenantId === null`, i.e. the
 * cross-tenant view is actually showing).
 */
export function useTenantDirectory(enabled) {
    const { get } = useItsmApi()
    const [byId, setById] = useState({})

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        get('/platform/tenants', { page_size: 200 })
            .then(data => {
                if (cancelled) return
                const tenants = data.tenants || data.items || []
                setById(Object.fromEntries(tenants.map(t => [t.id, t.name || t.alias || t.id])))
            })
            .catch(() => { /* tenant-tier user — no directory available */ })
        return () => { cancelled = true }
    }, [get, enabled])

    return byId
}

/**
 * Best-effort user directory (id -> display name) for resolving requester /
 * assignee UUIDs into human names on detail pages. Backed by GET /tenant/users
 * (manager/admin only) — agents/end-users get a 403 which is swallowed, leaving
 * an empty map so callers gracefully fall back to showing the raw id.
 */
export function useUserDirectory() {
    const { get } = useItsmApi()
    const [byId, setById] = useState({})

    useEffect(() => {
        let cancelled = false
        get('/tenant/users', { limit: 200 })
            .then(data => {
                if (cancelled) return
                const users = data?.items || data?.users || []
                setById(Object.fromEntries(users.map(u => {
                    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || u.id
                    return [u.id, name]
                })))
            })
            .catch(() => { /* not permitted for this role — fall back to ids */ })
        return () => { cancelled = true }
    }, [get])

    return byId
}

/**
 * itsm-service has no flat "list all KB articles" endpoint — articles live
 * under spaces (GET /kb/spaces/{slug}/articles) or are found via full-text/
 * semantic search (GET /kb/search?q=...). This normalises both into a flat
 * article list for the KB browser page.
 */
export async function loadKbArticles(get, search, filters = {}) {
    const { status, visibility } = filters
    if (search && search.trim()) {
        const results = await get('/kb/search', { q: search.trim(), limit: 20 })
        let articles = results.map(r => r.article)
        if (status)     articles = articles.filter(a => a.status === status)
        if (visibility) articles = articles.filter(a => a.visibility === visibility)
        return { articles }
    }
    const spaces = await get('/kb/spaces')
    if (!spaces.length) return { articles: [] }
    const space = spaces[0]
    // Space slugs are unique per-tenant (not globally) — in the cross-tenant
    // "All tenants" view (no X-Tenant-ID sent), force the lookup to the
    // space's own tenant so it resolves instead of matching a global-only space.
    const headers = space.tenant_id ? { 'X-Tenant-ID': space.tenant_id } : undefined
    const page = await get(`/kb/spaces/${space.slug}/articles`, {
        ...(status ? { status } : {}),
        ...(visibility ? { visibility } : {}),
    }, { headers })
    return { articles: (page.items || []).map(a => ({ ...a, _spaceTenantId: space.tenant_id, _spaceName: space.name })) }
}

/**
 * Uploads a file directly to a presigned storage URL (S3-style PUT).
 * Used after POST /tickets/{id}/attachments returns { upload_url }.
 */
export async function uploadToPresignedUrl(uploadUrl, file) {
    const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
    })
    if (!resp.ok) throw new Error(`Upload failed: HTTP ${resp.status}`)
}

function withQuery(path, params) {
    if (!params) return path
    const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString()
    return qs ? `${path}?${qs}` : path
}

/**
 * Generic async-list loader: { data, loading, error, reload }.
 * Keeps pages thin — they just describe *what* to fetch.
 */
export function useItsmResource(loader, deps = []) {
    const [state, setState] = useState({ data: null, loading: true, error: null })
    const [tick, setTick] = useState(0)
    const reload = useCallback(() => setTick(t => t + 1), [])

    useEffect(() => {
        let cancelled = false
        setState(s => ({ ...s, loading: true, error: null }))
        loader()
            .then(data => { if (!cancelled) setState({ data, loading: false, error: null }) })
            .catch(error => { if (!cancelled) setState({ data: null, loading: false, error }) })
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, tick])

    return { ...state, reload }
}
