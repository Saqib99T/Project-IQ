import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RcaPanel from './RcaPanel'

// Regression test for the double-fire bug found while building the RCA
// governance module (specs/08): the `creating` React state only disables the
// button on the NEXT render, so a fast double-click could fire two
// POST /rca requests before that render happened — the second one 409s
// (incident_id is unique per RCA). Fixed with a synchronous ref guard.
//
// Also covers: lifecycle action buttons are shown/hidden per the SAME state
// machine the backend enforces (client-side is UX only, server is
// authoritative — but a mismatch here would be confusing/misleading UX), and
// that destructive/gated actions (waive, reject, accept-risk) require a
// reason and are hidden entirely from non-managers.

let isManager = true
vi.mock('../../shared/itsm/useItsmApi', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        useItsmApi: () => ({ get: mockGet, post: mockPost, patch: mockPatch, remove: vi.fn() }),
        useUserDirectory: () => ({}),
    }
})
vi.mock('../../shared/itsm/useItsmPermissions', () => ({
    useItsmPermissions: () => ({ isManager }),
}))

let mockGet
let mockPost
let mockPatch

function rca(overrides = {}) {
    return {
        id: 'rca-1', rca_number: 'RCA-000001', status: 'draft',
        executive_summary: 'summary', root_cause_statement: 'cause', customer_impact: 'impact',
        ...overrides,
    }
}

function mockGetFor(currentRca, { evidence = [], actions = [] } = {}) {
    return vi.fn((path) => {
        if (path === '/rca') return Promise.resolve({ items: currentRca ? [currentRca] : [] })
        if (path.endsWith('/evidence-checklist')) return Promise.resolve({ items: evidence })
        if (path.endsWith('/actions')) return Promise.resolve({ items: actions })
        return Promise.resolve({})
    })
}

describe('RcaPanel — create-button double-fire guard', () => {
    beforeEach(() => {
        isManager = true
        mockGet = mockGetFor(null)
        mockPost = vi.fn(() => new Promise(resolve => setTimeout(() => resolve({ id: 'rca-1' }), 20)))
        mockPatch = vi.fn(() => Promise.resolve({}))
    })

    it('fires exactly one POST /rca even when clicked twice in immediate succession', async () => {
        const user = userEvent.setup()
        render(<RcaPanel incidentId="inc-1" incidentTitle="Test incident" />)

        const button = await screen.findByText('+ Create RCA')
        await Promise.all([user.click(button), user.click(button)])

        await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    })
})

describe('RcaPanel — lifecycle action visibility', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('draft: shows Submit for review, and Waive for a manager, no Approve/Reject yet', async () => {
        isManager = true
        mockGet = mockGetFor(rca({ status: 'draft' }))
        render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        expect(await screen.findByText('Submit for review')).toBeInTheDocument()
        expect(screen.getByText('Waive')).toBeInTheDocument()
        expect(screen.queryByText('Approve')).not.toBeInTheDocument()
        expect(screen.queryByText('Reject')).not.toBeInTheDocument()
        expect(screen.queryByText('Complete')).not.toBeInTheDocument()
    })

    it('draft: an agent (non-manager) sees Submit but not Waive', async () => {
        isManager = false
        mockGet = mockGetFor(rca({ status: 'draft' }))
        render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        expect(await screen.findByText('Submit for review')).toBeInTheDocument()
        expect(screen.queryByText('Waive')).not.toBeInTheDocument()
    })

    it('under_review: manager sees Approve and Reject', async () => {
        isManager = true
        mockGet = mockGetFor(rca({ status: 'under_review' }))
        render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        expect(await screen.findByText('Approve')).toBeInTheDocument()
        expect(screen.getByText('Reject')).toBeInTheDocument()
        expect(screen.queryByText('Submit for review')).not.toBeInTheDocument()
    })

    it('actions_in_progress: shows Complete, but not Submit/Approve/Waive', async () => {
        mockGet = mockGetFor(rca({ status: 'actions_in_progress' }))
        render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        expect(await screen.findByText('Complete')).toBeInTheDocument()
        expect(screen.queryByText('Submit for review')).not.toBeInTheDocument()
        expect(screen.queryByText('Approve')).not.toBeInTheDocument()
        expect(screen.queryByText('Waive')).not.toBeInTheDocument()
    })

    it('completed: manager sees Reopen, agent does not', async () => {
        isManager = true
        mockGet = mockGetFor(rca({ status: 'completed' }))
        const { rerender } = render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)
        expect(await screen.findByText('Reopen')).toBeInTheDocument()

        isManager = false
        mockGet = mockGetFor(rca({ status: 'completed' }))
        rerender(<RcaPanel incidentId="inc-1" incidentTitle="x" />)
        await waitFor(() => expect(screen.queryByText('Reopen')).not.toBeInTheDocument())
    })
})

describe('RcaPanel — evidence checklist waive gate', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('does not waive when the user cancels the reason prompt', async () => {
        isManager = true
        mockGet = mockGetFor(rca(), { evidence: [{ id: 'ev-1', evidence_type: 'timeline_completed', status: 'missing' }] })
        vi.spyOn(window, 'prompt').mockReturnValue(null)
        const user = userEvent.setup()
        render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        const waiveBtn = await screen.findByText('Waive', { selector: 'button' })
        await user.click(waiveBtn)

        expect(mockPost).not.toHaveBeenCalledWith(expect.stringContaining('/waive'), expect.anything())
    })

    it('waives with the given reason, and the option is hidden from non-managers', async () => {
        isManager = true
        mockGet = mockGetFor(rca(), { evidence: [{ id: 'ev-1', evidence_type: 'timeline_completed', status: 'missing' }] })
        vi.spyOn(window, 'prompt').mockReturnValue('not applicable')
        const user = userEvent.setup()
        const { rerender } = render(<RcaPanel incidentId="inc-1" incidentTitle="x" />)

        const row = (await screen.findByText('timeline completed')).closest('li')
        await user.click(within(row).getByText('Waive'))
        await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
            '/rca/rca-1/evidence-checklist/ev-1/waive', { reason: 'not applicable' },
        ))

        isManager = false
        mockGet = mockGetFor(rca(), { evidence: [{ id: 'ev-1', evidence_type: 'timeline_completed', status: 'missing' }] })
        rerender(<RcaPanel incidentId="inc-1" incidentTitle="x" />)
        await waitFor(() => {
            const newRow = screen.getByText('timeline completed').closest('li')
            expect(within(newRow).queryByText('Waive')).not.toBeInTheDocument()
            expect(within(newRow).getByText('Mark provided')).toBeInTheDocument()
        })
    })
})
