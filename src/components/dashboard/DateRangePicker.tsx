'use client'

import { DateRange } from '@/lib/types'
import { formatDate } from '@/lib/utils'

interface Props {
  value: DateRange
  onChange: (range: DateRange) => void
}

const presets = [
  { label: 'Hôm nay', days: 0 },
  { label: '7 ngày', days: 6 },
  { label: '30 ngày', days: 29 },
]

function today() {
  return new Date('2026-06-21')
}

export default function DateRangePicker({ value, onChange }: Props) {
  function applyPreset(days: number) {
    const to = today()
    const from = new Date(today())
    from.setDate(from.getDate() - days)
    onChange({ from, to })
  }

  function handleFrom(e: React.ChangeEvent<HTMLInputElement>) {
    const from = new Date(e.target.value + 'T00:00:00')
    if (!isNaN(from.getTime()) && from <= value.to) {
      onChange({ ...value, from })
    }
  }

  function handleTo(e: React.ChangeEvent<HTMLInputElement>) {
    const to = new Date(e.target.value + 'T00:00:00')
    if (!isNaN(to.getTime()) && to >= value.from) {
      onChange({ ...value, to })
    }
  }

  const fromStr = value.from.toISOString().split('T')[0]
  const toStr = value.to.toISOString().split('T')[0]

  return (
    <div className="flex items-center gap-2">
      {presets.map(p => (
        <button
          key={p.label}
          onClick={() => applyPreset(p.days)}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-md px-3 py-1.5">
        <input
          type="date"
          value={fromStr}
          onChange={handleFrom}
          className="text-xs text-slate-700 outline-none bg-transparent"
        />
        <span className="text-slate-400 text-xs">→</span>
        <input
          type="date"
          value={toStr}
          onChange={handleTo}
          className="text-xs text-slate-700 outline-none bg-transparent"
        />
      </div>
    </div>
  )
}
