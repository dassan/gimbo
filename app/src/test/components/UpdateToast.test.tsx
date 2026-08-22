import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import UpdateToast from '@/components/UpdateToast'

describe('UpdateToast', () => {
  it('renders nothing when no update is available', () => {
    const { container } = render(<UpdateToast />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
