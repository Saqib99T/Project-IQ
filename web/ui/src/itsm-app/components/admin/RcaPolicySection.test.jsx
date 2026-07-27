import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RcaPolicySection from './RcaPolicySection'

vi.mock('../../../shared/itsm/useItsmApi', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        useItsmApi: () => ({ get: mockGet, post: mockPost, patch: mockPatch, remove: mockRemove }),
    }
})

let mockGet
let mockPost
let mockPatch
let mockRemove

function policy(overrides = {}) {
    return { id: 'pol-1', name: 'Sev1 policy', status: 'active', priority: 100, conditions: [], outputs: {}, ...overrides }
}

describe('RcaPolicySection — policy list + creation', () => {
    beforeEach(() => {
        mockGet = vi.fn((path) => {
            if (path === '/tenant/rca-policies') return Promise.resolve({ items: [] })
            if (path === '/tenant/recording-policies') return Promise.resolve({
                block_link_if_missing_consent: false, allow_ai_summary: true, allow_manual_upload: true, recording_retention_days: 365,
            })
            return Promise.resolve({})
        })
        mockPost = vi.fn(() => Promise.resolve({}))
        mockPatch = vi.fn(() => Promise.resolve({}))
        mockRemove = vi.fn(() => Promise.resolve({}))
    })
    afterEach(() => { vi.restoreAllMocks() })

    it('disables "+ Add policy" until a name is entered, then creates it', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await screen.findByText('No RCA policies yet — the built-in default trigger table applies.')

        const addBtn = screen.getByText('+ Add policy')
        expect(addBtn).toBeDisabled()

        await user.type(screen.getByPlaceholderText('New policy name'), 'Critical SLA breach')
        expect(addBtn).not.toBeDisabled()
        await user.click(addBtn)

        await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/tenant/rca-policies', expect.objectContaining({
            name: 'Critical SLA breach', status: 'draft',
        })))
    })

    it('switches to the Recording Policy tab and shows its settings', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await screen.findByText('No RCA policies yet — the built-in default trigger table applies.')

        await user.click(screen.getByText('Recording Policy'))
        expect(await screen.findByText('Block linking a recording if consent is missing')).toBeInTheDocument()
    })
})

describe('RcaPolicySection — condition builder + dry-run test', () => {
    beforeEach(() => {
        mockGet = vi.fn((path) => path === '/tenant/rca-policies'
            ? Promise.resolve({ items: [policy()] })
            : Promise.resolve({ items: [] }))
        mockPost = vi.fn(() => Promise.resolve({ required: true, due_days: 3 }))
        mockPatch = vi.fn(() => Promise.resolve({}))
        mockRemove = vi.fn(() => Promise.resolve({}))
    })
    afterEach(() => { vi.restoreAllMocks() })

    it('adds a condition row and only shows Save once something changed', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await screen.findByText('Sev1 policy')

        expect(screen.queryByText('Save')).not.toBeInTheDocument()
        await user.click(screen.getByText('+ condition'))
        expect(screen.getByText('Save')).toBeInTheDocument()
        expect(screen.getByText('remove')).toBeInTheDocument()
    })

    it('runs the dry-run test and displays the result', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await screen.findByText('Sev1 policy')

        await user.click(screen.getByText('Test policy (sev1 + SLA breach)'))
        await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
            '/tenant/rca-policies/pol-1/test',
            expect.objectContaining({ severity_rank: 1, sla_breached: true }),
        ))
        expect(await screen.findByText(/required, due in 3d/)).toBeInTheDocument()
    })

    it('deletes a policy', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await screen.findByText('Sev1 policy')

        await user.click(screen.getByText('delete'))
        await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('/tenant/rca-policies/pol-1'))
    })
})

describe('RcaPolicySection — recording policy save', () => {
    beforeEach(() => {
        mockGet = vi.fn((path) => path === '/tenant/rca-policies'
            ? Promise.resolve({ items: [] })
            : Promise.resolve({ block_link_if_missing_consent: false, allow_ai_summary: true, allow_manual_upload: true, recording_retention_days: 365 }))
        mockPost = vi.fn(() => Promise.resolve({}))
        mockPatch = vi.fn(() => Promise.resolve({}))
        mockRemove = vi.fn(() => Promise.resolve({}))
    })
    afterEach(() => { vi.restoreAllMocks() })

    it('toggling a checkbox reveals Save, and Save PATCHes the change', async () => {
        const user = userEvent.setup()
        render(<RcaPolicySection />)
        await user.click(screen.getByText('Recording Policy'))

        const checkbox = await screen.findByLabelText('Block linking a recording if consent is missing')
        expect(screen.queryByText('Save')).not.toBeInTheDocument()

        await user.click(checkbox)
        await user.click(screen.getByText('Save'))

        await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
            '/tenant/recording-policies',
            expect.objectContaining({ block_link_if_missing_consent: true }),
        ))
    })
})
