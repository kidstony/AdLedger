'use client'

import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import {
  Loader2, Banknote, Monitor,
  Search, Keyboard, CheckCircle2, Cloud, SlidersHorizontal, CircleCheck,
  RotateCcw, X,
} from 'lucide-react'
import { useRevenueGrid } from '@/hooks/useRevenueGrid'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import EditableCell from '@/components/revenue/EditableCell'
import ProjectFilterDropdown, { type FilterProject } from '@/components/revenue/ProjectFilterDropdown'
import RevenueSummaryCards from '@/components/revenue/RevenueSummaryCards'
import { cn, formatVND } from '@/lib/utils'
import DateRangePicker from '@/components/ui/DateRangePicker'

// ── date helpers ────────────────────────────────────────────────────────────
function fmtShort(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) }
function fmtMY(d: string)    { const [y,m] = d.split('-'); return `${m}/${y}` }
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type NoteModal    = { projectId: string; date: string; current: string }
type PayoutModal  = { projectId: string; date: string; start: string; end: string }
type UndoToast    = { items: Array<{ project_id: string; date: string }>; total: number; count: number; secondsLeft: number }

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <div className={cn(
      'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors select-none',
      checked ? 'bg-emerald-500 border-emerald-500' : indeterminate ? 'bg-white border-blue-400' : 'bg-white border-slate-300'
    )}>
      {checked && (
        <svg width="8" height="6" fill="none" viewBox="0 0 8 6">
          <path d="M1 3L3 5.5 7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && <div className="w-2 h-0.5 bg-blue-400 rounded" />}
    </div>
  )
}

// ── keyboard shortcut list ───────────────────────────────────────────────────
const SHORTCUTS = [
  { keys: 'Tab / Shift+Tab', desc: 'Phải / Trái' },
  { keys: '↑ ↓ ← →',        desc: 'Di chuyển ô' },
  { keys: 'Enter',           desc: 'Xuống hàng' },
  { keys: 'Ctrl+V',          desc: 'Dán hàng loạt (Excel)' },
  { keys: 'Ctrl+Z',          desc: 'Hoàn tác' },
  { keys: 'Ctrl+Shift+Z',    desc: 'Làm lại' },
  { keys: '/',               desc: 'Tìm nhanh trong bảng' },
  { keys: 'Esc',             desc: 'Xóa tìm kiếm' },
  { keys: 'Double-click',    desc: 'Gắn thẻ kỳ đối soát' },
]

export default function RevenuePage() {
  const { role } = useAuth()

  const {
    projects: allProjects, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    dates, gridData, revenueGrid, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    isLoading, saveStatus,
    canUndo, canRedo, toast, setToast,
    undo, redo,
    switchMode,
    customFrom, customTo, setCustomRange, refreshRevenue,
    updateCell, clearCell, bulkUpdateCells,
    saveNote, savePayout, confirmCell, revertCells, flushSave,
    statusMap, confirmedAtMap,
  } = useRevenueGrid()

  // Members chỉ nhập được dự án có effective input_revenue = true
  const projects = useMemo(
    () => role === 'member' ? allProjects.filter(p => p.effective_permissions?.input_revenue === true) : allProjects,
    [allProjects, role]
  )

  const { updateProject, isLoading: projectsLoading } = useProjectsContext()
  const memberHasAccess = role !== 'member' || (!projectsLoading && projects.length > 0)
  const tableRef        = useRef<HTMLTableElement>(null)
  const focusedCellRef  = useRef<{ pi: number; di: number } | null>(null)
  const searchRef       = useRef<HTMLInputElement>(null)

  const [searchQuery,       setSearchQuery]       = useState('')
  const [filterIds,         setFilterIds]         = useState<Set<string>>(new Set())
  const [noteModal,         setNoteModal]         = useState<NoteModal | null>(null)
  const [payoutModal,       setPayoutModal]       = useState<PayoutModal | null>(null)
  const [batchConfirmModal, setBatchConfirmModal] = useState(false)
  const [batchConfirmLoading, setBatchConfirmLoading] = useState(false)
  const [showShortcuts,     setShowShortcuts]     = useState(false)
  const [checkedProjectIds, setCheckedProjectIds] = useState<Set<string>>(new Set())
  const [undoToast,         setUndoToast]         = useState<UndoToast | null>(null)
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [showBatchAllConfirm, setShowBatchAllConfirm] = useState(false)
  const [batchAllSelected,    setBatchAllSelected]    = useState<Set<string>>(new Set())
  const [batchAllLoading,     setBatchAllLoading]     = useState(false)

  // Projects filtered by dropdown selection + inline search
  const filteredProjects = useMemo(() => {
    let result = projects
    if (filterIds.size > 0) result = result.filter(p => filterIds.has(p.project_id))
    const q = searchQuery.trim().toLowerCase()
    if (q) result = result.filter(p => p.name.toLowerCase().includes(q))
    return result
  }, [projects, filterIds, searchQuery])

  // Date range display values (from dates array, works for all modes)
  const isReadOnlyGlobal = viewMode === 'all'
  const rangeFrom = isReadOnlyGlobal ? '' : (dates[0] ?? '')
  const rangeTo   = isReadOnlyGlobal ? '' : (dates[dates.length - 1] ?? '')

  // Bind inputs to customFrom/customTo when in custom mode so the value
  // is always accurate (dates[] can be [] if from > to, hiding both inputs).
  const displayFrom = viewMode === 'custom' ? customFrom : rangeFrom
  const displayTo   = viewMode === 'custom' ? customTo   : rangeTo

  function handleFromChange(v: string) {
    if (!v) return
    const to = customTo || v
    setCustomRange(v, v > to ? v : to) // auto-clamp: if new from > to, collapse to = from
  }

  function handleToChange(v: string) {
    if (!v) return
    const from = customFrom || v
    setCustomRange(from > v ? v : from, v) // auto-clamp: if new to < from, collapse from = to
  }

  // Projects with ≥1 pending cell in current range (screen tab, non-all)
  const pendingProjectIds = useMemo(() => {
    if (activeTab !== 'screen' || isReadOnlyGlobal) return new Set<string>()
    return new Set(
      filteredProjects
        .filter(p => dates.some(d => (screenGrid.get(`${p.project_id}__${d}`) ?? 0) > 0))
        .map(p => p.project_id)
    )
  }, [activeTab, isReadOnlyGlobal, filteredProjects, dates, screenGrid])

  // All pending (project_id, date) pairs from checked projects
  const selectedPendingItems = useMemo(() => {
    const items: Array<{ project_id: string; date: string; amount: number }> = []
    checkedProjectIds.forEach(pid => {
      dates.forEach(d => {
        const key = `${pid}__${d}`
        const sv = screenGrid.get(key) ?? 0
        if (sv > 0) items.push({ project_id: pid, date: d, amount: sv })
      })
    })
    return items
  }, [checkedProjectIds, dates, screenGrid])

  const selectedPendingTotal = useMemo(
    () => selectedPendingItems.reduce((s, i) => s + i.amount, 0),
    [selectedPendingItems]
  )

  const selectedDateRange = useMemo(() => {
    if (selectedPendingItems.length === 0) return ''
    const ds = selectedPendingItems.map(i => i.date).sort()
    const from = ds[0], to = ds[ds.length - 1]
    const f = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
    if (from === to) return `ngày ${f(from)}`
    return `từ ${f(from)} đến ${f(to)}`
  }, [selectedPendingItems])

  // Clear checked when range/tab changes
  useEffect(() => { setCheckedProjectIds(new Set()) }, [dates, activeTab])

  function toggleProject(pid: string) {
    setCheckedProjectIds(prev => { const n = new Set(prev); n.has(pid) ? n.delete(pid) : n.add(pid); return n })
  }
  function toggleAllProjects() {
    const allChecked = [...pendingProjectIds].every(pid => checkedProjectIds.has(pid))
    setCheckedProjectIds(allChecked ? new Set() : new Set(pendingProjectIds))
  }

  function startUndoCountdown(data: Omit<UndoToast, 'secondsLeft'>) {
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current)
    setUndoToast({ ...data, secondsLeft: 10 })
    undoIntervalRef.current = setInterval(() => {
      setUndoToast(prev => {
        if (!prev || prev.secondsLeft <= 1) { clearInterval(undoIntervalRef.current!); return null }
        return { ...prev, secondsLeft: prev.secondsLeft - 1 }
      })
    }, 1000)
  }

  async function handleBatchConfirm() {
    setBatchConfirmLoading(true)
    const items = selectedPendingItems.map(i => ({ project_id: i.project_id, date: i.date, amount: i.amount }))
    const total = selectedPendingTotal
    const count = items.length
    const res = await fetch('/api/revenue/confirm-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    setBatchConfirmLoading(false)
    setBatchConfirmModal(false)
    if (res.ok) {
      setCheckedProjectIds(new Set())
      refreshRevenue()
      startUndoCountdown({ items, total, count })
    }
  }

  async function handleBatchAllConfirm() {
    const toConfirm = batchAllSelected.size > 0
      ? batchAllItems.filter(i => batchAllSelected.has(i.key))
      : batchAllItems
    const total = toConfirm.reduce((s, i) => s + i.confirmAmount, 0)
    const count = toConfirm.length
    setBatchAllLoading(true)
    const res = await fetch('/api/revenue/confirm-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: toConfirm.map(i => ({ project_id: i.project_id, date: i.date, amount: i.confirmAmount })) }),
    })
    setBatchAllLoading(false)
    if (res.ok) {
      setShowBatchAllConfirm(false)
      setBatchAllSelected(new Set())
      refreshRevenue()
      startUndoCountdown({ items: toConfirm.map(i => ({ project_id: i.project_id, date: i.date })), total, count })
    }
  }

  function showPageToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function handleUndo() {
    if (!undoToast) return
    clearInterval(undoIntervalRef.current!)
    const items = undoToast.items
    setUndoToast(null)
    const ok = await revertCells(items)
    if (ok) {
      showPageToast('Đã hoàn tác xác nhận')
    } else {
      showPageToast('Lỗi: Không thể hoàn tác. Vui lòng thử lại.')
    }
  }

  async function handleConfirmDirect(projectId: string, date: string, amount: number, projectName: string) {
    await flushSave()
    await confirmCell(projectId, date)
    refreshRevenue()
    startUndoCountdown({ items: [{ project_id: projectId, date }], total: amount, count: 1 })
  }

  async function handleRevertDirect(projectId: string, date: string, amount: number) {
    const ok = await revertCells([{ project_id: projectId, date }])
    if (ok) {
      refreshRevenue()
      showPageToast(`Đã hoàn tác ${formatVND(amount)}`)
    } else {
      showPageToast('Lỗi: Không thể hoàn tác. Vui lòng thử lại.')
    }
  }

  // Data for filter dropdown: compute per-project totals in current period
  const filterProjectData = useMemo<FilterProject[]>(() =>
    projects.map(p => {
      const total = dates.reduce((sum, d) => sum + (gridData.get(`${p.project_id}__${d}`) ?? 0), 0)
      return { project_id: p.project_id, name: p.name, isActive: total > 0, monthlyRevenue: total }
    }),
    [projects, gridData, dates]
  )

  // Per-project totals (respects cumulative delta logic, used for summary cards)
  const perProjectTotals = useMemo(() =>
    filteredProjects.map(p => {
      const total = dates.reduce((sum, d, di) => {
        const key = `${p.project_id}__${d}`
        if (viewMode !== 'all' && activeTab === 'screen' && p.screen_revenue_type === 'cumulative') {
          const curr     = screenGrid.get(key) ?? 0
          const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
          const prevKey  = `${p.project_id}__${prevDate}`
          const prev     = di === 0 ? (prevScreenMap.get(prevKey) ?? 0) : (screenGrid.get(prevKey) ?? 0)
          return sum + Math.max(0, curr - prev)
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
      return { project_id: p.project_id, name: p.name, total }
    }),
    [filteredProjects, dates, gridData, screenGrid, prevScreenMap, activeTab, viewMode]
  )

  // Pending / confirmed split for summary cards (screen tab only)
  const { pendingTotal, confirmedTotal } = useMemo(() => {
    if (activeTab !== 'screen') return { pendingTotal: undefined, confirmedTotal: undefined }
    let pending = 0, confirmed = 0
    filteredProjects.forEach(p => {
      dates.forEach((d, di) => {
        const key = `${p.project_id}__${d}`
        const isConfirmed = statusMap.get(key) === 'confirmed'
        let amount = 0
        if (p.screen_revenue_type === 'cumulative' && viewMode !== 'all') {
          const curr     = screenGrid.get(key) ?? 0
          const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
          const prevKey  = `${p.project_id}__${prevDate}`
          const prev     = di === 0 ? (prevScreenMap.get(prevKey) ?? 0) : (screenGrid.get(prevKey) ?? 0)
          amount = Math.max(0, curr - prev)
        } else {
          amount = screenGrid.get(key) ?? 0
        }
        if (isConfirmed) confirmed += amount
        else pending += amount
      })
    })
    return { pendingTotal: pending, confirmedTotal: confirmed }
  }, [activeTab, filteredProjects, dates, screenGrid, prevScreenMap, statusMap, viewMode])

  // Confirm items for the "Xác nhận hàng loạt" dialog.
  // Cumulative projects use delta (curr − prev) so the total equals the latest
  // running total, not a sum of every day's stored cumulative value.
  type BatchAllItem = {
    key: string; project_id: string; project_name: string; date: string
    rawAmount: number; confirmAmount: number; is_cumulative: boolean
  }
  const batchAllItems = useMemo((): BatchAllItem[] => {
    if (!showBatchAllConfirm) return []
    const prevDate = dates.length > 0 ? addDays(dates[0], -1) : ''
    return projects.flatMap(project => {
      const isCumulative = project.screen_revenue_type === 'cumulative'
      const entries = dates
        .map(d => ({ date: d, amount: screenGrid.get(`${project.project_id}__${d}`) ?? 0 }))
        .filter(e => e.amount > 0)
      if (entries.length === 0) return []
      const prevAmount = prevDate
        ? (prevScreenMap.get(`${project.project_id}__${prevDate}`) ?? 0)
        : 0
      return entries.map((e, i) => {
        const prev = isCumulative ? (i === 0 ? prevAmount : entries[i - 1].amount) : 0
        return {
          key: `${project.project_id}__${e.date}`,
          project_id: project.project_id,
          project_name: project.name,
          date: e.date,
          rawAmount: e.amount,
          confirmAmount: isCumulative ? Math.max(0, e.amount - prev) : e.amount,
          is_cumulative: isCumulative,
        }
      })
    })
  }, [showBatchAllConfirm, projects, dates, screenGrid, prevScreenMap])

  // ── keyboard shortcuts (global) ─────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo(); return }

      // Close batch confirm dialog on Escape
      if (e.key === 'Escape' && showBatchAllConfirm) { setShowBatchAllConfirm(false); return }

      // Search shortcut `/`
      if (e.key === '/' && !inInput) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearchQuery(''); searchRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo, showBatchAllConfirm])

  // ── totals (dynamic: only filtered projects) ─────────────────────────────────
  const dateTotals = useMemo(() =>
    dates.map((date, di) =>
      filteredProjects.reduce((sum, p) => {
        const key = `${p.project_id}__${date}`
        // In all-time view, gridData already contains correct monthly deltas for cumulative projects
        // so we just sum gridData directly. Daily delta logic only applies to day/week/month views.
        if (viewMode !== 'all' && activeTab === 'screen' && p.screen_revenue_type === 'cumulative') {
          const curr     = screenGrid.get(key) ?? 0
          const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
          const prevKey  = `${p.project_id}__${prevDate}`
          const prev     = di === 0 ? (prevScreenMap.get(prevKey) ?? 0) : (screenGrid.get(prevKey) ?? 0)
          return sum + Math.max(0, curr - prev)
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
    ),
    [dates, filteredProjects, gridData, screenGrid, prevScreenMap, activeTab, viewMode]
  )

  // ── navigation ──────────────────────────────────────────────────────────────
  function navigate(pi: number, di: number, dir: 'right' | 'left' | 'down' | 'up') {
    if (!filteredProjects.length) return
    let npi = pi, ndi = di
    if (dir === 'right')     { ndi++; if (ndi >= dates.length) { ndi = 0; npi = (pi + 1) % filteredProjects.length } }
    else if (dir === 'left') { ndi--; if (ndi < 0) { ndi = dates.length - 1; npi = (pi - 1 + filteredProjects.length) % filteredProjects.length } }
    else if (dir === 'down') npi = (pi + 1) % filteredProjects.length
    else                     npi = (pi - 1 + filteredProjects.length) % filteredProjects.length
    ndi = Math.max(0, Math.min(ndi, dates.length - 1))
    if (npi < 0 || npi >= filteredProjects.length) return
    focusedCellRef.current = { pi: npi, di: ndi }
    const key = `${filteredProjects[npi].project_id}__${dates[ndi]}`
    // Click the inner display div (cursor-text), not the wrapper — events don't bubble down
    const wrapper = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${key}"]`)
    ;(wrapper?.querySelector<HTMLElement>('.cursor-text') ?? wrapper)?.click()
  }

  function handlePaste(text: string) {
    const fc = focusedCellRef.current
    if (!fc) return
    const cells: { projectId: string; date: string; value: number }[] = []
    text.split('\n').filter(l => l.trim()).forEach((line, ri) => {
      const targetPi = fc.pi + ri
      if (targetPi >= filteredProjects.length) return
      line.split('\t').forEach((val, ci) => {
        const targetDi = fc.di + ci
        if (targetDi >= dates.length) return
        const num = parseFloat(val.trim().replace(/[^0-9.]/g, ''))
        if (!isNaN(num)) cells.push({ projectId: filteredProjects[targetPi].project_id, date: dates[targetDi], value: num })
      })
    })
    if (cells.length > 0) bulkUpdateCells(cells)
  }

  // cumulative delta helper
  function getCumulativeDelta(projectId: string, date: string, di: number) {
    const key       = `${projectId}__${date}`
    const cumulative = screenGrid.get(key) ?? 0
    const prevDate  = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
    const prevKey   = `${projectId}__${prevDate}`
    const prev      = di === 0 ? (prevScreenMap.get(prevKey) ?? 0) : (screenGrid.get(prevKey) ?? 0)
    return { delta: cumulative - prev, cumulative }
  }

  // column header display
  const colHeader = useCallback((date: string) =>
    viewMode === 'all' ? fmtMY(date) : fmtShort(date),
    [viewMode]
  )

  if (role === 'member' && !projectsLoading && projects.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-slate-600 font-medium">Bạn không có quyền nhập doanh thu</p>
        <p className="text-slate-400 text-sm mt-1">Hãy liên hệ quản trị viên để được cấp quyền.</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-xs px-4 py-2 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-800">Nhập doanh thu</h2>
          {/* Keyboard shortcut popover */}
          <div className="relative">
            <button
              onMouseEnter={() => setShowShortcuts(true)}
              onMouseLeave={() => setShowShortcuts(false)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-2 py-1 transition-colors"
            >
              <Keyboard size={12} /> Phím tắt
            </button>
            {showShortcuts && (
              <div
                onMouseEnter={() => setShowShortcuts(true)}
                onMouseLeave={() => setShowShortcuts(false)}
                className="absolute left-0 top-7 z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-3 w-64"
              >
                <table className="text-xs w-full">
                  <tbody>
                    {SHORTCUTS.map(s => (
                      <tr key={s.keys} className="border-b border-slate-50 last:border-0">
                        <td className="py-1 pr-3 font-mono text-slate-500 whitespace-nowrap">{s.keys}</td>
                        <td className="py-1 text-slate-700">{s.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Auto-save status */}
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Cloud size={13} className="animate-pulse" /> Đang lưu...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-xs text-green-500">
              <CheckCircle2 size={13} /> Đã lưu tất cả thay đổi
            </span>
          )}

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5 border border-slate-200 rounded-md overflow-hidden">
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Ctrl+Z"
              className={cn('px-2.5 py-1.5 text-xs transition-colors', canUndo ? 'text-slate-600 hover:bg-slate-50' : 'text-slate-300 cursor-not-allowed')}
            >↩ Hoàn tác</button>
            <div className="w-px h-4 bg-slate-200" />
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Ctrl+Shift+Z"
              className={cn('px-2.5 py-1.5 text-xs transition-colors', canRedo ? 'text-slate-600 hover:bg-slate-50' : 'text-slate-300 cursor-not-allowed')}
            >↪ Làm lại</button>
          </div>
        </div>
      </div>

      {/* ── Navigation bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Google Ads-style date range picker */}
        <DateRangePicker
          from={viewMode === 'all' ? '2020-01-01' : (displayFrom || today)}
          to={viewMode === 'all' ? today : (displayTo || today)}
          onApply={(f, t) => {
            const diffDays = Math.round(
              (new Date(t + 'T00:00:00Z').getTime() - new Date(f + 'T00:00:00Z').getTime()) / 86400000
            )
            if (diffDays > 62) {
              switchMode('all')
            } else {
              setCustomRange(f, t)
            }
          }}
        />

        {/* Revenue type tab */}
        <div className="ml-auto flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          <button
            onClick={() => setActiveTab('revenue')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'revenue' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Banknote size={12} /> Doanh thu thực
          </button>
          <button
            onClick={() => setActiveTab('screen')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'screen' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Monitor size={12} /> Tiền màn hình
          </button>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium shrink-0">
          <SlidersHorizontal size={12} />
          Lọc dự án:
        </div>
        <ProjectFilterDropdown
          projects={filterProjectData}
          selectedIds={filterIds}
          onApply={ids => {
            setFilterIds(ids)
            if (viewMode === 'all') switchMode('week')
          }}
        />
        <div className="w-px h-5 bg-slate-200 mx-1" />
        <span className="text-xs text-slate-400">
          {filteredProjects.length < projects.length
            ? <><span className="font-semibold text-slate-600">{filteredProjects.length}</span> / {projects.length} dự án</>
            : <span className="text-slate-400">Tất cả {projects.length} dự án</span>
          }
        </span>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <RevenueSummaryCards
        projectTotals={perProjectTotals}
        totalProjectCount={projects.length}
        dates={dates}
        viewMode={viewMode}
        anchorDate={anchorDate}
        pendingTotal={pendingTotal}
        confirmedTotal={confirmedTotal}
      />

      {/* ── Search + Table ─────────────────────────────────────────────────── */}
      <div className="relative border border-slate-200 rounded-lg overflow-hidden">
        {/* Batch confirm banner */}
        {activeTab === 'screen' && !isReadOnlyGlobal && checkedProjectIds.size > 0 && (
          <div className="bg-emerald-600 text-white px-4 py-2.5 flex items-center gap-3">
            <span className="text-sm font-semibold">{selectedPendingItems.length} khoản đã chọn</span>
            <span className="text-emerald-300 text-sm">·</span>
            <span className="text-sm font-bold">{formatVND(selectedPendingTotal)}</span>
            <button
              onClick={() => setCheckedProjectIds(new Set())}
              className="text-xs text-emerald-200 hover:text-white ml-1 transition-colors"
            >Bỏ chọn</button>
            <div className="flex-1" />
            <button
              onClick={() => setBatchConfirmModal(true)}
              disabled={selectedPendingItems.length === 0}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-emerald-700 rounded-md hover:bg-emerald-50 transition-colors disabled:opacity-50"
            >Xác nhận hàng loạt</button>
          </div>
        )}

        {/* Search bar above table */}
        <div className="sticky top-0 z-20 bg-white border-b border-slate-100 px-3 py-2 flex items-center gap-2">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder='Tìm nhanh dự án... (Phím /)'
            className="flex-1 text-xs text-slate-700 outline-none bg-transparent placeholder:text-slate-300"
          />
          {searchQuery && (
            <span className="text-xs text-slate-400">{filteredProjects.length}/{projects.length} dự án</span>
          )}
          {activeTab === 'screen' && !isReadOnlyGlobal && (
            <button
              onClick={() => { setShowBatchAllConfirm(true); setBatchAllSelected(new Set()) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors shrink-0"
            >
              <CircleCheck size={11} /> Xác nhận hàng loạt
            </button>
          )}
        </div>

        <div className="overflow-auto max-h-[calc(100vh-290px)]">
          {isLoading && (
            <div className="absolute inset-0 bg-white/70 z-30 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          )}
          <table ref={tableRef} className="text-sm border-collapse w-full">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium border-b border-r border-slate-200 w-52 min-w-[208px]">
                  <div className="flex items-center gap-2">
                    {activeTab === 'screen' && !isReadOnlyGlobal && pendingProjectIds.size > 0 && (
                      <div onClick={toggleAllProjects} className="cursor-pointer shrink-0">
                        <Checkbox
                          checked={[...pendingProjectIds].every(pid => checkedProjectIds.has(pid))}
                          indeterminate={checkedProjectIds.size > 0 && ![...pendingProjectIds].every(pid => checkedProjectIds.has(pid))}
                        />
                      </div>
                    )}
                    <span className="text-slate-500 uppercase tracking-wide text-[10px]">Dự án</span>
                  </div>
                </th>
                {dates.map(d => (
                  <th
                    key={d}
                    className={cn(
                      'px-3 py-2.5 text-center text-xs font-medium border-b border-slate-200 min-w-[110px]',
                      d === today ? 'bg-blue-50 text-blue-700' : 'text-slate-500'
                    )}
                  >
                    {colHeader(d)}
                    {d === today && <span className="ml-1 text-[10px] font-normal">(hôm nay)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProjects.length === 0 && (
                <tr>
                  <td colSpan={dates.length + 1} className="text-center py-12 text-sm text-slate-400">
                    Không tìm thấy dự án nào
                  </td>
                </tr>
              )}
              {filteredProjects.map((project, pi) => {
                const isCumulative = activeTab === 'screen' && project.screen_revenue_type === 'cumulative'
                const isReadOnly   = viewMode === 'all'
                const hasPending   = pendingProjectIds.has(project.project_id)

                return (
                  <tr key={project.project_id} className="border-b border-slate-100 hover:bg-slate-50/40">
                    <td className="sticky left-0 bg-white border-r border-slate-200 px-3 py-0 z-10">
                      <div className="flex items-center gap-1.5 py-2">
                        {activeTab === 'screen' && !isReadOnly && (
                          <div
                            className="shrink-0 cursor-pointer"
                            onClick={e => { e.stopPropagation(); if (hasPending) toggleProject(project.project_id) }}
                          >
                            {hasPending
                              ? <Checkbox checked={checkedProjectIds.has(project.project_id)} />
                              : <div className="w-4 h-4" />
                            }
                          </div>
                        )}
                        <span className="font-medium text-slate-700 text-xs truncate flex-1">{project.name}</span>
                        {activeTab === 'screen' && !isReadOnly && (
                          <button
                            onClick={() => updateProject({ ...project, screen_revenue_type: isCumulative ? 'daily' : 'cumulative' })}
                            className={cn(
                              'shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium transition-colors',
                              isCumulative
                                ? 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200'
                                : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                            )}
                          >{isCumulative ? 'Cộng dồn' : 'Hàng ngày'}</button>
                        )}
                      </div>
                    </td>
                    {dates.map((date, di) => {
                      const key         = `${project.project_id}__${date}`
                      const hasPayout   = activeTab === 'revenue' && payoutMap.has(key)
                      const hasNote     = noteMap.has(key)
                      const isConfirmed = statusMap.get(key) === 'confirmed'
                      const confirmedAt = confirmedAtMap.get(key)
                      const tdCls       = cn('p-0 border-r border-slate-100', date === today && 'bg-blue-50/30')

                      // ── Cumulative screen tab (pending) ──────────────────────
                      if (isCumulative && !isReadOnly) {
                        const { delta, cumulative } = getCumulativeDelta(project.project_id, date, di)
                        const rawValue = screenGrid.get(key)
                        const hasDelta = rawValue !== undefined
                        return (
                          <td key={date} className={tdCls}>
                            <div data-cell={key} className="h-11">
                              <EditableCell
                                value={rawValue}
                                onCommit={v => updateCell(project.project_id, date, v)}
                                onClear={() => clearCell(project.project_id, date)}
                                onNavigate={dir => navigate(pi, di, dir)}
                                onFocus={() => { focusedCellRef.current = { pi, di } }}
                                onPaste={handlePaste}
                                displayValue={hasDelta ? cumulative : undefined}
                                valueSubtitle={hasDelta && delta !== 0 ? `${delta > 0 ? '+' : ''}${formatVND(delta)} hôm nay` : undefined}
                                valueColorClass={delta < 0 ? 'text-red-600' : 'text-slate-700'}
                                hasNote={hasNote}
                                onNoteClick={() => setNoteModal({ projectId: project.project_id, date, current: noteMap.get(key) ?? '' })}
                                onConfirmClick={(hasDelta && cumulative > 0)
                                  ? () => handleConfirmDirect(project.project_id, date, cumulative, project.name)
                                  : undefined}
                              />
                            </div>
                          </td>
                        )
                      }

                      // ── Revenue tab + regular screen (daily pending) + read-only ──
                      const isRevTab = activeTab === 'revenue'
                      const cellValue = gridData.get(key)

                      const confirmedSub = isConfirmed
                        ? isRevTab && confirmedAt
                          ? `✓ ${new Date(confirmedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}`
                          : !isRevTab
                            ? `✓ Đã nhận ${formatVND(revenueGrid.get(key) ?? 0)}`
                            : undefined
                        : undefined

                      return (
                        <td key={date} className={tdCls}>
                          <div data-cell={key} className={confirmedSub ? 'h-11' : 'h-9'}>
                            {isReadOnly ? (
                              <div className="w-full h-full px-2 py-1.5 text-right font-mono text-xs font-medium text-slate-700">
                                {cellValue ? formatVND(cellValue) : <span className="opacity-30">$0.00</span>}
                              </div>
                            ) : (
                              <EditableCell
                                value={cellValue}
                                onCommit={v => updateCell(project.project_id, date, v)}
                                onClear={() => clearCell(project.project_id, date)}
                                onNavigate={dir => navigate(pi, di, dir)}
                                onFocus={() => { focusedCellRef.current = { pi, di } }}
                                onPaste={handlePaste}
                                valueSubtitle={confirmedSub}
                                hasPayout={hasPayout}
                                onDoubleClick={isRevTab ? () => {
                                  const ex = payoutMap.get(key)
                                  setPayoutModal({ projectId: project.project_id, date, start: ex?.start ?? '', end: ex?.end ?? date })
                                } : undefined}
                                onConfirmClick={(!isRevTab && !isConfirmed && (cellValue ?? 0) > 0)
                                  ? () => handleConfirmDirect(project.project_id, date, cellValue ?? 0, project.name)
                                  : undefined}
                                onRevertClick={(isRevTab && isConfirmed && (cellValue ?? 0) > 0)
                                  ? () => handleRevertDirect(project.project_id, date, cellValue ?? 0)
                                  : undefined}
                              />
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot className="sticky bottom-0 z-10 bg-slate-50 border-t-2 border-slate-200">
              <tr>
                <td className="sticky left-0 bg-slate-50 border-r border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide z-10">
                  Tổng {searchQuery ? `(${filteredProjects.length})` : ''}
                </td>
                {dateTotals.map((total, i) => (
                  <td key={dates[i]} className={cn('px-3 py-2 text-center text-xs font-semibold', dates[i] === today && 'bg-blue-50/50')}>
                    {total > 0 ? <span className="text-green-700">{formatVND(total)}</span> : <span className="opacity-20">$0.00</span>}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── Note modal ─────────────────────────────────────────────────────── */}
      {noteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-80">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">Ghi chú chargeback</h3>
            <textarea
              autoFocus rows={3} id="note-input" defaultValue={noteModal.current}
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              placeholder="Ví dụ: Khách refund gói Pro..."
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setNoteModal(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">Hủy</button>
              <button
                onClick={() => {
                  const val = (document.getElementById('note-input') as HTMLTextAreaElement).value
                  saveNote(noteModal.projectId, noteModal.date, val)
                  setNoteModal(null)
                }}
                className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700"
              >Lưu ghi chú</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Payout modal ───────────────────────────────────────────────────── */}
      {payoutModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-80">
            <h3 className="font-semibold text-slate-800 text-sm mb-3">Kỳ đối soát</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Từ ngày</label>
                <input type="date" defaultValue={payoutModal.start} id="payout-start"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Đến ngày</label>
                <input type="date" defaultValue={payoutModal.end} id="payout-end"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className="flex justify-between mt-4">
              <button onClick={() => { savePayout(payoutModal.projectId, payoutModal.date, null, null); setPayoutModal(null) }}
                className="text-xs text-red-500 hover:text-red-600">Xóa kỳ đối soát</button>
              <div className="flex gap-2">
                <button onClick={() => setPayoutModal(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">Hủy</button>
                <button
                  onClick={() => {
                    const s = (document.getElementById('payout-start') as HTMLInputElement).value
                    const e = (document.getElementById('payout-end') as HTMLInputElement).value
                    if (s && e) { savePayout(payoutModal.projectId, payoutModal.date, s, e); setPayoutModal(null) }
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700"
                >Lưu</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch confirm modal ────────────────────────────────────────────── */}
      {batchConfirmModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-[340px]">
            <h3 className="font-semibold text-slate-800 mb-2">Xác nhận thanh toán</h3>
            <p className="text-sm text-slate-600 mb-4">
              Xác nhận{' '}
              <span className="font-semibold">{selectedPendingItems.length} khoản</span>, tổng{' '}
              <span className="font-semibold text-emerald-700">{formatVND(selectedPendingTotal)}</span>{' '}
              {selectedDateRange} đã được thanh toán?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBatchConfirmModal(false)}
                disabled={batchConfirmLoading}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >Hủy</button>
              <button
                onClick={handleBatchConfirm}
                disabled={batchConfirmLoading}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-60"
              >
                {batchConfirmLoading && <Loader2 size={10} className="animate-spin" />}
                Đồng ý, xác nhận
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Batch all confirm dialog ──────────────────────────────────────── */}
      {showBatchAllConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[580px] max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">Xác nhận hàng loạt</h3>
                {dates.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {fmtShort(dates[0])} – {fmtShort(dates[dates.length - 1])}
                  </p>
                )}
              </div>
              <button onClick={() => setShowBatchAllConfirm(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Select all row */}
            {batchAllItems.length > 0 && (
              <div className="px-5 py-2.5 border-b border-slate-100 flex items-center gap-2.5">
                <div
                  onClick={() => {
                    const allSelected = batchAllItems.every(i => batchAllSelected.has(i.key))
                    setBatchAllSelected(allSelected ? new Set() : new Set(batchAllItems.map(i => i.key)))
                  }}
                  className="cursor-pointer"
                >
                  <Checkbox
                    checked={batchAllItems.length > 0 && batchAllItems.every(i => batchAllSelected.has(i.key))}
                    indeterminate={batchAllSelected.size > 0 && !batchAllItems.every(i => batchAllSelected.has(i.key))}
                  />
                </div>
                <span className="text-xs text-slate-500">Chọn tất cả</span>
                <span className="ml-auto text-xs text-slate-400">{batchAllItems.length} khoản chờ xác nhận</span>
              </div>
            )}

            {/* Item list */}
            <div className="overflow-y-auto flex-1">
              {batchAllItems.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-400">
                  Không có khoản nào chờ xác nhận trong khoảng thời gian này
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="w-10" />
                      <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide">Dự án</th>
                      <th className="text-center px-3 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide">Ngày</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide">Số tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchAllItems.map(item => (
                      <tr
                        key={item.key}
                        onClick={() => setBatchAllSelected(prev => {
                          const n = new Set(prev); n.has(item.key) ? n.delete(item.key) : n.add(item.key); return n
                        })}
                        className="border-t border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
                      >
                        <td className="pl-4 py-2.5"><Checkbox checked={batchAllSelected.has(item.key)} /></td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <div className="font-medium">{item.project_name}</div>
                          {item.is_cumulative && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              Tổng tích lũy: {formatVND(item.rawAmount)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center text-slate-500">
                          {new Date(item.date + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="font-semibold text-slate-800">{formatVND(item.confirmAmount)}</span>
                          {item.is_cumulative && (
                            <span className="ml-1 text-[10px] font-normal text-blue-500 align-middle">Δ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
              <div className="text-sm">
                <span className="text-slate-500 text-xs">Tổng: </span>
                <span className="font-semibold text-slate-800">
                  {formatVND(
                    (batchAllSelected.size > 0
                      ? batchAllItems.filter(i => batchAllSelected.has(i.key))
                      : batchAllItems
                    ).reduce((s, i) => s + i.confirmAmount, 0)
                  )}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowBatchAllConfirm(false)}
                  disabled={batchAllLoading}
                  className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                >Hủy</button>
                <button
                  onClick={handleBatchAllConfirm}
                  disabled={batchAllLoading || batchAllItems.length === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                >
                  {batchAllLoading && <Loader2 size={10} className="animate-spin" />}
                  {batchAllSelected.size > 0
                    ? `Xác nhận ${batchAllSelected.size} khoản đã chọn`
                    : `Xác nhận tất cả (${batchAllItems.length} khoản)`
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Undo toast (10s countdown) ────────────────────────────────────── */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-800 text-white text-xs rounded-xl shadow-xl overflow-hidden w-72">
          <div className="px-4 py-3 flex items-center gap-3">
            <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Đã xác nhận {undoToast.count} khoản</div>
              <div className="text-slate-300 text-[11px]">{formatVND(undoToast.total)}</div>
            </div>
            <button
              onClick={handleUndo}
              className="px-2.5 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-white rounded-md shrink-0 transition-colors"
            >↩ Hoàn tác ({undoToast.secondsLeft}s)</button>
            <button
              onClick={() => { clearInterval(undoIntervalRef.current!); setUndoToast(null) }}
              className="text-slate-400 hover:text-white transition-colors shrink-0"
            ><X size={12} /></button>
          </div>
          {/* Progress bar */}
          <div className="h-0.5 bg-slate-700">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${(undoToast.secondsLeft / 10) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
