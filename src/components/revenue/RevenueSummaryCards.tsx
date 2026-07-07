'use client'

import { useMemo } from 'react'
import { TrendingUp, Trophy, CalendarDays, Layers } from 'lucide-react'
import { formatVND, cn } from '@/lib/utils'
import type { ViewMode } from '@/hooks/useRevenueGrid'

interface ProjectTotal {
  project_id: string
  name: string
  total: number
}

interface Props {
  projectTotals: ProjectTotal[]
  totalProjectCount: number   // total (unfiltered)
  dates: string[]
  viewMode: ViewMode
  anchorDate: string
  isScreen?: boolean          // screen-revenue view → amber money, matching Dashboard P&L
}

function periodLabel(viewMode: ViewMode, anchorDate: string, dates: string[]): string {
  if (viewMode === 'all')   return 'Toàn thời gian'
  if (viewMode === 'month') return new Date(anchorDate.slice(0, 7) + '-01T00:00:00').toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })
  if (viewMode === 'day')   return new Date(dates[0] + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (dates.length >= 2) {
    const f = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    return `${f(dates[0])} – ${f(dates[dates.length - 1])}`
  }
  return ''
}

export default function RevenueSummaryCards({ projectTotals, totalProjectCount, dates, viewMode, anchorDate, isScreen = false }: Props) {
  const { grandTotal, topProject, avgPerDay, activeCount, filteredCount } = useMemo(() => {
    const grand = projectTotals.reduce((s, p) => s + p.total, 0)
    const sorted = [...projectTotals].sort((a, b) => b.total - a.total)
    const top = sorted[0] ?? null
    const daysCount = viewMode === 'all' ? dates.length * 30 : dates.length // approximate for all-time
    const avg = daysCount > 0 ? grand / daysCount : 0
    const active = projectTotals.filter(p => p.total > 0).length
    return { grandTotal: grand, topProject: top, avgPerDay: avg, activeCount: active, filteredCount: projectTotals.length }
  }, [projectTotals, dates, viewMode])

  const period = periodLabel(viewMode, anchorDate, dates)

  return (
    <div className="grid grid-cols-4 gap-2.5 mb-3">
      {/* Card 1: Total */}
      <div className={cn('bg-white border rounded-xl px-4 py-3 shadow-sm', isScreen ? 'border-amber-200' : 'border-blue-200')}>
        <div className={cn('flex items-center gap-1.5 text-[11px] font-medium mb-1.5', isScreen ? 'text-amber-500' : 'text-blue-500')}>
          <TrendingUp size={11} />
          Tổng {period}
          {filteredCount < totalProjectCount && (
            <span className={cn('ml-1', isScreen ? 'text-amber-400' : 'text-blue-400')}>({filteredCount} dự án)</span>
          )}
        </div>
        <div className={cn('text-xl font-bold', isScreen ? 'text-amber-500' : 'text-blue-600')}>{grandTotal > 0 ? formatVND(grandTotal) : <span className="opacity-30">$0.00</span>}</div>
        <div className="text-[11px] text-slate-400 mt-1">{activeCount} dự án đang hoạt động</div>
      </div>

      {/* Card 2: Top project */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm hover:border-slate-300 transition-colors">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium mb-1.5">
          <Trophy size={11} />
          Dự án dẫn đầu
        </div>
        <div className="text-sm font-bold text-slate-800 truncate">{topProject?.name ?? '—'}</div>
        <div className={cn('text-[11px] font-semibold mt-1', isScreen ? 'text-amber-500' : 'text-green-600')}>
          {topProject && topProject.total > 0 ? formatVND(topProject.total) : <span className="text-slate-300">$0.00</span>}
        </div>
      </div>

      {/* Card 3: Avg per day */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm hover:border-slate-300 transition-colors">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium mb-1.5">
          <CalendarDays size={11} />
          Trung bình / ngày
        </div>
        <div className={cn('text-xl font-bold', isScreen ? 'text-amber-500' : 'text-slate-800')}>
          {avgPerDay > 0 ? formatVND(avgPerDay) : <span className="opacity-30">$0.00</span>}
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          Dựa trên {viewMode === 'all' ? `${dates.length} tháng` : `${dates.length} ngày`}
        </div>
      </div>

      {/* Card 4: Project count */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm hover:border-slate-300 transition-colors">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium mb-1.5">
          <Layers size={11} />
          Tổng dự án được chọn
        </div>
        <div className="text-xl font-bold text-slate-800">
          {filteredCount}
          <span className="text-sm font-normal text-slate-400 ml-1">/ {totalProjectCount}</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          {filteredCount === totalProjectCount ? 'Tất cả dự án' : `Đã lọc ${totalProjectCount - filteredCount} dự án`}
        </div>
      </div>
    </div>
  )
}
