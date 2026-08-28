import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import BootSkeleton from '@/components/BootSkeleton'
import { _resetBootTrackingForTests, startBootTracking } from '@/lib/bootMetrics'
import { clearBuffer, getSnapshot, type PerfEvent } from '@/lib/telemetry'

beforeEach(() => {
  clearBuffer()
  _resetBootTrackingForTests()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function metricNames(): string[] {
  return getSnapshot()
    .filter((e): e is PerfEvent => e.type === 'performance')
    .map((e) => e.metric)
}

describe('BootSkeleton', () => {
  it('anuncia carregamento em vez de renderizar uma página vazia', () => {
    render(<BootSkeleton />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Carregando seu cofre…')).toBeInTheDocument()
  })

  it('mantém a marca visível — é o que distingue "carregando" de "quebrou"', () => {
    render(<BootSkeleton />)
    expect(screen.getByText('Gim')).toBeInTheDocument()
    expect(screen.getByText('bo')).toBeInTheDocument()
  })

  it('registra boot.shellVisible ao pintar', () => {
    startBootTracking()
    render(<BootSkeleton />)
    expect(metricNames()).not.toContain('boot.shellVisible') // ainda não pintou
    vi.advanceTimersByTime(40)
    expect(metricNames()).toContain('boot.shellVisible')
    // O ganho de percepção só existe se a janela em branco fechar aqui, não na hidratação.
    expect(metricNames()).toContain('boot.blankWindow')
  })
})
