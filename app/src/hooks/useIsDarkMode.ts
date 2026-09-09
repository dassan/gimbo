import { useEffect, useState } from 'react'

/**
 * Fonte de verdade é a classe `.dark` no `<html>` (App.tsx a aplica a partir de
 * workspace.theme/prefers-color-scheme) — não recalcula essa lógica, só observa o resultado.
 * Necessário para cores que recharts define via atributo SVG (`stroke`/`fill`), onde `var(--...)`
 * não é resolvido — só funciona dentro de CSS de verdade (stylesheet/`style`).
 */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}
