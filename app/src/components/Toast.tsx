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
      //
      // bg-on-surface inverts to a pale mint in dark mode (see index.css .dark), which combined
      // with a hardcoded text-white left this illegible — same bug as TransactionDrawer's
      // TRANSFER/CREDIT_PAYMENT button; surface-container-highest/on-surface is the same pairing
      // used there, staying legible in both themes.
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-surface-container-highest px-4 py-3 text-xs text-on-surface shadow-ambient sm:bottom-6"
    >
      <span className="max-w-xs">{message}</span>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="shrink-0 rounded-full bg-on-surface/10 px-3 py-1 font-semibold text-on-surface transition-colors hover:bg-on-surface/20"
        >
          {actionLabel}
        </button>
      )}
      <button
        aria-label="dismiss"
        onClick={onDismiss}
        className="shrink-0 rounded-full p-0.5 text-on-surface/60 transition-colors hover:text-on-surface"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
