import { cn } from '@/lib/utils'

export interface StatCardProps {
  label: string
  value: string
  icon?: React.ReactNode
  variant: 'income' | 'expense' | 'highlight'
  shadowClass: string
  // Only meaningful for variant "highlight": picks the filled background — primary green for a
  // positive figure, tertiary (design system's dark red) for a negative one. Used by Dashboard's
  // "Saldo Previsto" and NetWorth's "Patrimônio Líquido" — both a signed total, not a plain
  // income/expense magnitude.
  isNegative?: boolean
}

export default function StatCard({
  label,
  value,
  icon,
  variant,
  shadowClass,
  isNegative = false,
}: StatCardProps) {
  const isHighlight = variant === 'highlight'
  return (
    <div
      className={cn(
        'rounded-2xl p-5',
        isHighlight
          ? isNegative
            ? 'bg-tertiary text-white'
            : 'bg-primary text-white'
          : 'bg-surface-container',
        !isHighlight && shadowClass
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn('label', isHighlight ? 'text-white/60' : 'text-on-surface/40')}>
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              variant === 'income'
                ? 'bg-primary/10 text-primary'
                : variant === 'expense'
                  ? 'bg-tertiary/10 text-tertiary'
                  : 'bg-white/20 text-white'
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          'text-2xl font-bold tabular-nums',
          isHighlight ? 'text-white' : variant === 'income' ? 'text-primary' : 'text-tertiary'
        )}
      >
        {value}
      </p>
    </div>
  )
}
