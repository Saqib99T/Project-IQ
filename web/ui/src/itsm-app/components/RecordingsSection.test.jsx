import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecordingsSection from './RecordingsSection'

vi.mock('../../shared/itsm/useItsmApi', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        useItsmApi: () => ({ get: mockGet, post: mockPost, patch: mockPatch, remove: vi.fn() }),
    }
})

let mockGet
let mockPost
let mockPatch

function recording(overrides = {}) {
    return {
        id: 'rec-1', title: 'Support call', source_type: 'teams', consent_status: 'not_required',
        ai_summary_status: 'not_requested', evidence_weight: 'none', recording_url: 'https://teams.microsoft.com/x',
        ...overrides,
    }
}

describe('RecordingsSection — add-recording form', () => {
    beforeEach(() => {
        mockGet = vi.fn(() => Promise.resolve({ items: [] }))
        mockPost = vi.fn(() => Promise.resolve({}))
        mockPatch = vi.fn(() => Promise.resolve({}))
    })
    afterEach(() => { vi.restoreAllMocks() })

    it('shows an empty state and a disabled submit button until both fields are filled', async () => {
        render(<RecordingsSection ticketId="t1" />)
        await screen.findByText('No recordings linked to this ticket.')

        const submit = screen.getByText('+ Link recording')
        expect(submit).toBeDisabled()

        const user = userEvent.setup()
        await user.type(screen.getByPlaceholderText(/Paste a Teams/), 'https://teams.microsoft.com/l/x')
        expect(submit).toBeDisabled() // title still empty

        await user.type(screen.getByPlaceholderText('Title'), 'Customer call')
        expect(submit).not.toBeDisabled()
    })

    it('submits url + title, clears the form, and reloads the list', async () => {
        const user = userEvent.setup()
        render(<RecordingsSection ticketId="t1" />)
        await screen.findByText('No recordings linked to this ticket.')

        await user.type(screen.getByPlaceholderText(/Paste a Teams/), 'https://teams.microsoft.com/l/x')
        await user.type(screen.getByPlaceholderText('Title'), 'Customer call')
        await user.click(screen.getByText('+ Link recording'))

        await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
            '/tickets/t1/recordings/from-url', { url: 'https://teams.microsoft.com/l/x', title: 'Customer call' },
        ))
        await waitFor(() => expect(screen.getByPlaceholderText('Title')).toHaveValue(''))
    })
})

describe('RecordingsSection — recording card actions', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('toggles the "Use as RCA evidence" label and calls PATCH with the new evidence_weight', async () => {
        mockGet = vi.fn(() => Promise.resolve({ items: [recording()] }))
        mockPost = vi.fn(() => Promise.resolve({}))
        mockPatch = vi.fn(() => Promise.resolve({}))
        const user = userEvent.setup()
        render(<RecordingsSection ticketId="t1" />)

        const toggle = await screen.findByText('Use as RCA evidence')
        await user.click(toggle)

        await waitFor(() => expect(mockPatch).toHaveBeenCalledWith(
            '/tickets/t1/recordings/rec-1', { evidence_weight: 'required_for_rca' },
        ))
    })

    it('shows "Generate summary" only when a summary has not succeeded yet', async () => {
        mockGet = vi.fn(() => Promise.resolve({ items: [recording({ ai_summary_status: 'completed', ai_summary: 'It was resolved.' })] }))
        render(<RecordingsSection ticketId="t1" />)

        await screen.findByText('summarized')
        expect(screen.queryByText('Generate summary')).not.toBeInTheDocument()
        expect(screen.getByText('It was resolved.')).toBeInTheDocument()
    })

    it('surfaces an "inaccessible" badge when the recording link is dead', async () => {
        mockGet = vi.fn(() => Promise.resolve({ items: [recording({ status: 'inaccessible' })] }))
        render(<RecordingsSection ticketId="t1" />)
        expect(await screen.findByText('inaccessible')).toBeInTheDocument()
    })
})
