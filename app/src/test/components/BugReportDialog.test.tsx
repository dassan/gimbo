import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BugReportDialog from '@/components/BugReportDialog'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import { clearBuffer, trackError, trackNavigation } from '@/lib/telemetry'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearBuffer()
  useDataStore.setState({ data: makeDataFile() })
  vi.restoreAllMocks()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** URLSearchParams encodes spaces as '+'; this helper fully decodes both. */
function decodeUrl(url: string): string {
  return decodeURIComponent(url.replace(/\+/g, ' '))
}

function renderDialog(props: Partial<Parameters<typeof BugReportDialog>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn()
  render(<BugReportDialog isOpen={true} onClose={onClose} {...props} />)
  return { onClose }
}

// ─── Render ───────────────────────────────────────────────────────────────────

describe('BugReportDialog — render', () => {
  it('renders the dialog when isOpen is true', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('bugReport.title')).toBeInTheDocument()
  })

  it('renders nothing when isOpen is false', () => {
    render(<BugReportDialog isOpen={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the description textarea', () => {
    renderDialog()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders all 5 snapshot option checkboxes', () => {
    renderDialog()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(5)
    expect(checkboxes.every((cb) => (cb as HTMLInputElement).checked)).toBe(true)
  })

  it('renders the privacy badge', () => {
    renderDialog()
    expect(screen.getByText('bugReport.privacyBadge')).toBeInTheDocument()
  })
})

// ─── Submit button state ───────────────────────────────────────────────────────

describe('BugReportDialog — submit disabled state', () => {
  it('submit button is disabled when description is empty', () => {
    renderDialog()
    const btn = screen.getByRole('button', { name: 'bugReport.submit' })
    expect(btn).toBeDisabled()
  })

  it('submit button is enabled after typing a description', async () => {
    renderDialog()
    await userEvent.type(screen.getByRole('textbox'), 'Something is broken')
    expect(screen.getByRole('button', { name: 'bugReport.submit' })).not.toBeDisabled()
  })

  it('submit button remains disabled for whitespace-only input', async () => {
    renderDialog()
    await userEvent.type(screen.getByRole('textbox'), '   ')
    expect(screen.getByRole('button', { name: 'bugReport.submit' })).toBeDisabled()
  })
})

// ─── Snapshot preview ─────────────────────────────────────────────────────────

describe('BugReportDialog — snapshot preview', () => {
  it('preview is hidden by default', () => {
    renderDialog()
    expect(screen.queryByRole('region', { name: /preview/i })).not.toBeInTheDocument()
    // The <pre> element holding JSON should not be in the DOM
    expect(document.querySelector('pre')).not.toBeInTheDocument()
  })

  it('expands the preview when expand button is clicked', async () => {
    renderDialog()
    await userEvent.click(screen.getByText('bugReport.snapshotExpand'))
    expect(document.querySelector('pre')).toBeInTheDocument()
  })

  it('collapses the preview again when collapse button is clicked', async () => {
    renderDialog()
    await userEvent.click(screen.getByText('bugReport.snapshotExpand'))
    await userEvent.click(screen.getByText('bugReport.snapshotCollapse'))
    expect(document.querySelector('pre')).not.toBeInTheDocument()
  })

  it('preview updates when a checkbox is unchecked', async () => {
    trackNavigation('/dashboard')
    trackNavigation('/transactions')
    renderDialog()

    // Expand preview
    await userEvent.click(screen.getByText('bugReport.snapshotExpand'))
    const preBefore = document.querySelector('pre')!.textContent ?? ''
    expect(preBefore).toContain('/dashboard')

    // Uncheck navigation
    const checkboxes = screen.getAllByRole('checkbox')
    await userEvent.click(checkboxes[0]) // includeNavigation is first
    const preAfter = document.querySelector('pre')!.textContent ?? ''
    expect(preAfter).not.toContain('/dashboard')
  })
})

// ─── Submit — window.open call ────────────────────────────────────────────────

describe('BugReportDialog — submit', () => {
  it('opens the GitHub Issues URL when submitted', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderDialog()
    await userEvent.type(screen.getByRole('textbox'), 'App crashes on login')
    await userEvent.click(screen.getByRole('button', { name: 'bugReport.submit' }))

    expect(openSpy).toHaveBeenCalledOnce()
    const url = openSpy.mock.calls[0][0] as string
    expect(url).toContain('github.com')
    expect(url).toContain('issues/new')
    expect(url).toContain('labels=bug')
  })

  it('URL body contains the user description', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderDialog()
    await userEvent.type(screen.getByRole('textbox'), 'The balance is wrong after import')
    await userEvent.click(screen.getByRole('button', { name: 'bugReport.submit' }))

    const url = openSpy.mock.calls[0][0] as string
    expect(decodeUrl(url)).toContain('The balance is wrong after import')
  })

  it('URL uses prefillTitle when provided', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderDialog({ prefillTitle: 'Cannot save transaction' })
    await userEvent.type(screen.getByRole('textbox'), 'More details here')
    await userEvent.click(screen.getByRole('button', { name: 'bugReport.submit' }))

    const url = openSpy.mock.calls[0][0] as string
    expect(decodeUrl(url)).toContain('Cannot save transaction')
  })

  it('calls onClose after submit', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    const { onClose } = renderDialog()

    await userEvent.type(screen.getByRole('textbox'), 'crash on save')
    await userEvent.click(screen.getByRole('button', { name: 'bugReport.submit' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('URL includes captured errors in snapshot when errors are present', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    trackError(new Error('ReferenceError: x is not defined'))

    renderDialog()
    await userEvent.type(screen.getByRole('textbox'), 'got an error')
    await userEvent.click(screen.getByRole('button', { name: 'bugReport.submit' }))

    const url = openSpy.mock.calls[0][0] as string
    expect(decodeUrl(url)).toContain('ReferenceError: x is not defined')
  })
})

// ─── Cancel ───────────────────────────────────────────────────────────────────

describe('BugReportDialog — cancel', () => {
  it('cancel button calls onClose without opening a URL', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { onClose } = renderDialog()

    await userEvent.click(screen.getByText('bugReport.cancel'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('close (×) button calls onClose', async () => {
    const { onClose } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

// ─── State reset on re-open ───────────────────────────────────────────────────

describe('BugReportDialog — state reset', () => {
  it('clears description when dialog re-opens', async () => {
    const { rerender } = render(<BugReportDialog isOpen={true} onClose={vi.fn()} />)
    await userEvent.type(screen.getByRole('textbox'), 'some text')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('some text')

    // Close and reopen
    rerender(<BugReportDialog isOpen={false} onClose={vi.fn()} />)
    rerender(<BugReportDialog isOpen={true} onClose={vi.fn()} />)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('')
  })
})
