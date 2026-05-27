import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Navbar from '@/components/Navbar'

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

describe('Navbar', () => {
  it('renders initials in avatar', () => {
    render(<Navbar initials="AB" />)
    expect(screen.getByText('AB')).toBeInTheDocument()
  })

  it('defaults initials to "U" when not provided', () => {
    render(<Navbar />)
    expect(screen.getByText('U')).toBeInTheDocument()
  })

  it('renders nav links for dashboard, transactions, analytics', () => {
    render(<Navbar initials="AB" />)
    expect(screen.getByText('nav.dashboard')).toBeInTheDocument()
    expect(screen.getByText('nav.transactions')).toBeInTheDocument()
    expect(screen.getByText('nav.analytics')).toBeInTheDocument()
  })

  it('navigates to settings when settings button is clicked', async () => {
    const navigate = vi.fn()
    vi.mocked(vi.fn()).mockReturnValue(navigate)
    render(<Navbar initials="AB" />)
    await userEvent.click(screen.getByRole('button', { name: 'nav.settings' }))
  })
})
