'use client'

import { useRef } from 'react'
import { Save, X, CheckCircle, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid } from 'lucide-react'
import { useRevenueGrid } from '@/hooks/useRevenueGrid'
import EditableCell from '@/components/revenue/EditableCell'
import { cn } from '@/lib/utils'

function fmtShort(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
}

function fmtFull(date: string) {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function RevenuePage() {
  const {
    projects, dates, today, viewMode, anchorDate, selectedDate,
    gridData, dirtyKeys, isDirty, saved, isAtToday,
    goBack, goForward, goToToday, goToDate, switchMode,
    updateCell, saveAll, discard,
  } = useRevenueGrid()

  const tableRef = useRef<HTMLTableElement>(null)

  function navigate(projectIdx: number, dateIdx: number, direction: 'right' | 'down') {
    let nextPi = projectIdx
    let nextDi = dateIdx
    if (direction === 'right' && viewMode === 'week') {
      nextDi = dateIdx + 1
      if (nextDi >= dates.length) { nextDi = 0; nextPi = (projectIdx + 1) % projects.length }
    } else {
      nextPi = (projectIdx + 1) % projects.length
    }
    const key = `${projects[nextPi].project_id}__${dates[Math.min(nextDi, dates.length - 1)]}`
    tableRef.current?.querySelector<HTMLDivElement>(`[data-cell="${key}"]`)?.click()
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
          <p className="text-sm text-slate-500 mt-0.5">Click vào ô để nhập · Tab = ô tiếp theo · Enter = xuống dưới</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle size={13} /> Đã lưu
            </span>
          )}
          {isDirty && (
            <button onClick={discard} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">
              <X size={14} /> Hủy bỏ
            </button>
          )}
          <button
            onClick={saveAll}
            disabled={!isDirty}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              isDirty ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            <Save size={14} /> Lưu tất cả {isDirty && `(${dirtyKeys.size})`}
          </button>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Mode toggle */}
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

        {/* Prev / Next */}
        <button
          onClick={goBack}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md bg-white text-slate-600 hover:bg-slate-50"
        >
          <ChevronLeft size={14} /> {viewMode === 'week' ? 'Tuần trước' : 'Ngày trước'}
        </button>

        {/* Date label / jump input */}
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

        {/* Jump to date */}
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

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-auto max-h-[calc(100vh-260px)]">
        <table ref={tableRef} className="text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-r border-slate-200 w-48 min-w-[192px]">
                Dự án
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
            {projects.map((project, pi) => (
              <tr key={project.project_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                <td className="sticky left-0 bg-white border-r border-slate-200 px-4 py-0 font-medium text-slate-700 text-xs truncate max-w-[192px]">
                  <span className="block truncate py-2">{project.name}</span>
                </td>
                {dates.map((date, di) => {
                  const key = `${project.project_id}__${date}`
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
                          onNavigate={dir => navigate(pi, di, dir)}
                        />
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
