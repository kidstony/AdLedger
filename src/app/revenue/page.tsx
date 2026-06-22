'use client'

import { useRef, useMemo, useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, Banknote, Monitor,
  Search, Keyboard, CheckCircle2, Cloud,
} from 'lucide-react'
import { useRevenueGrid } from '@/hooks/useRevenueGrid'
import { useProjectsContext } from '@/context/ProjectsContext'
import EditableCell from '@/components/revenue/EditableCell'
import { cn, formatVND } from '@/lib/utils'

// ── date helpers ────────────────────────────────────────────────────────────
function fmtShort(d: string) { return new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) }
function fmtMY(d: string)    { const [y,m] = d.split('-'); return `${m}/${y}` }
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]
}

type NoteModal   = { projectId: string; date: string; current: string }
type PayoutModal = { projectId: string; date: string; start: string; end: string }

// ── keyboard shortcut list ───────────────────────────────────────────────────
const SHORTCUTS = [
  { keys: 'Tab / Shift+Tab', desc: 'Phải / Trái' },
  { keys: '↑ ↓ ← →',        desc: 'Di chuyển ô' },
  { keys: 'Enter',           desc: 'Xuống hàng' },
  { keys: 'Ctrl+V',          desc: 'Dán hàng loạt (Excel)' },
  { keys: 'Ctrl+Z',          desc: 'Hoàn tác' },
  { keys: 'Ctrl+Shift+Z',    desc: 'Làm lại' },
  { keys: '/',               desc: 'Tìm kiếm nhanh' },
  { keys: 'Esc',             desc: 'Xóa tìm kiếm' },
  { keys: 'Double-click',    desc: 'Gắn thẻ kỳ đối soát' },
]

export default function RevenuePage() {
  const {
    projects, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    dates, gridData, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    isLoading, saveStatus, isAtToday,
    canUndo, canRedo, toast, setToast,
    undo, redo,
    goBack, goForward, goToToday, switchMode,
    updateCell, clearCell, bulkUpdateCells,
    saveNote, savePayout,
  } = useRevenueGrid()

  const { updateProject } = useProjectsContext()
  const tableRef        = useRef<HTMLTableElement>(null)
  const focusedCellRef  = useRef<{ pi: number; di: number } | null>(null)
  const searchRef       = useRef<HTMLInputElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [noteModal,   setNoteModal]   = useState<NoteModal | null>(null)
  const [payoutModal, setPayoutModal] = useState<PayoutModal | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // filtered projects
  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(p => p.name.toLowerCase().includes(q))
  }, [projects, searchQuery])

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

  // ── navigation label ────────────────────────────────────────────────────────
  const navLabel = useMemo(() => {
    if (viewMode === 'all')   return 'Toàn thời gian'
    if (viewMode === 'day')   return new Date(selectedDate + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    if (viewMode === 'month') return new Date(anchorDate.slice(0, 7) + '-01T00:00:00').toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
    const [from, to] = [dates[0], dates[dates.length - 1]]
    return `${fmtShort(from)} – ${fmtShort(to)}`
  }, [viewMode, anchorDate, selectedDate, dates])

  // ── totals (dynamic: only filtered projects) ─────────────────────────────────
  const dateTotals = useMemo(() =>
    dates.map((date, di) =>
      filteredProjects.reduce((sum, p) => {
        const key = `${p.project_id}__${date}`
        if (activeTab === 'screen' && p.screen_revenue_type === 'cumulative') {
          const curr = screenGrid.get(key) ?? 0
          const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
          const prevKey  = `${p.project_id}__${prevDate}`
          const prev = di === 0 ? (prevScreenMap.get(prevKey) ?? 0) : (screenGrid.get(prevKey) ?? 0)
          return sum + Math.max(0, curr - prev)
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
    ),
    [dates, filteredProjects, gridData, screenGrid, prevScreenMap, activeTab]
  )

  // ── navigation ──────────────────────────────────────────────────────────────
  function navigate(pi: number, di: number, dir: 'right' | 'left' | 'down' | 'up') {
    let npi = pi, ndi = di
    if (dir === 'right')     { ndi++; if (ndi >= dates.length) { ndi = 0; npi = (pi + 1) % filteredProjects.length } }
    else if (dir === 'left') { ndi--; if (ndi < 0) { ndi = dates.length - 1; npi = (pi - 1 + filteredProjects.length) % filteredProjects.length } }
    else if (dir === 'down') npi = (pi + 1) % filteredProjects.length
    else                     npi = (pi - 1 + filteredProjects.length) % filteredProjects.length
    ndi = Math.max(0, Math.min(ndi, dates.length - 1))
    focusedCellRef.current = { pi: npi, di: ndi }
    const key = `${filteredProjects[npi].project_id}__${dates[ndi]}`
    tableRef.current?.querySelector<HTMLDivElement>(`[data-cell="${key}"]`)?.click()
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

      {/* ── Navigation bar (3 clusters) ────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Cluster 1: View switcher (segmented control) */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium bg-white">
          {(['day', 'week', 'month', 'all'] as const).map((m, i) => {
            const labels: Record<string, string> = { day: 'Ngày', week: 'Tuần', month: 'Tháng', all: 'Toàn thời gian' }
            return (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  i > 0 && 'border-l border-slate-200',
                  viewMode === m ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
                )}
              >{labels[m]}</button>
            )
          })}
        </div>

        {/* Cluster 2: Quick nav */}
        <div className={cn('flex items-center gap-1', viewMode === 'all' && 'opacity-30 pointer-events-none')}>
          <button onClick={goBack} className="p-1.5 rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-600 hover:bg-slate-50 min-w-[120px] text-center"
          >
            {viewMode === 'month' ? 'Tháng này' : viewMode === 'day' ? 'Hôm nay' : 'Tuần này'}
          </button>
          <button onClick={goForward} disabled={isAtToday} className={cn('p-1.5 rounded-md border border-slate-200 bg-white text-slate-600', isAtToday ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-50')}>
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Cluster 3: Date label */}
        <div className="text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5">
          {navLabel}
        </div>

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
          <table ref={tableRef} className="text-sm border-collapse w-full">
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
                      <div className="flex items-center justify-between gap-1.5 py-2">
                        <span className="font-medium text-slate-700 text-xs truncate">{project.name}</span>
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
                      const key      = `${project.project_id}__${date}`
                      const hasPayout = activeTab === 'revenue' && payoutMap.has(key)
                      const hasNote   = noteMap.has(key)

                      if (isCumulative && !isReadOnly) {
                        const { delta, cumulative } = getCumulativeDelta(project.project_id, date, di)
                        const rawValue = screenGrid.get(key)
                        return (
                          <td key={date} className={cn('p-0 border-r border-slate-100', date === today && 'bg-blue-50/30')}>
                            <div data-cell={key} className="h-11">
                              <EditableCell
                                value={rawValue}
                                onCommit={v => updateCell(project.project_id, date, v)}
                                onClear={() => clearCell(project.project_id, date)}
                                onNavigate={dir => navigate(pi, di, dir)}
                                onFocus={() => { focusedCellRef.current = { pi, di } }}
                                onPaste={handlePaste}
                                displayValue={rawValue !== undefined ? delta : undefined}
                                valueSubtitle={rawValue !== undefined ? `Tổng: ${formatVND(cumulative)}` : undefined}
                                valueColorClass={delta < 0 ? 'text-red-600' : 'text-slate-700'}
                                hasNote={hasNote}
                                onNoteClick={() => setNoteModal({ projectId: project.project_id, date, current: noteMap.get(key) ?? '' })}
                              />
                            </div>
                          </td>
                        )
                      }

                      const cellValue = gridData.get(key)
                      return (
                        <td key={date} className={cn('p-0 border-r border-slate-100', date === today && 'bg-blue-50/30')}>
                          <div data-cell={key} className="h-9">
                            {isReadOnly ? (
                              // All-time view: read-only display
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
                                hasPayout={hasPayout}
                                onDoubleClick={activeTab === 'revenue' ? () => {
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
    </div>
  )
}
