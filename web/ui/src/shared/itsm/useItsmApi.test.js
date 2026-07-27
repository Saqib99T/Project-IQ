import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { withQuery, useUserDirectory } from './useItsmApi'

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
