'use client'

import { RefreshCw, Search, Zap, Database, AlertTriangle } from 'lucide-react'
import { usePnlData } from '@/hooks/usePnlData'
import SummaryCards from '@/components/dashboard/SummaryCards'
import DateRangePicker from '@/components/ui/DateRangePicker'
import PnlTable from '@/components/dashboard/PnlTable'
import ProjectFilterDropdown from '@/components/revenue/ProjectFilterDropdown'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const { data, allSummaries, totals, isLoading, dateRange, setDateRange, search, setSearch, selectedProjectIds, setSelectedProjectIds, filterProjectData, refresh, dataSource, lastSyncedAt } = usePnlData()

  function formatSyncTime(iso: string) {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    return isToday
      ? 'hôm nay ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-800">Dashboard P&L</h2>
            {dataSource === 'real' ? (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium border border-green-200">
                <Zap size={10} /> Chi phí thật
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-200">
                <Database size={10} /> Demo data
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Tổng quan lãi/lỗ theo dự án
            {lastSyncedAt && dataSource === 'real' && (
              <span className="ml-2 text-slate-400">· Đồng bộ cuối: {formatSyncTime(lastSyncedAt)}</span>
            )}
          </p>
        </div>
      </div>

      <SummaryCards
        totalSpend={totals.spend + totals.rental + totals.other}
        totalRevenue={totals.revenue}
        totalProfit={totals.profit}
        avgRoi={totals.avgRoi}
        totalScreen={totals.screen_revenue}
        totalPending={totals.pending}
        estimatedRoi={(totals.spend + totals.rental + totals.other) > 0
          ? ((totals.revenue + totals.screen_revenue - totals.spend - totals.rental - totals.other) / (totals.spend + totals.rental + totals.other)) * 100
          : 0}
      />

      <div className="flex items-center gap-3">
        <DateRangePicker
          from={dateRange.from.toISOString().split('T')[0]}
          to={dateRange.to.toISOString().split('T')[0]}
          onApply={(f, t) => setDateRange({ from: new Date(f + 'T00:00:00Z'), to: new Date(t + 'T00:00:00Z') })}
        />

        <ProjectFilterDropdown
          projects={filterProjectData}
          selectedIds={selectedProjectIds}
          onApply={setSelectedProjectIds}
        />

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Tìm dự án..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:ring-2 focus:ring-slate-300 w-48"
          />
        </div>

        <button
          onClick={refresh}
          disabled={isLoading}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
            'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60'
          )}
        >
          <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
          Làm mới
        </button>
      </div>

      {dataSource === 'real' && allSummaries.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            Dữ liệu đã đồng bộ từ Google Ads nhưng chưa có campaign nào được gán vào dự án.{' '}
            <a href="/admin/integrations" className="underline font-medium">Cài đặt mapping →</a>
          </span>
        </div>
      )}

      <PnlTable data={data} isLoading={isLoading} />
    </div>
  )
}
