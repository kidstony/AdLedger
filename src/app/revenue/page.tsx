'use client'

import { useRef, useMemo, useState } from 'react'
import { Save, X, CheckCircle, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid, Loader2, Banknote, Monitor } from 'lucide-react'
import { useRevenueGrid } from '@/hooks/useRevenueGrid'
import { useProjectsContext } from '@/context/ProjectsContext'
import EditableCell from '@/components/revenue/EditableCell'
import { cn, formatVND } from '@/lib/utils'

function fmtShort(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function fmtFull(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

type NoteModal = { projectId: string; date: string; current: string }
type PayoutModal = { projectId: string; date: string; start: string; end: string }

export default function RevenuePage() {
  const {
    projects, dates, today, viewMode, anchorDate, selectedDate,
    activeTab, setActiveTab,
    gridData, screenGrid, prevScreenMap,
    noteMap, payoutMap,
    dirtyKeys, isDirty, isSaving, isLoading, saved, isAtToday,
    goBack, goForward, goToToday, goToDate, switchMode,
    updateCell, clearCell, saveAll, discard, saveNote, savePayout,
  } = useRevenueGrid()

  const { updateProject } = useProjectsContext()

  const tableRef = useRef<HTMLTableElement>(null)
  const focusedCellRef = useRef<{ pi: number; di: number } | null>(null)

  const [noteModal, setNoteModal] = useState<NoteModal | null>(null)
  const [payoutModal, setPayoutModal] = useState<PayoutModal | null>(null)

  // Tổng doanh thu mỗi ngày (hàng totals)
  const dateTotals = useMemo(() =>
    dates.map((date, di) =>
      projects.reduce((sum, p) => {
        const key = `${p.project_id}__${date}`
        if (activeTab === 'screen' && p.screen_revenue_type === 'cumulative') {
          const curr = screenGrid.get(key) ?? 0
          const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
          const prevKey = `${p.project_id}__${prevDate}`
          const prev = di === 0
            ? (prevScreenMap.get(prevKey) ?? 0)
            : (screenGrid.get(prevKey) ?? 0)
          return sum + Math.max(0, curr - prev)
        }
        return sum + (gridData.get(key) ?? 0)
      }, 0)
    ),
    [dates, projects, gridData, screenGrid, prevScreenMap, activeTab]
  )

  function navigate(pi: number, di: number, direction: 'right' | 'left' | 'down' | 'up') {
    let nextPi = pi
    let nextDi = di
    if (direction === 'right') {
      nextDi++
      if (nextDi >= dates.length) { nextDi = 0; nextPi = (pi + 1) % projects.length }
    } else if (direction === 'left') {
      nextDi--
      if (nextDi < 0) { nextDi = dates.length - 1; nextPi = (pi - 1 + projects.length) % projects.length }
    } else if (direction === 'down') {
      nextPi = (pi + 1) % projects.length
    } else if (direction === 'up') {
      nextPi = (pi - 1 + projects.length) % projects.length
    }
    nextDi = Math.max(0, Math.min(nextDi, dates.length - 1))
    focusedCellRef.current = { pi: nextPi, di: nextDi }
    const key = `${projects[nextPi].project_id}__${dates[nextDi]}`
    tableRef.current?.querySelector<HTMLDivElement>(`[data-cell="${key}"]`)?.click()
  }

  function handlePaste(text: string) {
    const fc = focusedCellRef.current
    if (!fc) return
    const lines = text.split('\n').filter(l => l.trim())
    lines.forEach((line, rowOffset) => {
      const targetPi = fc.pi + rowOffset
      if (targetPi >= projects.length) return
      line.split('\t').forEach((val, colOffset) => {
        const targetDi = fc.di + colOffset
        if (targetDi >= dates.length) return
        const num = parseFloat(val.trim().replace(/[^0-9.]/g, ''))
        if (!isNaN(num)) updateCell(projects[targetPi].project_id, dates[targetDi], num)
      })
    })
  }

  // For a cumulative screen cell, compute { delta, cumulative }
  function getCumulativeDelta(projectId: string, date: string, di: number) {
    const key = `${projectId}__${date}`
    const cumulative = screenGrid.get(key) ?? 0
    const prevDate = di === 0 ? addDays(dates[0], -1) : dates[di - 1]
    const prevKey = `${projectId}__${prevDate}`
    const prevCumulative = di === 0
      ? (prevScreenMap.get(prevKey) ?? 0)
      : (screenGrid.get(prevKey) ?? 0)
    return { delta: cumulative - prevCumulative, cumulative }
  }

  const weekLabel = viewMode === 'week'
    ? `${fmtShort(dates[0])} – ${fmtFull(dates[6])}`
    : fmtFull(selectedDate)

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Nhập doanh thu</h2>
          <p className="text-sm text-slate-500 mt-0.5">Tab/Shift+Tab = trái/phải · ↑↓←→ = di chuyển · Ctrl+V = dán hàng loạt</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle size={13} /> Đã lưu
            </span>
          )}
          {isDirty && !isSaving && (
            <button onClick={discard} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">
              <X size={14} /> Hủy bỏ
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!isDirty || isSaving}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              isDirty && !isSaving ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isSaving ? 'Đang lưu...' : `Lưu tất cả${isDirty ? ` (${dirtyKeys.size})` : ''}`}
          </button>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border border-slate-200 overflow-hidden text-xs font-medium">
          <button
            onClick={() => switchMode('week')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 transition-colors',
              viewMode === 'week' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
          >
            <LayoutGrid size={13} /> Theo tuần
          </button>
          <button
            onClick={() => switchMode('day')}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 transition-colors border-l border-slate-200',
              viewMode === 'day' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
          >
            <CalendarDays size={13} /> Theo ngày
          </button>
        </div>

        <div className="w-px h-5 bg-slate-200" />

        <button
          onClick={goBack}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft size={14} /> {viewMode === 'week' ? 'Tuần trước' : 'Ngày trước'}
        </button>

        <div className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-md bg-white text-xs text-slate-700 font-medium min-w-[180px] justify-center">
          {weekLabel}
        </div>

        <button
          onClick={goForward}
          disabled={isAtToday}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-600',
            isAtToday ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-50'
          )}
        >
          {viewMode === 'week' ? 'Tuần sau' : 'Ngày sau'} <ChevronRight size={14} />
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">Nhảy đến:</span>
          <input
            type="date"
            max={today}
            onChange={e => e.target.value && goToDate(e.target.value)}
            className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>

        {!isAtToday && (
          <button
            onClick={goToToday}
            className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-600 hover:bg-slate-50"
          >
            Hôm nay
          </button>
        )}
      </div>

      {/* Revenue type tab */}
      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('revenue')}
          className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
            activeTab === 'revenue' ? 'bg-white text-green-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          <Banknote size={13} /> Doanh thu thực
        </button>
        <button
          onClick={() => setActiveTab('screen')}
          className={cn('flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
            activeTab === 'screen' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
        >
          <Monitor size={13} /> Tiền màn hình
        </button>
      </div>

      {/* Table */}
      <div className="relative border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-300px)]">
        {isLoading && (
          <div className="absolute inset-0 bg-white/70 z-30 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        )}
        <table ref={tableRef} className="text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium border-b border-r border-slate-200 w-52 min-w-[208px]">
                <span className="text-slate-500 uppercase tracking-wide">Dự án</span>
                <span className={cn('ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                  activeTab === 'revenue' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
                  {activeTab === 'revenue' ? 'Thực' : 'Màn hình'}
                </span>
              </th>
              {dates.map(d => (
                <th
                  key={d}
                  className={cn(
                    'px-3 py-2.5 text-center text-xs font-medium border-b border-slate-200 min-w-[120px]',
                    d === today ? 'bg-blue-50 text-blue-700' : 'text-slate-500'
                  )}
                >
                  {viewMode === 'week' ? fmtShort(d) : fmtFull(d)}
                  {d === today && <span className="ml-1 text-[10px] font-normal">(hôm nay)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map((project, pi) => {
              const isCumulative = activeTab === 'screen' && project.screen_revenue_type === 'cumulative'
              return (
                <tr key={project.project_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="sticky left-0 bg-white border-r border-slate-200 px-3 py-0">
                    <div className="flex items-center justify-between gap-1.5 py-2">
                      <span className="font-medium text-slate-700 text-xs truncate">{project.name}</span>
                      {activeTab === 'screen' && (
                        <button
                          onClick={() => updateProject({ ...project, screen_revenue_type: isCumulative ? 'daily' : 'cumulative' })}
                          className={cn(
                            'shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium transition-colors',
                            isCumulative
                              ? 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200'
                              : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200'
                          )}
                          title={isCumulative ? 'Đang: Cộng dồn — click để đổi' : 'Đang: Hàng ngày — click để đổi'}
                        >
                          {isCumulative ? 'Cộng dồn' : 'Hàng ngày'}
                        </button>
                      )}
                    </div>
                  </td>
                  {dates.map((date, di) => {
                    const key = `${project.project_id}__${date}`
                    const hasPayout = activeTab === 'revenue' && payoutMap.has(key)
                    const hasNote = noteMap.has(key)

                    if (isCumulative) {
                      const { delta, cumulative } = getCumulativeDelta(project.project_id, date, di)
                      const rawValue = screenGrid.get(key)
                      return (
                        <td
                          key={date}
                          className={cn('p-0 border-r border-slate-100', date === today && 'bg-blue-50/30')}
                        >
                          <div data-cell={key} className="h-11">
                            <EditableCell
                              value={rawValue}
                              isDirty={dirtyKeys.has(key)}
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

                    return (
                      <td
                        key={date}
                        className={cn('p-0 border-r border-slate-100', date === today && 'bg-blue-50/30')}
                      >
                        <div data-cell={key} className="h-9">
                          <EditableCell
                            value={gridData.get(key)}
                            isDirty={dirtyKeys.has(key)}
                            onCommit={v => updateCell(project.project_id, date, v)}
                            onClear={() => clearCell(project.project_id, date)}
                            onNavigate={dir => navigate(pi, di, dir)}
                            onFocus={() => { focusedCellRef.current = { pi, di } }}
                            onPaste={handlePaste}
                            hasPayout={hasPayout}
                            onDoubleClick={activeTab === 'revenue' ? () => {
                              const existing = payoutMap.get(key)
                              setPayoutModal({
                                projectId: project.project_id,
                                date,
                                start: existing?.start ?? '',
                                end: existing?.end ?? date,
                              })
                            } : undefined}
                          />
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
              <td className="sticky left-0 bg-slate-50 border-r border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Tổng
              </td>
              {dateTotals.map((total, i) => (
                <td key={dates[i]} className={cn('px-3 py-2 text-center text-xs font-semibold', dates[i] === today && 'bg-blue-50/50')}>
                  {total > 0 ? <span className="text-green-700">{formatVND(total)}</span> : <span className="text-slate-300">—</span>}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Note modal */}
      {noteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-80">
            <h3 className="font-semibold text-slate-800 text-sm mb-1">Ghi chú chargeback</h3>
            <p className="text-xs text-slate-500 mb-3">{noteModal.projectId} · {noteModal.date}</p>
            <textarea
              autoFocus
              rows={3}
              defaultValue={noteModal.current}
              id="note-input"
              className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300 resize-none"
              placeholder="Ví dụ: Khách refund gói Pro..."
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setNoteModal(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">
                Hủy
              </button>
              <button
                onClick={() => {
                  const val = (document.getElementById('note-input') as HTMLTextAreaElement).value
                  saveNote(noteModal.projectId, noteModal.date, val)
                  setNoteModal(null)
                }}
                className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700"
              >
                Lưu ghi chú
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payout modal */}
      {payoutModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-5 w-80">
            <h3 className="font-semibold text-slate-800 text-sm mb-1">Kỳ đối soát</h3>
            <p className="text-xs text-slate-500 mb-3">{payoutModal.projectId} · Nhận tiền ngày {payoutModal.date}</p>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500 block mb-1">Từ ngày</label>
                <input
                  type="date"
                  defaultValue={payoutModal.start}
                  id="payout-start"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">Đến ngày</label>
                <input
                  type="date"
                  defaultValue={payoutModal.end}
                  id="payout-end"
                  className="w-full text-sm border border-slate-200 rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
            </div>
            <div className="flex justify-between mt-4">
              <button
                onClick={() => { savePayout(payoutModal.projectId, payoutModal.date, null, null); setPayoutModal(null) }}
                className="text-xs text-red-500 hover:text-red-600"
              >
                Xóa kỳ đối soát
              </button>
              <div className="flex gap-2">
                <button onClick={() => setPayoutModal(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">
                  Hủy
                </button>
                <button
                  onClick={() => {
                    const start = (document.getElementById('payout-start') as HTMLInputElement).value
                    const end = (document.getElementById('payout-end') as HTMLInputElement).value
                    if (start && end) { savePayout(payoutModal.projectId, payoutModal.date, start, end); setPayoutModal(null) }
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700"
                >
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
