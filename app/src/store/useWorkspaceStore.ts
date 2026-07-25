import { create } from 'zustand'
import type { WorkspaceFile, Theme, Locale, Currency, IncomeWindowMonths } from '@/types'
import { loadWorkspace, saveWorkspace, defaultCurrencyForLocale } from '@/lib/storage/workspace'
import { createDefaultWorkspace } from '@/lib/storage/schema'
import { setCurrencyDefaults } from '@/lib/utils'

interface WorkspaceStore {
  workspace: WorkspaceFile

  init: () => void
  setTheme: (theme: Theme) => void
  setLocale: (locale: Locale) => void
  setCurrency: (currency: Currency) => void
  setDefaultView: (view: string) => void
  setAmbientShadows: (v: boolean) => void
  setNetWorthIncludeHidden: (v: boolean) => void
  setMonthlyIncomeOverride: (v: number | undefined) => void
  setIncomeWindowMonths: (v: IncomeWindowMonths) => void
  setMonthlyCostOverride: (v: number | undefined) => void
  setReserveTargetMonths: (v: IncomeWindowMonths) => void
}

const _initialWorkspace = createDefaultWorkspace()
setCurrencyDefaults(_initialWorkspace.locale, _initialWorkspace.currency)

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspace: _initialWorkspace,

  init: () => {
    const saved = loadWorkspace()
    if (!saved) return
    const merged = { ...createDefaultWorkspace(), ...saved }
    // B-25: workspaces saved before the currency preference existed have no `currency` key at
    // all, so the spread above silently falls back to createDefaultWorkspace()'s *current*
    // browser-detected locale — which can disagree with the user's actually saved `locale`
    // (e.g. they explicitly switched to en-US, but the browser itself still reports pt-BR).
    // Backfilling from the resolved `merged.locale` instead keeps the default correct.
    if (!('currency' in saved)) {
      merged.currency = defaultCurrencyForLocale(merged.locale)
    }
    set({ workspace: merged })
    setCurrencyDefaults(merged.locale, merged.currency)
  },

  setTheme: (theme) => {
    const workspace = { ...get().workspace, theme }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setLocale: (locale) => {
    const workspace = { ...get().workspace, locale }
    set({ workspace })
    saveWorkspace(workspace)
    setCurrencyDefaults(workspace.locale, workspace.currency)
  },

  setCurrency: (currency) => {
    const workspace = { ...get().workspace, currency }
    set({ workspace })
    saveWorkspace(workspace)
    setCurrencyDefaults(workspace.locale, workspace.currency)
  },

  setDefaultView: (defaultView) => {
    const workspace = { ...get().workspace, defaultView }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setAmbientShadows: (useAmbientShadows) => {
    const workspace = { ...get().workspace, useAmbientShadows }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setNetWorthIncludeHidden: (netWorthIncludeHidden) => {
    const workspace = { ...get().workspace, netWorthIncludeHidden }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setMonthlyIncomeOverride: (monthlyIncomeOverride) => {
    const workspace = { ...get().workspace, monthlyIncomeOverride }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setIncomeWindowMonths: (incomeWindowMonths) => {
    const workspace = { ...get().workspace, incomeWindowMonths }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setMonthlyCostOverride: (monthlyCostOverride) => {
    const workspace = { ...get().workspace, monthlyCostOverride }
    set({ workspace })
    saveWorkspace(workspace)
  },

  setReserveTargetMonths: (reserveTargetMonths) => {
    const workspace = { ...get().workspace, reserveTargetMonths }
    set({ workspace })
    saveWorkspace(workspace)
  },
}))
