import { TrendingUp, TrendingDown, DollarSign, Percent, Monitor, Clock } from 'lucide-react'
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
  const row1 = [
    {
      label: 'Tổng Chi phí',
      value: formatVNDFull(totalSpend),
      icon: DollarSign,
      color: 'text-slate-600',
      bg: 'bg-slate-50',
    },
    {
      label: 'Doanh thu thực',
      value: formatVNDFull(totalRevenue),
      icon: TrendingUp,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: 'Lợi nhuận',
      value: formatVNDFull(totalProfit),
      icon: totalProfit >= 0 ? TrendingUp : TrendingDown,
      color: totalProfit >= 0 ? 'text-green-600' : 'text-red-600',
      bg: totalProfit >= 0 ? 'bg-green-50' : 'bg-red-50',
    },
    {
      label: 'ROI',
      value: formatROI(avgRoi),
      icon: Percent,
      color: avgRoi >= 0 ? 'text-emerald-600' : 'text-red-600',
      bg: avgRoi >= 0 ? 'bg-emerald-50' : 'bg-red-50',
    },
  ]

  const row2 = [
    {
      label: 'Tiền màn hình',
      value: formatVNDFull(totalScreen),
      icon: Monitor,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      sub: 'Hiển thị trên affiliate platform',
    },
    {
      label: 'Đang chờ thanh toán',
      value: formatVNDFull(totalPending),
      icon: Clock,
      color: totalPending > 0 ? 'text-amber-600' : 'text-slate-400',
      bg: totalPending > 0 ? 'bg-amber-50' : 'bg-slate-50',
      sub: 'Màn hình − Đã nhận',
    },
    {
      label: 'ROI ước tính',
      value: formatROI(estimatedRoi),
      icon: Percent,
      color: estimatedRoi >= 0 ? 'text-emerald-600' : 'text-red-600',
      bg: estimatedRoi >= 0 ? 'bg-emerald-50' : 'bg-red-50',
      sub: 'Tính theo tiền màn hình',
    },
  ]

  return (
    <div className="space-y-3">
      {/* Hàng 1: số liệu thực */}
      <div className="grid grid-cols-4 gap-4">
        {row1.map(card => (
          <div key={card.label} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{card.label}</span>
              <div className={cn('p-1.5 rounded-md', card.bg)}>
                <card.icon size={14} className={card.color} />
              </div>
            </div>
            <p className={cn('text-xl font-semibold', card.color)}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Hàng 2: tiền màn hình */}
      <div className="grid grid-cols-4 gap-4">
        {row2.map(card => (
          <div key={card.label} className="bg-white rounded-lg border border-blue-100 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{card.label}</span>
                {'sub' in card && <p className="text-[10px] text-slate-400 mt-0.5">{card.sub}</p>}
              </div>
              <div className={cn('p-1.5 rounded-md', card.bg)}>
                <card.icon size={13} className={card.color} />
              </div>
            </div>
            <p className={cn('text-lg font-semibold', card.color)}>{card.value}</p>
          </div>
        ))}
        {/* Ô 4: tỉ lệ đã thu */}
        <div className="bg-white rounded-lg border border-blue-100 p-4 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Tỉ lệ đã thu</span>
          {totalScreen > 0 ? (
            <>
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-green-600 font-medium">{((totalRevenue / totalScreen) * 100).toFixed(0)}%</span>
                  <span className="text-slate-400">{((totalPending / totalScreen) * 100).toFixed(0)}% chờ</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.min((totalRevenue / totalScreen) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-lg font-semibold text-slate-300">—</p>
          )}
        </div>
      </div>
    </div>
  )
}
