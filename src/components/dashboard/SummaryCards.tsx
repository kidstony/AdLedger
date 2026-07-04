import { TrendingUp, TrendingDown, DollarSign, Percent, Monitor } from 'lucide-react'
import { formatVNDFull, formatROI, cn } from '@/lib/utils'

interface Props {
  view: 'screen' | 'confirmed'
  totalSpend: number
  confirmedRevenue: number
  confirmedProfit: number
  confirmedRoi: number
  screenRevenue: number
  screenProfit: number
  screenRoi: number
}

export default function SummaryCards({
  view, totalSpend,
  confirmedRevenue, confirmedProfit, confirmedRoi,
  screenRevenue, screenProfit, screenRoi,
}: Props) {
  const isScreen = view === 'screen'

  // Active (primary) numbers follow the selected view; the other view is shown as a muted reference.
  const revenue    = isScreen ? screenRevenue : confirmedRevenue
  const profit     = isScreen ? screenProfit  : confirmedProfit
  const roi        = isScreen ? screenRoi      : confirmedRoi
  const refRevenue = isScreen ? confirmedRevenue : screenRevenue
  const refProfit  = isScreen ? confirmedProfit  : screenProfit
  const refRoi     = isScreen ? confirmedRoi      : screenRoi

  const revenueColor = isScreen ? 'text-amber-500' : 'text-blue-600'
  const profitColor  = isScreen
    ? (profit >= 0 ? 'text-amber-500' : 'text-red-500')
    : (profit >= 0 ? 'text-green-600' : 'text-red-600')
  const roiColor     = isScreen
    ? (roi >= 0 ? 'text-amber-500' : 'text-red-500')
    : (roi >= 0 ? 'text-emerald-600' : 'text-red-600')

  const refLabel = isScreen ? 'Thực nhận' : 'Màn hình'

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
        <p className="text-xs text-slate-300 mt-1.5">QC + Thuê TK + CP khác</p>
      </div>

      {/* Doanh thu */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {isScreen ? 'Doanh thu (Màn hình)' : 'Doanh thu'}
          </span>
          <div className={cn('p-1.5 rounded-md', isScreen ? 'bg-amber-50' : 'bg-blue-50')}>
            {isScreen
              ? <Monitor size={14} className="text-amber-500" />
              : <TrendingUp size={14} className="text-blue-600" />}
          </div>
        </div>
        <p className={cn('text-xl font-semibold', revenueColor)}>{formatVNDFull(revenue)}</p>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            {isScreen ? <TrendingUp size={10} /> : <Monitor size={10} />} {refLabel}
          </span>
          <span className="text-slate-400 font-medium">{formatVNDFull(refRevenue)}</span>
        </div>
      </div>

      {/* Lợi nhuận */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {isScreen ? 'Lợi nhuận (Ước tính)' : 'Lợi nhuận'}
          </span>
          <div className={cn('p-1.5 rounded-md', isScreen ? 'bg-amber-50' : profit >= 0 ? 'bg-green-50' : 'bg-red-50')}>
            {profit >= 0
              ? <TrendingUp size={14} className={isScreen ? 'text-amber-500' : 'text-green-600'} />
              : <TrendingDown size={14} className="text-red-600" />}
          </div>
        </div>
        <p className={cn('text-xl font-semibold', profitColor)}>
          {profit >= 0 ? '+' : ''}{formatVNDFull(profit)}
        </p>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            {isScreen ? <TrendingUp size={10} /> : <Monitor size={10} />} {refLabel}
          </span>
          <span className="text-slate-400 font-medium">{refProfit >= 0 ? '+' : ''}{formatVNDFull(refProfit)}</span>
        </div>
      </div>

      {/* ROI */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {isScreen ? 'ROI (Ước tính)' : 'ROI'}
          </span>
          <div className={cn('p-1.5 rounded-md', isScreen ? 'bg-amber-50' : roi >= 0 ? 'bg-emerald-50' : 'bg-red-50')}>
            <Percent size={14} className={roiColor} />
          </div>
        </div>
        <p className={cn('text-xl font-semibold', roiColor)}>{formatROI(roi)}</p>
        <div className="mt-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1">
            {isScreen ? <TrendingUp size={10} /> : <Monitor size={10} />} {refLabel}
          </span>
          <span className="text-slate-400 font-medium">{formatROI(refRoi)}</span>
        </div>
      </div>
    </div>
  )
}
