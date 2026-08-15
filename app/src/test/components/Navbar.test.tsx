import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('renders nav links for dashboard, transactions, analytics', () => {
    render(<Navbar vaultName="Family Vault" />)
    // nav.dashboard and nav.transactions appear in both the top bar and the mobile bottom nav
    expect(screen.getAllByText('nav.dashboard').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('nav.transactions').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('nav.analytics').length).toBeGreaterThanOrEqual(1)
  })

  it('renders settings button(s) — one in desktop top bar, one in mobile bottom nav', async () => {
    render(<Navbar vaultName="Family Vault" />)
    // MB-02: two settings buttons rendered (desktop hidden via CSS, mobile hidden via CSS).
    // Both are present in the DOM; visibility is controlled by Tailwind responsive classes.
    const settingsBtns = screen.getAllByRole('button', { name: 'nav.settings' })
    expect(settingsBtns.length).toBeGreaterThanOrEqual(1)
    // Clicking the first one should not throw
    await userEvent.click(settingsBtns[0])
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
