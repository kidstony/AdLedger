'use client'

import { RefreshCw, Zap, Database, AlertTriangle, Monitor, TrendingUp } from 'lucide-react'
import { usePnlData } from '@/hooks/usePnlData'
import SummaryCards from '@/components/dashboard/SummaryCards'
import DateRangePicker from '@/components/ui/DateRangePicker'
import PnlTable from '@/components/dashboard/PnlTable'
import DailyPnlChart from '@/components/dashboard/DailyPnlChart'
import DailyPnlTable from '@/components/dashboard/DailyPnlTable'
import ProjectFilterDropdown from '@/components/revenue/ProjectFilterDropdown'
import { cn, exportToCsv } from '@/lib/utils'

export default function DashboardPage() {
  const { data, allSummaries, totals, pnlView, setPnlView, isLoading, dateRange, setDateRange, search, setSearch, selectedProjectIds, setSelectedProjectIds, filterProjectData, refresh, dataSource, lastSyncedAt, dailyChartData } = usePnlData()

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

        {/* Toggle 2 góc nhìn P&L */}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setPnlView('screen')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              pnlView === 'screen' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Monitor size={14} /> Theo màn hình
          </button>
          <button
            onClick={() => setPnlView('confirmed')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              pnlView === 'confirmed' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <TrendingUp size={14} /> Thực nhận
          </button>
        </div>
      </div>

      {/* Thanh công cụ toàn cục: điều khiển dữ liệu toàn trang */}
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

        <button
          onClick={refresh}
          disabled={isLoading}
          className={cn(
            'ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border transition-colors',
            'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60'
          )}
        >
          <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
          Làm mới
        </button>
      </div>

      <SummaryCards
        view={pnlView}
        totalSpend={totals.spend + totals.rental + totals.other}
        confirmedRevenue={totals.revenue}
        confirmedProfit={totals.profit}
        confirmedRoi={totals.avgRoi}
        screenRevenue={totals.screen_revenue}
        screenProfit={totals.screen_profit}
        screenRoi={totals.screenRoi}
      />

      <DailyPnlChart data={dailyChartData} view={pnlView} />

      <DailyPnlTable data={dailyChartData} view={pnlView} />

      {dataSource === 'real' && allSummaries.length === 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            Dữ liệu đã đồng bộ từ Google Ads nhưng chưa có campaign nào được gán vào dự án.{' '}
            <a href="/admin/integrations" className="underline font-medium">Cài đặt mapping →</a>
          </span>
        </div>
      )}

      <h3 className="text-sm font-medium text-slate-700">Chi tiết theo dự án</h3>

      <PnlTable
        data={data}
        isLoading={isLoading}
        view={pnlView}
        search={search}
        onSearchChange={setSearch}
        onExport={() => exportToCsv(
          data.map(s => ({
            'Project ID': s.project_id,
            'Tên dự án': s.name,
            'CID': s.cid,
            'Chi phí QC': s.total_spend,
            'Thuê TK': s.total_rental,
            'CP Khác': s.total_other,
            'Doanh thu': s.total_revenue,
            'DT Màn hình': s.total_screen_revenue,
            'Lợi nhuận': s.total_profit,
            'ROI%': s.avg_roi.toFixed(1) + '%',
          })),
          `pnl-${dateRange.from.toISOString().slice(0,10)}-${dateRange.to.toISOString().slice(0,10)}.csv`
        )}
      />
    </div>
  )
}
