'use client'

import { DailyPnlRow } from '@/lib/types'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatVND, formatROI, getProfitTextClass, getRoiTextClass } from '@/lib/utils'

interface Props { data: DailyPnlRow[]; view: 'screen' | 'confirmed' }

export default function DailyPnlTable({ data, view }: Props) {
  if (!data.length) return null

  const isScreen = view === 'screen'
  const headers = isScreen
    ? ['Ngày', 'Tổng chi phí', 'Tiền màn hình', 'LN màn hình', 'ROI%']
    : ['Ngày', 'Tổng chi phí', 'Doanh thu', 'Lợi nhuận', 'ROI%']

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
      <div className="overflow-auto max-h-80">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
            <tr>
              {headers.map(h => (
                <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map(row => {
              const revenue = isScreen ? row.screenRevenue : row.revenue
              const profit  = isScreen ? row.screenProfit : row.profit
              const roi     = isScreen ? row.screenRoi : row.roi
              return (
                <tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{row.date}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                    {row.cost > 0 ? (
                      <Tooltip>
                        <TooltipTrigger className="border-b border-dotted border-slate-300 cursor-help">
                          {formatVND(row.cost)}
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex flex-col gap-0.5 text-left min-w-[120px]">
                            <div className="flex justify-between gap-4"><span>QC</span><span className="font-mono">{formatVND(row.spend)}</span></div>
                            <div className="flex justify-between gap-4"><span>Thuê TK</span><span className="font-mono">{row.rentalDay > 0 ? formatVND(row.rentalDay) : '—'}</span></div>
                            <div className="flex justify-between gap-4"><span>CP khác</span><span className="font-mono">{row.otherDay > 0 ? formatVND(row.otherDay) : '—'}</span></div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs ${isScreen ? 'text-amber-500' : 'text-slate-600'}`}>
                    {formatVND(revenue)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs ${isScreen ? 'text-amber-500' : getProfitTextClass(profit)}`}>
                    {(profit >= 0 ? '+' : '') + formatVND(profit)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs ${isScreen ? 'text-amber-500' : getRoiTextClass(roi)}`}>
                    {formatROI(roi)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
