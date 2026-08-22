import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// dassan/ui-adjustments: shared bottom-sheet shell so every mobile dropdown/picker (Select,
// DatePicker, TransactionDrawer's tags menu) looks and behaves identically — same backdrop,
// same rounded-t-3xl + shadow-card-ambient sheet, same drag handle.

export interface MobileSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  contentClassName?: string
  role?: string
  ariaLabel?: string
}

export default function MobileSheet({
  open,
  onClose,
  children,
  contentClassName,
  role,
  ariaLabel,
}: MobileSheetProps) {
  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />
      <div
        role={role}
        aria-label={ariaLabel}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-3xl bg-surface-container-low shadow-card-ambient pb-[max(env(safe-area-inset-bottom),16px)]"
      >
        <div className="sticky top-0 flex justify-center bg-surface-container-low pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-on-surface/20" />
        </div>
        <div className={cn(contentClassName)}>{children}</div>
      </div>
    </>
  )
}
