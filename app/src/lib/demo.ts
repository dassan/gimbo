import { validateDataFile } from '@/lib/storage/schema'
import type { DataFile } from '@/types'

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}

export async function loadDemoData(): Promise<DataFile> {
  const { default: data } = await import('@/assets/demo-data.json')
  // Same normalization path as an imported/seed file: fills in fields the fixture predates
  // (e.g. valuations, added in schema v3) instead of leaving them undefined at runtime.
  return validateDataFile(data)
}
