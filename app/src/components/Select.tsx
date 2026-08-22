import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import MobileSheet from '@/components/MobileSheet'

// dassan/ui-adjustments: on mobile, a native <select> opens the OS's own options sheet — dark
// theme, red/orange accent — which clashes with design/DESIGN.md. Desktop's native dropdown is
// plain enough to leave alone, so only the mobile trigger is replaced with a themed bottom sheet
// (same pattern DatePicker already uses for its own mobile/desktop split).

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className: string
  ariaLabel?: string
}

export default function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  ariaLabel,
}: SelectProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!isMobile) {
    return (
      <div className="relative">
        <select
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(className, 'w-full appearance-none')}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {options.length === 0 && <option value="">{placeholder}</option>}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
        />
      </div>
    )
  }

  const selected = options.find((o) => o.value === value)

  function handleSelect(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(className, 'w-full flex items-center justify-between gap-2 text-left')}
      >
        <span className={cn('truncate', !selected && 'text-on-surface/40')}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown
          size={16}
          className={cn('shrink-0 text-on-surface/40 transition-transform', open && 'rotate-180')}
        />
      </button>

      <MobileSheet
        open={open}
        onClose={() => setOpen(false)}
        role="listbox"
        ariaLabel={ariaLabel}
        contentClassName="px-3 pb-2"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            onClick={() => handleSelect(o.value)}
            className={cn(
              'w-full rounded-xl px-4 py-3 text-left text-sm transition-colors',
              o.value === value
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-on-surface hover:bg-surface-container-high'
            )}
          >
            {o.label}
          </button>
        ))}
        {options.length === 0 && (
          <p className="px-4 py-3 text-sm text-center text-on-surface/40">{placeholder}</p>
        )}
      </MobileSheet>
    </div>
  )
}
