import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIam } from '../../widget/hooks/useIam'
import { useItsmTenant } from './ItsmTenantContext'

export type TenantId = string | null | undefined
export type QueryParams = Record<string, string | number | boolean | undefined | null>

export interface ApiError extends Error {
    status?: number
    code?: string
}

export interface ItsmApi {
    call: <T = unknown>(path: string, options?: RequestInit) => Promise<T>
    get: <T = unknown>(path: string, params?: QueryParams | null, options?: RequestInit) => Promise<T>
    post: <T = unknown>(path: string, body?: unknown) => Promise<T>
    put: <T = unknown>(path: string, body?: unknown) => Promise<T>
    patch: <T = unknown>(path: string, body?: unknown) => Promise<T>
    remove: <T = unknown>(path: string) => Promise<T>
}

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
// Module-level (not per-hook-instance) guard: useItsmApi() is called from many
// components at once, and a real token expiry can make several of them 401 in
// the same tick. Without this, each would independently call kc.login() and
// race to redirect the page.
let _reauthing = false

export function useItsmApi(explicitTenantId?: TenantId): ItsmApi {
    const { kc, login } = useIam()
    const { tenantId: contextTenantId } = useItsmTenant()
    const tenantId = explicitTenantId !== undefined ? explicitTenantId : contextTenantId

    const call = useCallback(async <T = unknown>(path: string, options: RequestInit = {}): Promise<T> => {
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
            // 401 means the Keycloak session backing this tab is gone (expired
            // refresh token, revoked session, etc.) — no retry or error banner
            // will fix that. Send the user through login instead of surfacing
            // the raw backend string ("Authorization token is required"),
            // which reads like a broken app rather than an expired session.
            if (resp.status === 401) {
                if (!_reauthing) {
                    _reauthing = true
                    login({ redirectUri: window.location.href })
                }
                const err: ApiError = new Error('Your session has expired — redirecting you to log in again…')
                err.status = 401
                throw err
            }
            const err: ApiError = new Error(message || `HTTP ${resp.status}`)
            err.status = resp.status
            err.code = (errBody && typeof errBody === 'object') ? errBody.code : undefined
            throw err
        }
        if (resp.status === 204) return null as T
        return resp.json()
    }, [kc, login, tenantId])

    const get    = useCallback(<T = unknown>(path: string, params?: QueryParams | null, options?: RequestInit) =>
        call<T>(withQuery(path, params), options), [call])
    const post   = useCallback(<T = unknown>(path: string, body?: unknown) =>
        call<T>(path, { method: 'POST',  body: JSON.stringify(body) }), [call])
    const put    = useCallback(<T = unknown>(path: string, body?: unknown) =>
        call<T>(path, { method: 'PUT',   body: JSON.stringify(body) }), [call])
    const patch  = useCallback(<T = unknown>(path: string, body?: unknown) =>
        call<T>(path, { method: 'PATCH', body: JSON.stringify(body) }), [call])
    const remove = useCallback(<T = unknown>(path: string) => call<T>(path, { method: 'DELETE' }), [call])

    // Memoized so callers can safely depend on the returned object itself
    // (e.g. `useEffect(..., [itsm])`) without it changing identity — and
    // therefore re-firing — on every render. Without this, a plain object
    // literal here is a NEW reference every render even though call/get/etc
    // are individually stable, which turns any effect keyed on it into an
    // infinite fetch loop (each fetch's setState triggers a re-render, which
    // creates a new object, which re-fires the effect).
    return useMemo(() => ({ call, get, post, put, patch, remove }),
        [call, get, post, put, patch, remove])
}

/**
 * Loads the platform tenant directory (id -> display name) so cross-tenant
 * "All tenants" views can render a Tenant column/badge per row.
 *
 * Tenant-tier users get a 403 from /platform/tenants — swallowed, returns {}.
 * Only fetches when `enabled` (callers pass `tenantId === null`, i.e. the
 * cross-tenant view is actually showing).
 */
export type NameById = Record<string, string>

interface TenantEntry {
    id: string
    name?: string
    alias?: string
}
interface TenantListResponse {
    tenants?: TenantEntry[]
    items?: TenantEntry[]
}

export function useTenantDirectory(enabled: boolean): NameById {
    const { get } = useItsmApi()
    const [byId, setById] = useState<NameById>({})

    useEffect(() => {
        if (!enabled) return
        let cancelled = false
        get<TenantListResponse>('/platform/tenants', { page_size: 200 })
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
 *
 * Pass the entity's own tenant_id (e.g. `useUserDirectory(incident?.tenant_id)`)
 * when rendering inside a platform user's cross-tenant "All tenants" view —
 * without it, this inherits the ambient (null) tenant context and 403s outright
 * rather than degrading to raw ids, since /tenant/users has no cross-tenant mode.
 *
 * `skip` (e.g. `{ skip: !incident }`) suppresses the fetch entirely until the
 * caller actually has a tenantId to pass — otherwise a cross-tenant caller
 * fires one request that's guaranteed to 403 (no tenant known yet) before the
 * follow-up with the real tenantId, which is just console noise to a degree
 * worth avoiding rather than "harmless but ugly".
 */
interface UserEntry {
    id: string
    first_name?: string
    last_name?: string
    email?: string
}
interface UserListResponse {
    items?: UserEntry[]
    users?: UserEntry[]
    next_cursor?: string
}

export function useUserDirectory(tenantId?: TenantId, { skip = false }: { skip?: boolean } = {}): NameById {
    const { get } = useItsmApi(tenantId)
    const [byId, setById] = useState<NameById>({})

    useEffect(() => {
        if (skip) return
        let cancelled = false
        // GET /tenant/users caps `limit` at 100 server-side (422 above that) —
        // page through with `cursor` instead of requesting one big batch, so
        // tenants with over 100 people still resolve every name. Bounded to 20
        // pages (2000 users) as a sane backstop against ever looping forever.
        const loadAll = async (): Promise<NameById> => {
            const acc: NameById = {}
            let cursor: string | undefined
            for (let page = 0; page < 20; page++) {
                const data = await get<UserListResponse>('/tenant/users', { limit: 100, cursor })
                const users = data?.items || data?.users || []
                for (const u of users) {
                    const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || u.id
                    acc[u.id] = name
                }
                cursor = data?.next_cursor
                if (!cursor || users.length === 0) break
            }
            return acc
        }
        loadAll()
            .then(acc => { if (!cancelled) setById(acc) })
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
export interface KbArticle {
    id: string
    status?: string
    visibility?: string
    _spaceTenantId?: string
    _spaceName?: string
    [key: string]: unknown
}
interface KbSpace {
    slug: string
    name?: string
    tenant_id?: string
}
interface KbSearchResult { article: KbArticle }
interface KbArticlesResponse { items?: KbArticle[]; total?: number }
export interface KbArticleFilters { status?: string; visibility?: string }

export async function loadKbArticles(
    get: ItsmApi['get'],
    search: string | undefined,
    filters: KbArticleFilters = {},
): Promise<{ articles: KbArticle[] }> {
    const { status, visibility } = filters
    if (search && search.trim()) {
        const results = await get<KbSearchResult[]>('/kb/search', { q: search.trim(), limit: 50 })
        let articles = results.map(r => r.article)
        if (status)     articles = articles.filter(a => a.status === status)
        if (visibility) articles = articles.filter(a => a.visibility === visibility)
        return { articles }
    }
    const spaces = await get<KbSpace[]>('/kb/spaces')
    if (!spaces.length) return { articles: [] }
    const baseParams = { ...(status ? { status } : {}), ...(visibility ? { visibility } : {}) }
    // Fetch ALL articles across ALL spaces. The endpoint's param is `limit`
    // (NOT page_size — that was silently ignored → default cap of 25) and it's
    // capped at 100, so page through every space. Space slugs are unique
    // per-tenant, so in the cross-tenant view we pin each to its own X-Tenant-ID.
    const fetchSpace = async (space: KbSpace): Promise<KbArticle[]> => {
        const headers = space.tenant_id ? { 'X-Tenant-ID': space.tenant_id } : undefined
        const out: KbArticle[] = []
        for (let page = 1; page <= 50; page++) {
            let resp: KbArticlesResponse
            try {
                resp = await get<KbArticlesResponse>(`/kb/spaces/${space.slug}/articles`,
                    { ...baseParams, limit: 100, page }, { headers })
            } catch { break }
            const items = resp.items || []
            out.push(...items.map(a => ({ ...a, _spaceTenantId: space.tenant_id, _spaceName: space.name })))
            if (items.length < 100) break
            if (resp.total != null && out.length >= resp.total) break
        }
        return out
    }
    const perSpace = await Promise.all(spaces.map(fetchSpace))
    return { articles: perSpace.flat() }
}

/**
 * Uploads a file directly to a presigned storage URL (S3-style PUT).
 * Used after POST /tickets/{id}/attachments returns { upload_url }.
 */
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
    const resp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
    })
    if (!resp.ok) throw new Error(`Upload failed: HTTP ${resp.status}`)
}

export function withQuery(path: string, params?: QueryParams | null): string {
    if (!params) return path
    const qs = new URLSearchParams(
        Object.entries(params).filter(
            (entry): entry is [string, string | number | boolean] =>
                entry[1] !== undefined && entry[1] !== null && entry[1] !== '',
        ).map(([k, v]) => [k, String(v)]),
    ).toString()
    return qs ? `${path}?${qs}` : path
}

/**
 * Generic async-list loader: { data, loading, error, reload }.
 * Keeps pages thin — they just describe *what* to fetch.
 */
export interface ItsmResourceState<T> {
    data: T | null
    loading: boolean
    error: unknown
}
export interface ItsmResource<T> extends ItsmResourceState<T> {
    reload: () => void
}

export function useItsmResource<T>(loader: () => Promise<T>, deps: unknown[] = []): ItsmResource<T> {
    const [state, setState] = useState<ItsmResourceState<T>>({ data: null, loading: true, error: null })
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
