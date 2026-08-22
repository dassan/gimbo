import { useEffect, useState } from 'react'

const QUERY = '(min-width: 640px)'

/**
 * Same breakpoint TransactionDrawer's own layout already switches on (`sm:` = 640px) —
 * keeps components that branch their rendering (not just their CSS) in sync with it.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && !window.matchMedia(QUERY).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isMobile
}
