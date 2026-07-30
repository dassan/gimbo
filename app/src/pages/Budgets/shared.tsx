// Peças visuais compartilhadas entre a lista de caixinhas e a tela de detalhe.
// Protótipo de UI — ver nota em `mock.ts`.
import type { MockBudget } from './mock'

export function ProgressBar({
  progress,
  color,
  className = 'h-2',
}: {
  progress: number
  color: string
  className?: string
}) {
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-surface-container-high ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%`, backgroundColor: color }}
      />
    </div>
  )
}

export function BudgetAvatar({ budget, size = 'md' }: { budget: MockBudget; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-12 w-12 text-xl' : 'h-10 w-10 text-base'
  return (
    <div
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl`}
      style={{ backgroundColor: `${budget.color}1A` }}
      aria-hidden
    >
      <span>{budget.emoji}</span>
    </div>
  )
}
