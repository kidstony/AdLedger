import { TrendingUp, TrendingDown, DollarSign, Percent } from 'lucide-react'
import { formatVNDFull, formatROI, cn } from '@/lib/utils'

interface Props {
  totalSpend: number
  totalRevenue: number
  totalProfit: number
  avgRoi: number
}

export default function SummaryCards({ totalSpend, totalRevenue, totalProfit, avgRoi }: Props) {
  const cards = [
    {
      label: 'Tổng Chi phí',
      value: formatVNDFull(totalSpend),
      icon: DollarSign,
      color: 'text-slate-600',
      bg: 'bg-slate-50',
    },
    {
      label: 'Tổng Doanh thu',
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
      label: 'ROI trung bình',
      value: formatROI(avgRoi),
      icon: Percent,
      color: avgRoi >= 0 ? 'text-emerald-600' : 'text-red-600',
      bg: avgRoi >= 0 ? 'bg-emerald-50' : 'bg-red-50',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map(card => (
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
  )
}
