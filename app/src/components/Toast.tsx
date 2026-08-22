import { X } from 'lucide-react'

export interface ToastProps {
  message: string
  onDismiss: () => void
  actionLabel?: string
  onAction?: () => void
}

export default function Toast({ message, onDismiss, actionLabel, onAction }: ToastProps) {
  return (
    <div
      role="alert"
      // M-76 follow-up: no mobile a bottom nav (Navbar.tsx) é `fixed bottom-0 h-16 z-50` — com o
      // mesmo z-index, ela pintava por cima do toast (que ficava a só 24px da borda), escondendo
      // o botão de atualizar. `bottom-[calc(...)]` sobe o toast acima da nav + safe-area; `sm:`
      // volta ao `bottom-6` original, já que a bottom nav só existe abaixo do breakpoint `sm`.
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-on-surface px-4 py-3 text-xs text-white shadow-ambient sm:bottom-6"
    >
      <span className="max-w-xs">{message}</span>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="shrink-0 rounded-full bg-white/15 px-3 py-1 font-semibold text-white transition-colors hover:bg-white/25"
        >
          {actionLabel}
        </button>
      )}
      <button
        aria-label="dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded-full p-0.5 text-white/60 transition-colors hover:text-white"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
