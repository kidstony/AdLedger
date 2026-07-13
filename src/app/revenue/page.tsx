'use client'

import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import {
  Loader2, Banknote, Monitor,
  Search, Keyboard, CheckCircle2, Cloud, SlidersHorizontal,
} from 'lucide-react'
import { useRevenueGrid } from '@/hooks/useRevenueGrid'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import EditableCell from '@/components/revenue/EditableCell'
import ProjectFilterDropdown, { type FilterProject } from '@/components/revenue/ProjectFilterDropdown'
import RevenueSummaryCards from '@/components/revenue/RevenueSummaryCards'
import { cn, formatVND } from '@/lib/utils'
import { toast } from 'sonner'
import DateRangePicker from '@/components/ui/DateRangePicker'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

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
    canUndo, canRedo,
    undo, redo,
    switchMode,
    customFrom, customTo, setCustomRange,
    updateCell, clearCell, bulkUpdateCells, bulkClearCells,
    saveNote, savePayout,
    statusMap, confirmedAtMap,
    cycleEndMap, prevCycleEndMap, toggleCycleEnd,
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
  const [showShortcuts,     setShowShortcuts]     = useState(false)

  // ── Excel-style range selection for bulk delete ──
  const [sel, setSel] = useState<{ a: { pi: number; di: number }; f: { pi: number; di: number } } | null>(null)
  const draggingRef = useRef(false)
  const anchorRef = useRef<{ pi: number; di: number } | null>(null)
  const [clearSelModal, setClearSelModal] = useState<{ cells: { projectId: string; date: string }[]; projectCount: number } | null>(null)

  // Projects filtered by dropdown selection + inline search
  const filteredProjects = useMemo(() => {
    let result = projects
    if (filterIds.size > 0) result = result.filter(p => filterIds.has(p.project_id))
    const q = searchQuery.trim().toLowerCase()
    if (q) result = result.filter(p => p.name.toLowerCase().includes(q))
    return result
  }, [projects, filterIds, searchQuery])

  // Range-selection bounds + membership test (Excel-style bulk delete)
  const selBounds = sel && {
    minPi: Math.min(sel.a.pi, sel.f.pi), maxPi: Math.max(sel.a.pi, sel.f.pi),
    minDi: Math.min(sel.a.di, sel.f.di), maxDi: Math.max(sel.a.di, sel.f.di),
  }
  const inSel = (pi: number, di: number) =>
    !!selBounds && pi >= selBounds.minPi && pi <= selBounds.maxPi && di >= selBounds.minDi && di <= selBounds.maxDi

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

  // Clear range-selection when the grid shape changes (row/col indices would be stale)
  useEffect(() => { setSel(null) }, [dates, activeTab, filteredProjects])

  function showPageToast(msg: string) {
    toast.success(msg, { duration: 3000 })
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
          if (screenGrid.get(key) === undefined) return sum
          return sum + getCumulativeDelta(p.project_id, d, di).delta
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
      return { project_id: p.project_id, name: p.name, total }
    }),
    [filteredProjects, dates, gridData, screenGrid, prevScreenMap, activeTab, viewMode, cycleEndMap, prevCycleEndMap]
  )

  // ── keyboard shortcuts (global) ─────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' &&  e.shiftKey) { e.preventDefault(); redo(); return }

      // Search shortcut `/`
      if (e.key === '/' && !inInput) { e.preventDefault(); searchRef.current?.focus(); return }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setSearchQuery(''); searchRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ── range-selection: end drag on mouseup, Delete clears, Escape deselects ────
  useEffect(() => {
    function onMouseUp() {
      draggingRef.current = false
    }
    function onSelKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      if (inInput || !sel) return
      if (e.key === 'Escape') { setSel(null); return }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const b = {
          minPi: Math.min(sel.a.pi, sel.f.pi), maxPi: Math.max(sel.a.pi, sel.f.pi),
          minDi: Math.min(sel.a.di, sel.f.di), maxDi: Math.max(sel.a.di, sel.f.di),
        }
        const cells: { projectId: string; date: string }[] = []
        const projSet = new Set<string>()
        for (let p = b.minPi; p <= b.maxPi; p++) {
          const project = filteredProjects[p]
          if (!project) continue
          for (let d = b.minDi; d <= b.maxDi; d++) {
            const date = dates[d]
            if (!date) continue
            if ((gridData.get(`${project.project_id}__${date}`) ?? 0) > 0) {
              cells.push({ projectId: project.project_id, date })
              projSet.add(project.project_id)
            }
          }
        }
        if (cells.length === 0) { setSel(null); return }
        setClearSelModal({ cells, projectCount: projSet.size })
      }
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onSelKey)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onSelKey)
    }
  }, [sel, filteredProjects, dates, gridData])

  // ── totals (dynamic: only filtered projects) ─────────────────────────────────
  const dateTotals = useMemo(() =>
    dates.map((date, di) =>
      filteredProjects.reduce((sum, p) => {
        const key = `${p.project_id}__${date}`
        // In all-time view, gridData already contains correct monthly deltas for cumulative projects
        // so we just sum gridData directly. Daily delta logic only applies to day/week/month views.
        if (viewMode !== 'all' && activeTab === 'screen' && p.screen_revenue_type === 'cumulative') {
          if (screenGrid.get(key) === undefined) return sum
          return sum + getCumulativeDelta(p.project_id, date, di).delta
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
    ),
    [dates, filteredProjects, gridData, screenGrid, prevScreenMap, activeTab, viewMode, cycleEndMap, prevCycleEndMap]
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
    // Don't re-open the same cell — happens when filter leaves only 1 project and wrap-around
    // would re-trigger startEdit() with stale props, stomping the just-committed value.
    if (npi === pi && ndi === di) return
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
    const key        = `${projectId}__${date}`
    const cumulative = screenGrid.get(key) ?? 0

    let prev = 0
    let prevIsCycleEnd = false
    if (di === 0) {
      const pk = `${projectId}__${addDays(dates[0], -1)}`
      prev = prevScreenMap.get(pk) ?? 0
      prevIsCycleEnd = prevCycleEndMap.get(pk) ?? false
    } else {
      // Scan backwards for the last non-undefined entry — gaps mean running total unchanged
      let found = false
      for (let i = di - 1; i >= 0; i--) {
        const pk = `${projectId}__${dates[i]}`
        const v = screenGrid.get(pk)
        if (v !== undefined) { prev = v; prevIsCycleEnd = cycleEndMap.get(pk) ?? false; found = true; break }
      }
      if (!found) {
        const pk = `${projectId}__${addDays(dates[0], -1)}`
        prev = prevScreenMap.get(pk) ?? 0
        prevIsCycleEnd = prevCycleEndMap.get(pk) ?? false
      }
    }

    // Ngày baseline đã "chốt kỳ" (đã thanh toán) → platform reset bộ đếm, đếm lại từ 0
    if (prevIsCycleEnd) prev = 0

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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Nhập doanh thu"
        badge={
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
        }
        actions={<>
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
        </>}
      />

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
        <SegmentedControl
          className="ml-auto"
          size="sm"
          value={activeTab}
          onChange={v => setActiveTab(v as 'revenue' | 'screen')}
          options={[
            { value: 'revenue', label: 'Thực nhận', icon: Banknote, activeClass: 'text-blue-600' },
            { value: 'screen', label: 'Tiền màn hình', icon: Monitor, activeClass: 'text-amber-600' },
          ]}
        />
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
        isScreen={activeTab === 'screen'}
      />

      {/* ── Search + Table ─────────────────────────────────────────────────── */}
      <div className="relative border border-slate-200 rounded-lg overflow-hidden">
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
        </div>

        <div className="overflow-auto max-h-[calc(100vh-290px)]">
          {isLoading && (
            <div className="absolute inset-0 bg-white/70 z-30 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
          )}
          <table ref={tableRef} className="text-sm border-collapse w-full select-none">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr>
                <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium border-b border-r border-slate-200 w-52 min-w-[208px]">
                  <span className="text-slate-500 uppercase tracking-wide text-[10px]">Dự án</span>
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

                return (
                  <tr key={project.project_id} className="border-b border-slate-100 hover:bg-slate-50/40">
                    <td className="sticky left-0 bg-white border-r border-slate-200 px-3 py-0 z-10">
                      <div className="flex items-center gap-1.5 py-2">
                        <div className="flex flex-col min-w-0 flex-1">
                          <Tooltip>
                            <TooltipTrigger className="font-medium text-slate-700 text-xs truncate text-left leading-tight">
                              {project.name}
                            </TooltipTrigger>
                            <TooltipContent side="right">{project.name}</TooltipContent>
                          </Tooltip>
                          {project.affiliate_username && (
                            <span className="text-[10px] text-slate-400 truncate leading-tight">{project.affiliate_username}</span>
                          )}
                        </div>
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
                      const selCls      = !isReadOnly && inSel(pi, di) ? 'ring-2 ring-inset ring-blue-400 bg-blue-100/50' : ''

                      // ── Cumulative screen tab (pending) ──────────────────────
                      if (isCumulative && !isReadOnly) {
                        const { delta, cumulative } = getCumulativeDelta(project.project_id, date, di)
                        const rawValue = screenGrid.get(key)
                        const hasDelta = rawValue !== undefined
                        return (
                          <td
                            key={date}
                            className={cn(tdCls, selCls)}
                            onMouseDown={e => {
                              if (isReadOnly) return
                              if (e.shiftKey && anchorRef.current) { e.preventDefault(); setSel({ a: anchorRef.current, f: { pi, di } }) }
                              else { anchorRef.current = { pi, di }; draggingRef.current = true; setSel(null) }
                            }}
                            onMouseEnter={() => { if (!isReadOnly && draggingRef.current && anchorRef.current) setSel({ a: anchorRef.current, f: { pi, di } }) }}
                          >
                            <div data-cell={key} className="h-11">
                              <EditableCell
                                value={rawValue}
                                onCommit={v => updateCell(project.project_id, date, v)}
                                onClear={() => clearCell(project.project_id, date)}
                                onNavigate={dir => navigate(pi, di, dir)}
                                onFocus={() => { focusedCellRef.current = { pi, di } }}
                                onPaste={handlePaste}
                                displayValue={isConfirmed ? 0 : (hasDelta && delta !== 0 ? delta : undefined)}
                                valueSubtitle={isConfirmed ? '✓ đã nhận' : (hasDelta && delta !== 0 ? `${formatVND(cumulative)} cộng dồn` : undefined)}
                                valueColorClass={isConfirmed ? 'text-slate-300' : (delta < 0 ? 'text-red-600' : 'text-amber-500')}
                                hasNote={hasNote}
                                onNoteClick={() => setNoteModal({ projectId: project.project_id, date, current: noteMap.get(key) ?? '' })}
                                isCycleEnd={cycleEndMap.get(key) ?? false}
                                onCycleEndClick={hasDelta ? () => toggleCycleEnd(project.project_id, date, !(cycleEndMap.get(key) ?? false)) : undefined}
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
                            ? `✓ đã nhận ${formatVND(revenueGrid.get(key) ?? 0)}`
                            : undefined
                        : undefined

                      return (
                        <td
                          key={date}
                          className={cn(tdCls, selCls)}
                          onMouseDown={e => {
                            if (isReadOnly) return
                            if (e.shiftKey && anchorRef.current) { e.preventDefault(); setSel({ a: anchorRef.current, f: { pi, di } }) }
                            else { anchorRef.current = { pi, di }; draggingRef.current = true; setSel(null) }
                          }}
                          onMouseEnter={() => { if (!isReadOnly && draggingRef.current && anchorRef.current) setSel({ a: anchorRef.current, f: { pi, di } }) }}
                        >
                          <div data-cell={key} className={confirmedSub ? 'h-11' : 'h-9'}>
                            {isReadOnly ? (
                              <div className={cn('w-full h-full px-2 py-1.5 text-right font-mono text-xs font-medium', activeTab === 'screen' ? 'text-amber-500' : 'text-slate-700')}>
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
                                valueColorClass={activeTab === 'screen' ? 'text-amber-500' : 'text-slate-700'}
                                hasPayout={hasPayout}
                                onDoubleClick={isRevTab ? () => {
                                  const ex = payoutMap.get(key)
                                  setPayoutModal({ projectId: project.project_id, date, start: ex?.start ?? '', end: ex?.end ?? date })
                                } : undefined}
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
                    {total > 0
                      ? <span className={activeTab === 'screen' ? 'text-amber-500' : 'text-green-700'}>{formatVND(total)}</span>
                      : total < 0
                        ? <span className="text-red-500">-{formatVND(Math.abs(total))}</span>
                        : <span className="opacity-20">$0.00</span>
                    }
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

      {/* ── Bulk-delete confirm (Excel-style range selection) ─────────────── */}
      {clearSelModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-5 w-[340px]">
            <h3 className="font-semibold text-slate-800 mb-2">Xoá doanh thu</h3>
            <p className="text-sm text-slate-600 mb-4">
              Xoá{' '}
              <span className="font-semibold text-red-600">{clearSelModal.cells.length} ô</span>{' '}
              doanh thu của{' '}
              <span className="font-semibold">{clearSelModal.projectCount} dự án</span>?{' '}
              Có thể hoàn tác bằng Ctrl+Z.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setClearSelModal(null)}
                className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
              >Hủy</button>
              <button
                onClick={() => {
                  bulkClearCells(clearSelModal.cells)
                  showPageToast(`Đã xoá ${clearSelModal.cells.length} ô — Ctrl+Z để hoàn tác`)
                  setClearSelModal(null)
                  setSel(null)
                }}
                className="px-4 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700"
              >Xoá</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
