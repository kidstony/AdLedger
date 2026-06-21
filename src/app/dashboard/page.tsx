'use client'

import { RefreshCw, Search } from 'lucide-react'
import { usePnlData } from '@/hooks/usePnlData'
import SummaryCards from '@/components/dashboard/SummaryCards'
import DateRangePicker from '@/components/dashboard/DateRangePicker'
import PnlTable from '@/components/dashboard/PnlTable'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const { data, totals, isLoading, dateRange, setDateRange, search, setSearch, refresh } = usePnlData()

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Dashboard P&L</h2>
          <p className="text-sm text-slate-500 mt-0.5">Tổng quan lãi/lỗ theo dự án</p>
        </div>
      </div>

      <SummaryCards
        totalSpend={totals.spend}
        totalRevenue={totals.revenue}
        totalProfit={totals.profit}
        avgRoi={totals.avgRoi}
      />

      <div className="flex items-center gap-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} />

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

      <PnlTable data={data} isLoading={isLoading} />
    </div>
  )
}
