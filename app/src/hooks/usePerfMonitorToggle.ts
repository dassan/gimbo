import { useCallback, useEffect, useState } from 'react'
import { isPerfMonitorEnabled, setPerfMonitorEnabled } from '@/lib/perfMonitor'

/**
 * Atalho Alt+Shift+P para ligar/desligar o painel de performance em runtime, sem rebuild.
 * Vira no-op fora de DEV — o próprio import.meta.env.DEV elimina o corpo em produção.
 */
export function usePerfMonitorToggle(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(() => isPerfMonitorEnabled())

  const toggle = useCallback(() => {
    if (!import.meta.env.DEV) return
    const next = !isPerfMonitorEnabled()
    setPerfMonitorEnabled(next)
    setEnabled(next)
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    function handleKeydown(e: KeyboardEvent) {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'p') toggle()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [toggle])

  return [import.meta.env.DEV && enabled, toggle]
}
