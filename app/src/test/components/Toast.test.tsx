import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Toast from '@/components/Toast'

describe('Toast', () => {
  it('renders the message', () => {
    render(<Toast message="Something went wrong" onDismiss={vi.fn()} />)

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const onDismiss = vi.fn()
    render(<Toast message="Error" onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('has role="alert" for screen reader accessibility', () => {
    render(<Toast message="Error" onDismiss={vi.fn()} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('does not render an action button when actionLabel/onAction are omitted', () => {
    render(<Toast message="Error" onDismiss={vi.fn()} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('renders and triggers the action button when provided', async () => {
    const onAction = vi.fn()
    render(<Toast message="Update" onDismiss={vi.fn()} actionLabel="Reload" onAction={onAction} />)

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))

    expect(onAction).toHaveBeenCalledOnce()
  })
})
