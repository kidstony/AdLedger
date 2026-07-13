import { TrendingUp, TrendingDown, DollarSign, Percent, Monitor } from 'lucide-react'
import { formatVNDFull, formatROI } from '@/lib/utils'
import StatCard from '@/components/ui/StatCard'

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
  const RefIcon = isScreen ? TrendingUp : Monitor
  const refRow = (value: string) => (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1"><RefIcon size={10} /> {refLabel}</span>
      <span className="font-medium">{value}</span>
    </div>
  )

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        label="Tổng chi phí"
        value={formatVNDFull(totalSpend)}
        icon={DollarSign}
        sub={<span className="text-slate-300">QC + Thuê TK + CP khác</span>}
      />
      <StatCard
        label={isScreen ? 'Doanh thu (màn hình)' : 'Doanh thu'}
        value={formatVNDFull(revenue)}
        valueClass={revenueColor}
        icon={isScreen ? Monitor : TrendingUp}
        iconWrapClass={isScreen ? 'bg-amber-50 text-amber-500' : 'bg-blue-50 text-blue-600'}
        sub={refRow(formatVNDFull(refRevenue))}
      />
      <StatCard
        label={isScreen ? 'Lợi nhuận (màn hình)' : 'Lợi nhuận'}
        value={`${profit >= 0 ? '+' : ''}${formatVNDFull(profit)}`}
        valueClass={profitColor}
        icon={profit >= 0 ? TrendingUp : TrendingDown}
        iconWrapClass={isScreen ? 'bg-amber-50 text-amber-500' : profit >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}
        sub={refRow(`${refProfit >= 0 ? '+' : ''}${formatVNDFull(refProfit)}`)}
      />
      <StatCard
        label={isScreen ? 'ROI (màn hình)' : 'ROI'}
        value={formatROI(roi)}
        valueClass={roiColor}
        icon={Percent}
        iconWrapClass={isScreen ? 'bg-amber-50 text-amber-500' : roi >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}
        sub={refRow(formatROI(refRoi))}
      />
    </div>
  )
}
