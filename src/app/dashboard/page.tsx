'use client'

import { RefreshCw, Zap, Database, AlertTriangle, Monitor, TrendingUp } from 'lucide-react'
import { usePnlData } from '@/hooks/usePnlData'
import SummaryCards from '@/components/dashboard/SummaryCards'
import DateRangePicker from '@/components/ui/DateRangePicker'
import PageHeader from '@/components/ui/PageHeader'
import StatusPill from '@/components/ui/StatusPill'
import SegmentedControl from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/button'
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
      <PageHeader
        title="Dashboard P&L"
        badge={dataSource === 'real'
          ? <StatusPill tone="green" icon={Zap}>Chi phí thật</StatusPill>
          : <StatusPill tone="amber" icon={Database}>Demo data</StatusPill>}
        subtitle={<>
          Tổng quan lãi/lỗ theo dự án
          {lastSyncedAt && dataSource === 'real' && (
            <span className="ml-2 text-slate-400">· Đồng bộ cuối: {formatSyncTime(lastSyncedAt)}</span>
          )}
        </>}
        actions={
          <SegmentedControl
            value={pnlView}
            onChange={v => setPnlView(v as 'screen' | 'confirmed')}
            options={[
              { value: 'screen', label: 'Tiền màn hình', icon: Monitor, activeClass: 'text-amber-600' },
              { value: 'confirmed', label: 'Thực nhận', icon: TrendingUp, activeClass: 'text-blue-600' },
            ]}
          />
        }
      />

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

        <Button variant="outline" onClick={refresh} disabled={isLoading} className="ml-auto">
          <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
          Làm mới
        </Button>
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
            'CP khác': s.total_other,
            'Doanh thu': s.total_revenue,
            'DT màn hình': s.total_screen_revenue,
            'Lợi nhuận': s.total_profit,
            'ROI%': s.avg_roi.toFixed(1) + '%',
          })),
          `pnl-${dateRange.from.toISOString().slice(0,10)}-${dateRange.to.toISOString().slice(0,10)}.csv`
        )}
      />
    </div>
  )
}
