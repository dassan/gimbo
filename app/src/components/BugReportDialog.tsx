import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronDown, ChevronUp, Bug, ShieldCheck } from 'lucide-react'
import { buildBugReportSnapshot, type SnapshotOptions, type DataShape } from '@/lib/telemetry'
import { useDataStore } from '@/store/useDataStore'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BugReportDialogProps {
  isOpen: boolean
  onClose: () => void
  prefillTitle?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_ISSUES_URL = 'https://github.com/dassan/MyFinanceApp/issues/new'

const DEFAULT_OPTIONS: SnapshotOptions = {
  includeNavigation: true,
  includeActions: true,
  includeErrors: true,
  includePerformance: true,
  includeDataShape: true,
}

// ─── URL builder ─────────────────────────────────────────────────────────────

function buildGitHubIssueUrl(title: string, snapshot: object, description: string): string {
  const snapshotJson = JSON.stringify(snapshot, null, 2)
  const body = `## Descrição\n\n${description}\n\n## Contexto técnico\n\n\`\`\`json\n${snapshotJson}\n\`\`\``
  const params = new URLSearchParams({ title: `Bug: ${title}`, body, labels: 'bug' })
  return `${GITHUB_ISSUES_URL}?${params.toString()}`
}

// ─── Shell ────────────────────────────────────────────────────────────────────
// Mounting BugReportContent only when isOpen=true ensures state resets naturally
// on each open, without needing setState inside a useEffect.

export default function BugReportDialog({
  isOpen,
  onClose,
  prefillTitle = '',
}: BugReportDialogProps) {
  if (!isOpen) return null
  return <BugReportContent onClose={onClose} prefillTitle={prefillTitle} />
}

// ─── Content (stateful) ───────────────────────────────────────────────────────

interface ContentProps {
  onClose: () => void
  prefillTitle: string
}

function BugReportContent({ onClose, prefillTitle }: ContentProps) {
  const { t } = useTranslation()
  const data = useDataStore((s) => s.data)

  const [description, setDescription] = useState('')
  const [options, setOptions] = useState<SnapshotOptions>(DEFAULT_OPTIONS)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Derive safe data shape (structural counts only — no financial values)
  const dataShape = useMemo<DataShape | undefined>(() => {
    if (!data) return undefined
    return {
      accountCount: data.accounts.length,
      transactionCount: data.transactions.length,
      categoryCount: data.categories.length,
      tagCount: data.tags.length,
      schemaVersion: data.schemaVersion,
      auditLogEntries: data.auditLog.length,
    }
  }, [data])

  const snapshot = useMemo(() => buildBugReportSnapshot(options, dataShape), [options, dataShape])

  function toggleOption(key: keyof SnapshotOptions) {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleSubmit() {
    const title = prefillTitle || description.slice(0, 80)
    const url = buildGitHubIssueUrl(title, snapshot, description)
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  const optionKeys = Object.keys(DEFAULT_OPTIONS) as (keyof SnapshotOptions)[]

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="relative flex w-full max-w-lg flex-col gap-5 rounded-3xl bg-white p-6 shadow-xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Bug size={18} className="text-primary" />
              </div>
              <div>
                <h2 id="bug-report-title" className="text-sm font-semibold text-on-surface">
                  {t('bugReport.title')}
                </h2>
                <p className="text-xs text-on-surface/50">{t('bugReport.privacyNote')}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-on-surface/40 hover:bg-surface-container-low hover:text-on-surface"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bug-description" className="text-xs font-medium text-on-surface/70">
              {t('bugReport.descriptionLabel')}
            </label>
            <textarea
              id="bug-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('bugReport.descriptionPlaceholder')}
              rows={4}
              className="w-full resize-none rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5 text-sm text-on-surface placeholder-on-surface/30 focus:border-primary focus:outline-none"
            />
          </div>

          {/* Snapshot options */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-on-surface/70">{t('bugReport.snapshotTitle')}</p>
            <div className="flex flex-col gap-1.5 rounded-xl bg-surface-container-low p-3">
              {optionKeys.map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={() => toggleOption(key)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="text-xs text-on-surface/70">
                    {t(`bugReport.${key}` as Parameters<typeof t>[0])}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Snapshot preview */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => setPreviewOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-on-surface/50 hover:text-on-surface"
            >
              {previewOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {previewOpen ? t('bugReport.snapshotCollapse') : t('bugReport.snapshotExpand')}
            </button>
            {previewOpen && (
              <pre className="max-h-48 overflow-auto rounded-xl bg-surface-container-low p-3 text-[10px] leading-relaxed text-on-surface/60">
                {JSON.stringify(snapshot, null, 2)}
              </pre>
            )}
          </div>

          {/* Privacy badge */}
          <div className="flex items-center gap-2 rounded-xl bg-primary/5 px-3 py-2">
            <ShieldCheck size={14} className="shrink-0 text-primary" />
            <p className="text-xs text-on-surface/60">{t('bugReport.privacyBadge')}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} className="text-sm text-on-surface/50 hover:text-on-surface">
              {t('bugReport.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={description.trim() === ''}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('bugReport.submit')}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
