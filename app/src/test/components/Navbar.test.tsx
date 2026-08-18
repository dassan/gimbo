import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Navbar from '@/components/Navbar'
import { loadBackupDirHandle } from '@/lib/backupDir'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router-dom', () => ({
  NavLink: ({
    children,
    to,
  }: {
    children: ((props: { isActive: boolean }) => React.ReactNode) | React.ReactNode
    to: string
  }) => {
    const content = typeof children === 'function' ? children({ isActive: false }) : children
    return <a href={to}>{content}</a>
  },
  useNavigate: () => vi.fn(),
}))

vi.mock('@/lib/backupDir', () => ({
  loadBackupDirHandle: vi.fn().mockResolvedValue(null),
}))

describe('Navbar', () => {
  it('renders the vault name', () => {
    render(<Navbar vaultName="Family Vault" />)
    expect(screen.getByText('Family Vault')).toBeInTheDocument()
  })

  it('renders no vault name text when not provided', () => {
    render(<Navbar />)
    expect(screen.queryByText('Family Vault')).not.toBeInTheDocument()
  })

  it('renders nav links for dashboard, transactions, budgets', () => {
    render(<Navbar vaultName="Family Vault" />)
    // nav.dashboard, nav.transactions and nav.budgets appear in both the top bar and the
    // mobile bottom nav (MB-13: budgets replaced analytics in the bottom nav)
    expect(screen.getAllByText('nav.dashboard').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('nav.transactions').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('nav.budgets').length).toBeGreaterThanOrEqual(1)
  })

  it('renders analytics in both the desktop top bar and the mobile bottom nav (MB-17)', () => {
    render(<Navbar vaultName="Family Vault" />)
    // MB-13 removed analytics from the bottom nav; MB-17 brought it back once the settings
    // slot moved into the vault-name menu, freeing a slot for it.
    expect(screen.getAllByText('nav.analytics').length).toBe(2)
  })

  it('renders one settings button (desktop top bar) — the mobile one moved into the vault menu (MB-17)', async () => {
    render(<Navbar vaultName="Family Vault" />)
    const settingsBtns = screen.getAllByRole('button', { name: 'nav.settings' })
    expect(settingsBtns.length).toBe(1)
    // Clicking it should not throw
    await userEvent.click(settingsBtns[0])
  })

  it('opens a vault menu with a settings entry when the vault pill is tapped on mobile (MB-17)', async () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })

    render(<Navbar vaultName="Family Vault" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTitle('Family Vault'))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'nav.settings' })).toBeInTheDocument()

    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
  })

  it('does not open the vault menu when the pill is clicked on desktop widths (MB-17)', async () => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 })

    render(<Navbar vaultName="Family Vault" />)
    await userEvent.click(screen.getByTitle('Family Vault'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not show the local-backup badge when no backup folder is configured', async () => {
    render(<Navbar vaultName="Family Vault" />)
    await waitFor(() => expect(loadBackupDirHandle).toHaveBeenCalled())
    expect(screen.queryByLabelText('settings.localBackupBadgeLabel')).not.toBeInTheDocument()
  })

  it('shows the local-backup badge (Nível 1) once a backup folder is configured', async () => {
    vi.mocked(loadBackupDirHandle).mockResolvedValueOnce({} as FileSystemDirectoryHandle)
    render(<Navbar vaultName="Family Vault" />)
    expect(await screen.findByLabelText('settings.localBackupBadgeLabel')).toBeInTheDocument()
  })
})
