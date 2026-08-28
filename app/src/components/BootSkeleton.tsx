import { useLayoutEffect } from 'react'
import { markShellVisible } from '@/lib/bootMetrics'

/**
 * M-90 — o que a tela mostra enquanto o cofre é lido do OPFS.
 *
 * Antes daqui, `App.tsx` renderizava literalmente nada até `hydrated` virar true: num cofre real
 * de ~26 mil transações isso são ~2,8s de fundo vazio (`M-87`), que o usuário lê como travamento.
 * O tempo total não muda com esta tela — o que muda é quando a primeira coisa aparece: ~150ms em
 * vez de 2.802ms, porque nada aqui depende de dado nenhum. É o mesmo movimento do `CS-52`, que
 * tirou a publicação do caminho percebido sem torná-la mais rápida.
 *
 * **Silhueta, não spinner**: as medidas espelham as do `Navbar`/`AppLayout` reais (header `h-14`,
 * bottom nav `h-16` no mobile, container `max-w-7xl`), para que a troca pelo conteúdo real não
 * produza salto de layout. Se aquelas medidas mudarem, esta tela precisa acompanhar — é o custo
 * conhecido de uma silhueta, aceito em troca da ausência de reflow.
 *
 * O tema já está correto quando isto pinta: o efeito de tema do `App.tsx` não depende de dado, roda
 * na montagem e aplica a classe `dark` antes deste primeiro paint (é por isso que hoje se vê o
 * fundo verde-escuro, e não branco, durante a espera).
 *
 * `aria-busy`/`role="status"` para que leitores de tela anunciem carregamento em vez de lerem uma
 * página vazia. Os blocos são puramente decorativos (`aria-hidden`).
 */
export default function BootSkeleton() {
  useLayoutEffect(() => {
    markShellVisible()
  }, [])

  return (
    <div role="status" aria-busy="true" aria-live="polite" className="min-h-screen bg-surface">
      <span className="sr-only">Carregando seu cofre…</span>

      {/* Header — mesmas medidas do <header> do Navbar */}
      <header className="fixed top-0 right-0 left-0 z-50 flex h-14 items-center justify-between border-b border-outline-variant/50 bg-surface-container-low/80 px-6 backdrop-blur-[24px]">
        <div className="flex items-center gap-8">
          <span className="text-xl font-semibold tracking-tight">
            <span className="text-primary">Gim</span>
            <span style={{ color: '#D4A017' }}>bo</span>
          </span>
          <nav aria-hidden className="hidden items-center gap-1 sm:flex">
            {[64, 88, 72, 80, 76, 68].map((w, i) => (
              <div key={i} className="px-3 py-2">
                <div
                  className="h-3 animate-pulse rounded-full bg-on-surface/10"
                  style={{ width: w }}
                />
              </div>
            ))}
          </nav>
        </div>
        <div aria-hidden className="flex items-center gap-2">
          <div className="h-8 w-8 animate-pulse rounded-full bg-on-surface/10" />
          <div className="h-8 w-28 animate-pulse rounded-full bg-on-surface/10" />
        </div>
      </header>

      {/* Conteúdo — mesmo container do Dashboard (max-w-7xl), mesmo pt-14 do <main> */}
      <main aria-hidden className="pt-14 max-sm:pb-[calc(4rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:space-y-6 sm:px-6 sm:py-8">
          <div className="h-8 w-56 animate-pulse rounded-xl bg-on-surface/10" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-container" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-2xl bg-surface-container" />
            ))}
          </div>
        </div>
      </main>

      {/* Bottom nav — só mobile, mesmas medidas do Navbar */}
      <div
        aria-hidden
        className="fixed right-0 bottom-0 left-0 z-50 border-t border-outline-variant/50 bg-surface-container-low/95 backdrop-blur-[24px] sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex h-16 items-stretch">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-center gap-1.5">
              <div className="h-5 w-5 animate-pulse rounded-lg bg-on-surface/10" />
              <div className="h-2 w-10 animate-pulse rounded-full bg-on-surface/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
