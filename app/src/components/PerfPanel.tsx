import { useEffect, useMemo, useState } from 'react'
import { X, Trash2, Copy } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { getSnapshot, clearBuffer, buildBugReportSnapshot, type PerfEvent } from '@/lib/telemetry'

export interface PerfPanelProps {
  onClose: () => void
}

interface MetricStats {
  metric: string
  count: number
  avg: number
  p95: number
  max: number
}

function aggregate(events: PerfEvent[]): MetricStats[] {
  const byMetric = new Map<string, number[]>()
  for (const e of events) {
    const list = byMetric.get(e.metric) ?? []
    list.push(e.ms)
    byMetric.set(e.metric, list)
  }
  return Array.from(byMetric.entries())
    .map(([metric, values]) => {
      const sorted = [...values].sort((a, b) => a - b)
      const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
      return {
        metric,
        count: sorted.length,
        avg: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
        p95: sorted[p95Index],
        max: sorted[sorted.length - 1],
      }
    })
    .sort((a, b) => b.avg - a.avg)
}

/**
 * Overlay dev-only: agrega e visualiza os PerfEvent coletados por measure()/measureAsync()
 * (lib/perfMonitor.ts) sobre o buffer de lib/telemetry.ts. Nunca monta em produção — quem
 * decide isso é o import.meta.env.DEV em AppLayout.tsx, não este componente.
 */
function readPerfEvents(): PerfEvent[] {
  return getSnapshot().filter((e): e is PerfEvent => e.type === 'performance')
}

export default function PerfPanel({ onClose }: PerfPanelProps) {
  const [events, setEvents] = useState<PerfEvent[]>(readPerfEvents)

  useEffect(() => {
    const id = setInterval(() => setEvents(readPerfEvents()), 1000)
    return () => clearInterval(id)
  }, [])

  const stats = useMemo(() => aggregate(events), [events])
  const recent = useMemo(() => [...events].sort((a, b) => b.ms - a.ms).slice(0, 15), [events])

  function refresh() {
    setEvents(readPerfEvents())
  }

  function handleClear() {
    clearBuffer()
    refresh()
  }

  function handleCopy() {
    const snapshot = buildBugReportSnapshot({
      includeNavigation: false,
      includeActions: false,
      includeErrors: false,
      includePerformance: true,
      includeDataShape: false,
    })
    void navigator.clipboard.writeText(JSON.stringify(snapshot.performance, null, 2))
  }

  return (
    <div className="fixed bottom-6 left-6 z-50 w-96 max-h-[70vh] overflow-y-auto rounded-xl bg-on-surface p-3 text-xs text-white shadow-ambient">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">Perf Monitor (Alt+Shift+P)</span>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            className="rounded-full px-2 py-0.5 text-white/70 hover:text-white"
          >
            ↻
          </button>
          <button
            aria-label="copy"
            onClick={handleCopy}
            className="rounded-full p-1 text-white/70 hover:text-white"
          >
            <Copy size={14} strokeWidth={2} />
          </button>
          <button
            aria-label="clear"
            onClick={handleClear}
            className="rounded-full p-1 text-white/70 hover:text-white"
          >
            <Trash2 size={14} strokeWidth={2} />
          </button>
          <button
            aria-label="close"
            onClick={onClose}
            className="rounded-full p-1 text-white/70 hover:text-white"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {stats.length === 0 ? (
        <p className="text-white/60">Nenhum evento ainda — dispare uma ação instrumentada.</p>
      ) : (
        <>
          <div className="mb-3 h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" hide />
                <YAxis
                  type="category"
                  dataKey="metric"
                  width={140}
                  tick={{ fontSize: 9, fill: '#fff' }}
                />
                <Tooltip
                  formatter={(value) => `${Number(value).toFixed(1)}ms`}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="avg" fill="#60a5fa" radius={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <table className="mb-3 w-full text-left">
            <thead className="text-white/50">
              <tr>
                <th className="pb-1 font-normal">métrica</th>
                <th className="pb-1 font-normal">n</th>
                <th className="pb-1 font-normal">avg</th>
                <th className="pb-1 font-normal">p95</th>
                <th className="pb-1 font-normal">max</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.metric} className="border-t border-white/10">
                  <td className="py-1 pr-2">{s.metric}</td>
                  <td className="py-1 pr-2">{s.count}</td>
                  <td className="py-1 pr-2">{s.avg.toFixed(1)}</td>
                  <td className="py-1 pr-2">{s.p95.toFixed(1)}</td>
                  <td className="py-1">{s.max.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mb-1 text-white/50">últimos eventos</p>
          <ul className="space-y-0.5">
            {recent.map((e, i) => (
              <li key={`${e.ts}-${i}`} className="flex justify-between">
                <span className="truncate pr-2">{e.metric}</span>
                <span className="shrink-0 tabular-nums">{e.ms.toFixed(1)}ms</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
