import { TrendingUp, TrendingDown, DollarSign, Percent, Monitor } from 'lucide-react'
import { formatVNDFull, formatROI, cn } from '@/lib/utils'

interface Props {
  totalSpend: number
  totalRevenue: number
  totalProfit: number
  avgRoi: number
  totalScreen: number
  totalPending: number
  estimatedRoi: number
}

export default function SummaryCards({ totalSpend, totalRevenue, totalProfit, avgRoi, totalScreen, totalPending, estimatedRoi }: Props) {
  const estimatedProfit = totalRevenue + totalScreen - totalSpend
  const pending = Math.max(totalPending, 0)
  const hasScreen = totalScreen > 0

  return (
    <div className="grid grid-cols-4 gap-4">
      {/* Chi phí */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tổng Chi phí</span>
          <div className="p-1.5 rounded-md bg-slate-50">
            <DollarSign size={14} className="text-slate-600" />
          </div>
        </div>
        <p className="text-xl font-semibold text-slate-700">{formatVNDFull(totalSpend)}</p>
        {hasScreen && pending > 0 && (
          <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
            <Monitor size={10} /> {formatVNDFull(pending)} chờ về
          </p>
        )}
      </div>

      {/* Doanh thu */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Doanh thu</span>
          <div className="p-1.5 rounded-md bg-blue-50">
            <TrendingUp size={14} className="text-blue-600" />
          </div>
        </div>
        <p className="text-xl font-semibold text-blue-600">{formatVNDFull(totalRevenue)}</p>
        {hasScreen ? (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Màn hình</span>
              <span className="text-blue-400 font-medium">{formatVNDFull(totalScreen)}</span>
            </div>
            {totalScreen > 0 && (
              <div className="h-1 rounded-full bg-blue-100 overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.min((totalRevenue / totalScreen) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-300 mt-1.5">Chưa có tiền màn hình</p>
        )}
      </div>

      {/* Lợi nhuận */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lợi nhuận</span>
          <div className={cn('p-1.5 rounded-md', totalProfit >= 0 ? 'bg-green-50' : 'bg-red-50')}>
            {totalProfit >= 0
              ? <TrendingUp size={14} className="text-green-600" />
              : <TrendingDown size={14} className="text-red-600" />}
          </div>
        </div>
        <p className={cn('text-xl font-semibold', totalProfit >= 0 ? 'text-green-600' : 'text-red-600')}>
          {totalProfit >= 0 ? '+' : ''}{formatVNDFull(totalProfit)}
        </p>
        {hasScreen && (
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Ước tính</span>
            <span className={cn('font-medium', estimatedProfit >= 0 ? 'text-emerald-500' : 'text-red-400')}>
              {estimatedProfit >= 0 ? '+' : ''}{formatVNDFull(estimatedProfit)}
            </span>
          </div>
        )}
        {hasScreen && <p className="text-[10px] text-slate-300 mt-0.5">(thực + màn hình) − chi phí</p>}
      </div>

      {/* ROI */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">ROI</span>
          <div className={cn('p-1.5 rounded-md', avgRoi >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
            <Percent size={14} className={avgRoi >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          </div>
        </div>
        <p className={cn('text-xl font-semibold', avgRoi >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {formatROI(avgRoi)}
        </p>
        {hasScreen && (
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1"><Monitor size={10} /> Ước tính</span>
            <span className={cn('font-medium', estimatedRoi >= 0 ? 'text-emerald-500' : 'text-red-400')}>
              {formatROI(estimatedRoi)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
