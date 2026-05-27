import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { trackNavigation } from '@/lib/telemetry'

/**
 * Registers every route change in the local telemetry ring buffer.
 * Call once inside AppLayout — no data leaves the device.
 */
export function useTrackNavigation(): void {
  const location = useLocation()

  useEffect(() => {
    trackNavigation(location.pathname)
  }, [location.pathname])
}
