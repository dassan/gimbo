import type { DataFile } from '@/types'

export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === 'true'
}

export async function loadDemoData(): Promise<DataFile> {
  const { default: data } = await import('@/assets/demo-data.json')
  return data as unknown as DataFile
}
