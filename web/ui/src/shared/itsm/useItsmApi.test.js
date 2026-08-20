import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
    withQuery, useUserDirectory,
    loadKbSpaces, loadKbCategories, loadPendingKbDrafts,
    triggerKbCuration, approveKbDraft, rejectKbDraft,
} from './useItsmApi'

describe('withQuery', () => {
    it('returns the bare path when there are no params', () => {
        expect(withQuery('/incidents', undefined)).toBe('/incidents')
        expect(withQuery('/incidents', null)).toBe('/incidents')
    })

    it('serializes params into a query string', () => {
        expect(withQuery('/incidents', { status: 'open', limit: 25 })).toBe('/incidents?status=open&limit=25')
    })

    it('drops undefined, null, and empty-string values but keeps falsy-but-meaningful ones', () => {
        const url = withQuery('/tenant/users', { limit: 100, cursor: undefined, search: '', page: 0 })
        expect(url).toBe('/tenant/users?limit=100&page=0')
    })

    it('returns the bare path when every param is filtered out', () => {
        expect(withQuery('/incidents', { cursor: undefined, q: '' })).toBe('/incidents')
    })
})

// useUserDirectory hits GET /tenant/users — manager/admin only, and has no
// cross-tenant mode. On a platform user's "All tenants" view, the caller
// passes the entity's own tenant_id once known; before that (or when the
// caller has nothing to scope to yet), `skip` suppresses the fetch entirely
// rather than firing a call that's guaranteed to 403.
vi.mock('../../widget/hooks/useIam', () => ({
    useIam: () => ({ kc: { token: 'fake-token' }, login: vi.fn() }),
}))

describe('useUserDirectory', () => {
    beforeEach(() => {
        global.fetch = vi.fn(() => Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ items: [{ id: 'u1', first_name: 'Ada', last_name: 'Lovelace' }] }),
        }))
    })
    afterEach(() => { vi.restoreAllMocks() })

    it('fetches /tenant/users and resolves a display-name map by default', async () => {
        const { result } = renderHook(() => useUserDirectory())
        await waitFor(() => expect(result.current).toEqual({ u1: 'Ada Lovelace' }))
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/tenant/users'),
            expect.anything(),
        )
    })

    it('never calls fetch when skip is true', async () => {
        const { result, rerender } = renderHook(({ skip }) => useUserDirectory(undefined, { skip }), {
            initialProps: { skip: true },
        })
        // give any (incorrectly) scheduled microtask a chance to run
        await new Promise(r => setTimeout(r, 10))
        expect(global.fetch).not.toHaveBeenCalled()
        expect(result.current).toEqual({})

        // once skip flips to false (e.g. the caller's entity finished loading
        // and now has a tenant_id to pass), it should fetch normally
        rerender({ skip: false })
        await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    })
})

// KB wiki curation loaders/mutations (docs/KB_WIKI_CURATION_FLOW.md) — thin
// wrappers over get/post, so tested against a plain mock rather than fetch.
describe('KB curation API helpers', () => {
    it('loadKbSpaces fetches /kb/spaces', async () => {
        const get = vi.fn(() => Promise.resolve([{ id: 's1', name: 'General', slug: 'general' }]))
        const result = await loadKbSpaces(get)
        expect(get).toHaveBeenCalledWith('/kb/spaces')
        expect(result).toEqual([{ id: 's1', name: 'General', slug: 'general' }])
    })

    it('loadKbCategories fetches /kb/spaces/{id}/categories', async () => {
        const get = vi.fn(() => Promise.resolve([]))
        await loadKbCategories(get, 's1')
        expect(get).toHaveBeenCalledWith('/kb/spaces/s1/categories')
    })

    it('loadPendingKbDrafts fetches /kb/curation/pending', async () => {
        const get = vi.fn(() => Promise.resolve([]))
        await loadPendingKbDrafts(get)
        expect(get).toHaveBeenCalledWith('/kb/curation/pending')
    })

    it('triggerKbCuration posts /kb/curation/run with the given body', async () => {
        const post = vi.fn(() => Promise.resolve({ id: 'a1' }))
        const body = { space_id: 's1', title: 'How refunds work', source_text: 'Refunds take 5-7 days.' }
        await triggerKbCuration(post, body)
        expect(post).toHaveBeenCalledWith('/kb/curation/run', body)
    })

    it('approveKbDraft posts /kb/curation/{id}/approve with an empty body', async () => {
        const post = vi.fn(() => Promise.resolve({ id: 'a1' }))
        await approveKbDraft(post, 'a1')
        expect(post).toHaveBeenCalledWith('/kb/curation/a1/approve', {})
    })

    it('rejectKbDraft posts /kb/curation/{id}/reject, defaulting resynthesize to false', async () => {
        const post = vi.fn(() => Promise.resolve({ id: 'a1' }))
        await rejectKbDraft(post, 'a1', { reviewer_notes: 'not accurate' })
        expect(post).toHaveBeenCalledWith('/kb/curation/a1/reject', { resynthesize: false, reviewer_notes: 'not accurate' })
    })

    it('rejectKbDraft forwards resynthesize:true when requested', async () => {
        const post = vi.fn(() => Promise.resolve({ id: 'a1' }))
        await rejectKbDraft(post, 'a1', { reviewer_notes: 'add EU timeline', resynthesize: true })
        expect(post).toHaveBeenCalledWith('/kb/curation/a1/reject', { reviewer_notes: 'add EU timeline', resynthesize: true })
    })
})
