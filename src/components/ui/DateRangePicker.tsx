'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function localStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function today(): string { return localStr(new Date()) }

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localStr(d)
}

function fmtDisplay(s: string): string {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function parseDisplay(s: string): string | null {
  // "DD/MM/YYYY" → "YYYY-MM-DD"
  const parts = s.split('/')
  if (parts.length !== 3 || parts[2].length !== 4) return null
  const iso = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return iso
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - dow)
  return d
}

const MONTH_NAMES = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
  'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']
const DOW_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function getCalendarDays(year: number, month: number): (string | null)[] {
  const firstDow = new Date(year, month, 1).getDay()
  const startOffset = firstDow === 0 ? 6 : firstDow - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = Array(startOffset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

// ─── Presets ─────────────────────────────────────────────────────────────────

function buildPresets() {
  const t = today()
  const now = new Date(t + 'T00:00:00')

  const yesterday = addDays(t, -1)

  const mon = mondayOf(now)
  const weekStart = localStr(mon)

  const lastMon = new Date(mon)
  lastMon.setDate(lastMon.getDate() - 7)
  const lastSun = new Date(lastMon)
  lastSun.setDate(lastSun.getDate() + 6)

  const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1)

  return [
    { label: 'Hôm nay', from: t, to: t },
    { label: 'Hôm qua', from: yesterday, to: yesterday },
    { label: 'Tuần này (T2 – Hôm nay)', from: weekStart, to: t },
    { label: '7 ngày qua', from: addDays(t, -6), to: t },
    { label: 'Tuần trước (T2 – CN)', from: localStr(lastMon), to: localStr(lastSun) },
    { label: '14 ngày qua', from: addDays(t, -13), to: t },
    { label: 'Tháng này', from: firstOfMonth, to: t },
    { label: '30 ngày qua', from: addDays(t, -29), to: t },
    { label: 'Tháng trước', from: localStr(prevMonthStart), to: localStr(prevMonthEnd) },
    { label: 'Từ đầu đến nay', from: '2020-01-01', to: t },
  ]
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  from: string
  to: string
  onApply: (from: string, to: string) => void
}

export default function DateRangePicker({ from, to, onApply }: Props) {
  const t = today()
  const initMonth = () => {
    const d = new Date(to + 'T00:00:00')
    return { year: d.getFullYear(), month: d.getMonth() }
  }

  const [open, setOpen] = useState(false)
  const [tempFrom, setTempFrom] = useState(from)
  const [tempTo, setTempTo] = useState(to)
  const [selecting, setSelecting] = useState<'from' | 'to'>('from')
  const [hoverDate, setHoverDate] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(initMonth().year)
  const [viewMonth, setViewMonth] = useState(initMonth().month)
  const [fromInput, setFromInput] = useState(fmtDisplay(from))
  const [toInput, setToInput] = useState(fmtDisplay(to))
  const panelRef = useRef<HTMLDivElement>(null)
  const presets = buildPresets()

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Sync when props change externally
  useEffect(() => {
    if (!open) {
      setTempFrom(from); setTempTo(to)
      setFromInput(fmtDisplay(from)); setToInput(fmtDisplay(to))
    }
  }, [from, to, open])

  function openPanel() {
    const d = new Date(to + 'T00:00:00')
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
    setTempFrom(from); setTempTo(to)
    setFromInput(fmtDisplay(from)); setToInput(fmtDisplay(to))
    setSelecting('from')
    setHoverDate(null)
    setOpen(true)
  }

  function applyPreset(pf: string, pt: string) {
    onApply(pf, pt)
    setOpen(false)
  }

  function handleDayClick(day: string) {
    if (selecting === 'from') {
      setTempFrom(day); setTempTo(day)
      setFromInput(fmtDisplay(day)); setToInput(fmtDisplay(day))
      setSelecting('to')
    } else {
      let f = tempFrom, t2 = day
      if (day < tempFrom) { f = day; t2 = tempFrom }
      setTempFrom(f); setTempTo(t2)
      setFromInput(fmtDisplay(f)); setToInput(fmtDisplay(t2))
      setSelecting('from')
      setHoverDate(null)
    }
  }

  function handleFromInput(val: string) {
    setFromInput(val)
    const iso = parseDisplay(val)
    if (iso) { setTempFrom(iso); setSelecting('to') }
  }

  function handleToInput(val: string) {
    setToInput(val)
    const iso = parseDisplay(val)
    if (iso) setTempTo(iso)
  }

  function navMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewMonth(m); setViewYear(y)
  }

  const cells = getCalendarDays(viewYear, viewMonth)

  // Effective range end for hover preview
  const effectiveTo = useCallback((day: string) => {
    if (selecting !== 'to' || !hoverDate) return tempTo
    if (hoverDate >= tempFrom) return hoverDate
    return tempFrom
  }, [selecting, hoverDate, tempFrom, tempTo])

  function dayClass(day: string): string {
    const eff = effectiveTo(day)
    const rangeFrom = selecting === 'to' && hoverDate ? (hoverDate >= tempFrom ? tempFrom : hoverDate) : tempFrom
    const rangeTo = selecting === 'to' && hoverDate ? (hoverDate >= tempFrom ? hoverDate : tempFrom) : tempTo

    const isStart = day === rangeFrom
    const isEnd = day === rangeTo
    const inRange = day > rangeFrom && day < rangeTo
    const isToday = day === t
    void eff

    if (isStart && isEnd) return 'bg-blue-600 text-white rounded-full'
    if (isStart) return 'bg-blue-600 text-white rounded-l-full'
    if (isEnd) return 'bg-blue-600 text-white rounded-r-full'
    if (inRange) return 'bg-blue-100 text-blue-800'
    if (isToday) return 'text-blue-600 font-bold underline hover:bg-slate-100 rounded-full'
    return 'hover:bg-slate-100 rounded-full'
  }

  const isActivePreset = (pf: string, pt: string) => pf === from && pt === to

  return (
    <div ref={panelRef} className="relative">
      {/* Trigger */}
      <button onClick={openPanel}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors bg-white',
          open ? 'border-blue-400 ring-1 ring-blue-300 text-slate-700' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
        )}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-400 shrink-0">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span>{fmtDisplay(from)} — {fmtDisplay(to)}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-400">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-[100] bg-white border border-slate-200 rounded-xl shadow-2xl flex overflow-hidden min-w-[580px]">
          {/* Left: presets */}
          <div className="w-52 border-r border-slate-100 py-2 shrink-0 overflow-y-auto max-h-[400px]">
            {presets.map(p => (
              <button key={p.label} onClick={() => applyPreset(p.from, p.to)}
                className={cn(
                  'w-full text-left px-4 py-2 text-xs transition-colors',
                  isActivePreset(p.from, p.to)
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-slate-700 hover:bg-slate-50'
                )}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Right: calendar + date inputs + buttons */}
          <div className="flex flex-col flex-1">
            {/* Date inputs row */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-100">
              <div className="flex flex-col gap-0.5 flex-1">
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Ngày bắt đầu *</label>
                <input value={fromInput} onChange={e => handleFromInput(e.target.value)}
                  onClick={() => setSelecting('from')}
                  placeholder="DD/MM/YYYY"
                  className={cn(
                    'w-full px-2 py-1 text-xs border rounded-md outline-none font-mono',
                    selecting === 'from' ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200 focus:border-blue-300'
                  )} />
              </div>
              <span className="text-slate-300 mt-4">—</span>
              <div className="flex flex-col gap-0.5 flex-1">
                <label className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Ngày kết thúc *</label>
                <input value={toInput} onChange={e => handleToInput(e.target.value)}
                  onClick={() => setSelecting('to')}
                  placeholder="DD/MM/YYYY"
                  className={cn(
                    'w-full px-2 py-1 text-xs border rounded-md outline-none font-mono',
                    selecting === 'to' ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200 focus:border-blue-300'
                  )} />
              </div>
            </div>

            {/* Calendar */}
            <div className="px-4 py-3 flex-1">
              {/* Month nav */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => navMonth(-1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
                  ‹
                </button>
                <span className="text-sm font-medium text-slate-700">
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button onClick={() => navMonth(1)}
                  className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-500 transition-colors">
                  ›
                </button>
              </div>

              {/* Day of week headers */}
              <div className="grid grid-cols-7 mb-1">
                {DOW_LABELS.map(d => (
                  <div key={d} className="text-center text-[11px] font-medium text-slate-400 py-1">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((day, i) => (
                  <div key={i} className="flex items-center justify-center">
                    {day ? (
                      <button
                        onClick={() => handleDayClick(day)}
                        onMouseEnter={() => selecting === 'to' && setHoverDate(day)}
                        onMouseLeave={() => setHoverDate(null)}
                        className={cn(
                          'w-8 h-8 text-xs text-center transition-colors cursor-pointer select-none w-full',
                          dayClass(day)
                        )}>
                        {parseInt(day.split('-')[2])}
                      </button>
                    ) : (
                      <div className="w-8 h-8" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Selecting hint */}
            {selecting === 'to' && (
              <div className="px-4 pb-1">
                <p className="text-[11px] text-blue-500">Chọn ngày kết thúc</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100">
              <button onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50 transition-colors">
                Hủy
              </button>
              <button
                onClick={() => { onApply(tempFrom, tempTo); setOpen(false) }}
                disabled={!tempFrom || !tempTo || tempFrom > tempTo}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40 transition-colors font-medium">
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
