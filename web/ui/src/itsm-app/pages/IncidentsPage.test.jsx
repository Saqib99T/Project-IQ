import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncidentsTab } from './IncidentsPage'

// Regression test for the tenant-switch race found while building the RCA
// governance module (specs/08): IncidentDetail is a child that reads the SAME
// ambient tenant context as this list. When the tenant scope changes, `get`'s
// identity changes for BOTH this component and IncidentDetail in the same
// render — if IncidentDetail still holds the PREVIOUS tenant's selected
// incident id at that moment, it independently re-fires its own fetch for
// that stale id under the NEW tenant scope, producing a spurious 404 for an
// incident that legitimately isn't in the new tenant. The fix: this list
// clears `selected` synchronously the instant `get` changes, so
// IncidentDetail unmounts for that gap instead of firing a doomed request.

// useItsmResource is a plain, dependency-free hook (just wraps a loader in
// state) so it's kept real via importOriginal; only the API-calling hooks
// are replaced with test doubles.
vi.mock('../../shared/itsm/useItsmApi', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        useItsmApi: () => mockApi.current,
        useUserDirectory: () => ({}),
    }
})
vi.mock('../../shared/itsm/useItsmPermissions', () => ({
    useItsmPermissions: () => ({ isManager: true, isAgent: true, isAdmin: true }),
}))

// A mutable holder so the mocked useItsmApi() can return a DIFFERENT `get`
// function reference on demand (simulating a tenant switch) without needing
// a real ItsmTenantContext/provider tree in the test.
const mockApi = { current: null }

function makeApi(tenantLabel, incidentsByTenant) {
    const get = vi.fn((path) => {
        if (path === '/incidents') {
            return Promise.resolve(incidentsByTenant[tenantLabel] || [])
        }
        if (path === '/rca') {
            return Promise.resolve({ items: [] })
        }
        const idMatch = path.match(/^\/incidents\/([^/]+)(\/(timeline|roles))?$/)
        if (idMatch) {
            const [, id, , sub] = idMatch
            const inc = (incidentsByTenant[tenantLabel] || []).find(i => i.id === id)
            if (!inc) {
                const err = new Error("Incident 'requested' not found")
                err.status = 404
                return Promise.reject(err)
            }
            if (sub === 'timeline') return Promise.resolve({ events: [] })
            if (sub === 'roles') return Promise.resolve({ roles: [] })
            return Promise.resolve(inc)
        }
        return Promise.resolve({})
    })
    return { get, post: vi.fn(() => Promise.resolve({})), patch: vi.fn(), remove: vi.fn() }
}

const TENANT_A_INCIDENTS = [
    { id: 'inc-a1', incident_number: 'IR-A-1', title: 'Tenant A incident', status: 'investigating', tenant_id: 'tenant-a' },
]
const TENANT_B_INCIDENTS = [
    { id: 'inc-b1', incident_number: 'IR-B-1', title: 'Tenant B incident', status: 'investigating', tenant_id: 'tenant-b' },
]

describe('IncidentsTab — tenant-switch selection race', () => {
    beforeEach(() => {
        mockApi.current = makeApi('A', { A: TENANT_A_INCIDENTS, B: TENANT_B_INCIDENTS })
    })

    it('selects the first incident in the initial (tenant A) list', async () => {
        render(<IncidentsTab />)
        await waitFor(() => expect(screen.getByText('Tenant A incident')).toBeInTheDocument())
    })

    it('does not keep the previous tenant\'s incident selected after a tenant switch', async () => {
        const { rerender } = render(<IncidentsTab />)
        await waitFor(() => expect(screen.getByText('Tenant A incident')).toBeInTheDocument())

        // Simulate switching tenants: a NEW `get` reference (as the real
        // useItsmApi() would produce when its tenantId dependency changes),
        // now serving tenant B's incidents.
        mockApi.current = makeApi('B', { A: TENANT_A_INCIDENTS, B: TENANT_B_INCIDENTS })
        rerender(<IncidentsTab />)

        // The detail pane must never show tenant A's incident under tenant B's
        // scope — either it's briefly cleared, or it shows tenant B's own
        // incident once the refetch lands. It must NOT keep requesting
        // 'Tenant A incident' (which would 404 under tenant B).
        await waitFor(() => expect(screen.getByText('Tenant B incident')).toBeInTheDocument())
        expect(screen.queryByText('Tenant A incident')).not.toBeInTheDocument()

        // The stale id must never have been queried under the new tenant scope.
        const calledPaths = mockApi.current.get.mock.calls.map(c => c[0])
        expect(calledPaths).not.toContain('/incidents/inc-a1')
    })
})
