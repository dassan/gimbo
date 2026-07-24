import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runPeerSyncMock } = vi.hoisted(() => ({ runPeerSyncMock: vi.fn() }))

vi.mock('@/store/useDataStore', () => ({
  useDataStore: { getState: () => ({ runPeerSync: runPeerSyncMock }) },
}))

const { isMultiDeviceEnabledMock, getSyncPollIntervalMinutesMock } = vi.hoisted(() => ({
  isMultiDeviceEnabledMock: vi.fn(),
  getSyncPollIntervalMinutesMock: vi.fn(),
}))

vi.mock('@/lib/cloudSync/multiDeviceMode', () => ({
  isMultiDeviceEnabled: isMultiDeviceEnabledMock,
  getSyncPollIntervalMinutes: getSyncPollIntervalMinutesMock,
}))

const { startSyncPolling, rescheduleSyncPolling, stopSyncPolling } =
  await import('@/lib/cloudSync/syncScheduler')

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
}

beforeEach(() => {
  vi.useFakeTimers()
  runPeerSyncMock.mockReset().mockResolvedValue(undefined)
  isMultiDeviceEnabledMock.mockReset().mockReturnValue(true)
  getSyncPollIntervalMinutesMock.mockReset().mockReturnValue(60)
  setVisibility('visible')
})

afterEach(() => {
  stopSyncPolling()
  vi.useRealTimers()
})

describe('syncScheduler', () => {
  it('does not sync before the configured interval elapses', async () => {
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(59 * 60_000)
    expect(runPeerSyncMock).not.toHaveBeenCalled()
  })

  it('syncs once the configured interval elapses, while enabled and visible', async () => {
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runPeerSyncMock).toHaveBeenCalledTimes(1)
  })

  it('reschedules after each tick (keeps polling)', async () => {
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runPeerSyncMock).toHaveBeenCalledTimes(2)
  })

  it('skips the sync call when multi-device mode is off', async () => {
    isMultiDeviceEnabledMock.mockReturnValue(false)
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runPeerSyncMock).not.toHaveBeenCalled()
  })

  it('skips the sync call when the tab is hidden', async () => {
    setVisibility('hidden')
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runPeerSyncMock).not.toHaveBeenCalled()
  })

  it('rescheduleSyncPolling applies a newly configured interval immediately', async () => {
    startSyncPolling()
    await vi.advanceTimersByTimeAsync(30 * 60_000) // 30 of the original 60 min elapsed

    getSyncPollIntervalMinutesMock.mockReturnValue(10) // user tightens it to 10 min
    rescheduleSyncPolling()

    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runPeerSyncMock).toHaveBeenCalledTimes(1)
  })
})
