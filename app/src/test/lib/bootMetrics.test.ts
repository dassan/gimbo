import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  _resetBootTrackingForTests,
  markAppVisible,
  measureBoot,
  measureBootSync,
  startBootTracking,
  trackBoot,
} from '@/lib/bootMetrics'
import { clearBuffer, getSnapshot, type PerfEvent } from '@/lib/telemetry'

function perfEvents(): PerfEvent[] {
  return getSnapshot().filter((e): e is PerfEvent => e.type === 'performance')
}

function metricNames(): string[] {
  return perfEvents().map((e) => e.metric)
}

/** Roda os callbacks de requestAnimationFrame pendentes (jsdom não pinta nada sozinho). */
function flushFrames(times: number) {
  for (let i = 0; i < times; i++) vi.advanceTimersByTime(20)
}

beforeEach(() => {
  clearBuffer()
  _resetBootTrackingForTests()
})

// ─── registro direto ──────────────────────────────────────────────────────────

describe('trackBoot / measureBoot / measureBootSync', () => {
  it('registra a métrica mesmo fora de DEV — boot não é gated por toggle', () => {
    trackBoot('boot.exemplo', 42)
    expect(perfEvents()).toEqual([
      expect.objectContaining({ type: 'performance', metric: 'boot.exemplo', ms: 42 }),
    ])
  })

  it('measureBoot mede uma fase assíncrona e devolve o valor', async () => {
    const result = await measureBoot('boot.fase', () => Promise.resolve('ok'))
    expect(result).toBe('ok')
    expect(metricNames()).toEqual(['boot.fase'])
    expect(perfEvents()[0].ms).toBeGreaterThanOrEqual(0)
  })

  it('measureBoot registra a fase mesmo quando ela falha', async () => {
    await expect(measureBoot('boot.falha', () => Promise.reject(new Error('x')))).rejects.toThrow(
      'x'
    )
    expect(metricNames()).toEqual(['boot.falha'])
  })

  it('measureBootSync mede uma fase síncrona e devolve o valor', () => {
    expect(measureBootSync('boot.sync', () => 7)).toBe(7)
    expect(metricNames()).toEqual(['boot.sync'])
  })
})

// ─── marcos do boot ───────────────────────────────────────────────────────────

describe('startBootTracking', () => {
  it('registra o instante em que o script chegou a rodar', () => {
    startBootTracking()
    expect(metricNames()).toContain('boot.scriptStart')
  })

  it('é idempotente — o StrictMode não pode contar o boot duas vezes', () => {
    startBootTracking()
    startBootTracking()
    expect(metricNames().filter((m) => m === 'boot.scriptStart')).toHaveLength(1)
  })
})

describe('markAppVisible', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registra boot.appVisible depois do frame pintado', () => {
    markAppVisible()
    expect(metricNames()).not.toContain('boot.appVisible') // ainda não pintou
    flushFrames(2)
    expect(metricNames()).toContain('boot.appVisible')
  })

  it('é idempotente — uma hidratação, um marco', () => {
    markAppVisible()
    markAppVisible()
    flushFrames(2)
    expect(metricNames().filter((m) => m === 'boot.appVisible')).toHaveLength(1)
  })

  it('mede a janela em branco a partir do scriptStart quando não há first-paint', () => {
    // Caso do Firefox (e do jsdom, que não emite entradas 'paint' nenhuma): sem `first-paint`, a
    // janela é contada do início do script — nunca do FCP, que neste app chega junto com a
    // interface e reportaria uma janela de dezenas de ms para um boot de segundos (M-87).
    startBootTracking()
    markAppVisible()
    flushFrames(2)
    expect(metricNames()).toContain('boot.blankWindow')
  })

  it('a janela em branco não é registrada se o boot nunca foi iniciado', () => {
    // Sem `startBootTracking()` não há origem conhecida para a janela — melhor não existir do que
    // existir com um valor inventado.
    markAppVisible()
    flushFrames(2)
    expect(metricNames()).not.toContain('boot.blankWindow')
  })
})
