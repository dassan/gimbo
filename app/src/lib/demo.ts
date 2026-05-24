import demoDataJson from '@/assets/demo-data.json'
import type { DataFile } from '@/types'

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}

export const demoDataFile = demoDataJson as unknown as DataFile
