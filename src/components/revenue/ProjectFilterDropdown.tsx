'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, Minus } from 'lucide-react'
import { cn, formatVND } from '@/lib/utils'

export interface FilterProject {
  project_id: string
  name: string
  isActive: boolean
  monthlyRevenue: number
}

interface Props {
  projects: FilterProject[]
  selectedIds: Set<string>   // empty Set = show all
  onApply: (ids: Set<string>) => void
}

const ITEM_H = 38   // px, fixed height per row
const LIST_H = 220  // px, visible scroll area
const BUFFER = 3    // rows above/below viewport to pre-render

function HL({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  const matchRe = new RegExp(`^${escaped}$`, 'i')
  return <>
    {parts.map((p, i) =>
      matchRe.test(p)
        ? <mark key={i} className="bg-yellow-200 rounded-sm not-italic">{p}</mark>
        : p
    )}
  </>
}

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <div className={cn(
      'w-[14px] h-[14px] rounded border-[1.5px] flex items-center justify-center shrink-0 transition-all',
      checked || indeterminate ? 'bg-blue-500 border-blue-500' : 'border-slate-300 bg-white'
    )}>
      {indeterminate && <Minus size={8} className="text-white" strokeWidth={3} />}
      {!indeterminate && checked && <Check size={8} className="text-white" strokeWidth={3} />}
    </div>
  )
}

export default function ProjectFilterDropdown({ projects, selectedIds, onApply }: Props) {
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [scrollTop, setScrollTop] = useState(0)

  const wrapRef   = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce search 150ms
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(() => setDebouncedQ(query), 150)
  }, [query])

  // On open: sync draft + reset search + focus
  useEffect(() => {
    if (!open) return
    setDraft(new Set(selectedIds))
    setQuery(''); setDebouncedQ(''); setScrollTop(0)
    setTimeout(() => searchRef.current?.focus(), 30)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (open && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Esc closes, Enter applies
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (!open) return
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key === 'Enter' && document.activeElement !== searchRef.current) apply()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, draft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered + grouped rows
  const filtered = useMemo(() => {
    const q = debouncedQ.toLowerCase()
    return q ? projects.filter(p => p.name.toLowerCase().includes(q)) : projects
  }, [projects, debouncedQ])

  type VRow = { k: 'group'; label: string } | { k: 'item'; p: FilterProject }
  const rows = useMemo<VRow[]>(() => {
    if (debouncedQ) return filtered.map(p => ({ k: 'item', p }))
    const active   = filtered.filter(p => p.isActive)
    const inactive = filtered.filter(p => !p.isActive)
    const out: VRow[] = []
    if (active.length)   { out.push({ k: 'group', label: `Đang hoạt động (${active.length})` }); active.forEach(p => out.push({ k: 'item', p })) }
    if (inactive.length) { out.push({ k: 'group', label: `Không hoạt động (${inactive.length})` }); inactive.forEach(p => out.push({ k: 'item', p })) }
    return out
  }, [filtered, debouncedQ])

  // Virtual window
  const startI = Math.max(0, Math.floor(scrollTop / ITEM_H) - BUFFER)
  const endI   = Math.min(rows.length - 1, Math.ceil((scrollTop + LIST_H) / ITEM_H) + BUFFER)

  // Checkbox helpers
  const allChecked  = filtered.length > 0 && filtered.every(p => draft.has(p.project_id))
  const someChecked = !allChecked && filtered.some(p => draft.has(p.project_id))

  function toggleAll() {
    setDraft(prev => {
      const next = new Set(prev)
      if (allChecked) filtered.forEach(p => next.delete(p.project_id))
      else            filtered.forEach(p => next.add(p.project_id))
      return next
    })
  }

  function toggleItem(id: string) {
    setDraft(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function apply() { onApply(draft); setOpen(false) }

  function clearAll(e: React.MouseEvent) {
    e.stopPropagation()
    onApply(new Set())
  }

  // Trigger display
  const n = selectedIds.size
  const triggerLabel = n === 0
    ? 'Tất cả dự án'
    : n === 1
      ? (projects.find(p => selectedIds.has(p.project_id))?.name ?? '1 dự án')
      : 'Đã chọn'

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg border text-xs bg-white transition-all min-w-[210px]',
          open
            ? 'border-blue-400 ring-2 ring-blue-100'
            : 'border-slate-200 hover:border-blue-300'
        )}
      >
        <span className="flex-1 text-left font-medium text-slate-700 truncate">{triggerLabel}</span>
        {n >= 2 && (
          <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0">{n}</span>
        )}
        {n > 0 && (
          <span
            role="button"
            onClick={clearAll}
            className="w-4 h-4 rounded-full bg-slate-200 hover:bg-slate-300 flex items-center justify-center text-slate-500 text-[10px] shrink-0"
          >✕</span>
        )}
        <ChevronDown size={11} className={cn('text-slate-400 shrink-0 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 w-80 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Tìm nhanh dự án..."
              className="flex-1 text-xs text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setDebouncedQ('') }}
                className="text-slate-300 hover:text-slate-500 text-xs leading-none"
              >✕</button>
            )}
          </div>

          {/* Select-all row */}
          <button
            onClick={toggleAll}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left"
          >
            <Checkbox checked={allChecked} indeterminate={someChecked} />
            <span className="text-xs font-semibold text-slate-700">Tất cả ({filtered.length} dự án)</span>
          </button>

          {/* Virtual scroll list */}
          <div
            onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
            className="overflow-y-auto scrollbar-thin"
            style={{ height: LIST_H }}
          >
            {rows.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-slate-400">Không tìm thấy dự án nào</div>
            ) : (
              <div style={{ position: 'relative', height: rows.length * ITEM_H }}>
                {rows.slice(startI, endI + 1).map((row, vi) => {
                  const i = startI + vi
                  const style = { position: 'absolute' as const, top: i * ITEM_H, left: 0, right: 0, height: ITEM_H }

                  if (row.k === 'group') {
                    return (
                      <div
                        key={`g${i}`}
                        style={style}
                        className="flex items-center px-3.5 text-[10px] font-bold text-slate-400 uppercase tracking-wide bg-slate-50"
                      >
                        {row.label}
                      </div>
                    )
                  }

                  const { p } = row
                  const sel = draft.has(p.project_id)
                  return (
                    <div
                      key={p.project_id}
                      style={style}
                      onClick={() => toggleItem(p.project_id)}
                      className={cn(
                        'flex items-center gap-2.5 px-3.5 cursor-pointer transition-colors',
                        sel ? 'bg-blue-50' : 'hover:bg-slate-50'
                      )}
                    >
                      <Checkbox checked={sel} />
                      <span className={cn('flex-1 text-xs truncate', sel ? 'font-medium text-slate-800' : 'text-slate-600')}>
                        <HL text={p.name} query={debouncedQ} />
                      </span>
                      <span className={cn('text-[11px] font-semibold shrink-0', p.monthlyRevenue > 0 ? 'text-green-600' : 'text-slate-300')}>
                        {p.monthlyRevenue > 0 ? formatVND(p.monthlyRevenue) : '$0.00'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-100 bg-slate-50">
            <span className="text-[11px] text-slate-400">
              Đã chọn <span className="text-blue-500 font-semibold">{draft.size === 0 ? 'tất cả' : draft.size}</span> dự án
            </span>
            <button
              onClick={apply}
              className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors"
            >
              Áp dụng
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
