'use client'

import { cn, formatVND, formatCid } from '@/lib/utils'

export interface OverviewRow {
  project_id: string
  name: string
  cid: string
  campaign_id: string
  spend: number
  revenue: number
  roi: number | null
  score: number
  highCount: number
  actionCount: number
  topAction: string | null
  topType: string | null
  hasMetrics: boolean
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400', right ? 'text-right' : 'text-left')}>{children}</th>
}

function scoreColor(s: number) {
  return s >= 70 ? 'text-green-600' : s >= 45 ? 'text-amber-600' : 'text-red-600'
}

export default function PortfolioTable({ rows, onSelect }: { rows: OverviewRow[]; onSelect: (projectId: string) => void }) {
  if (rows.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Chưa có camp nào (đã gắn Google campaign) để phân tích.</div>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <Th>Camp</Th><Th right>Chi phí</Th><Th right>DT Màn hình</Th><Th right>ROI</Th>
              <Th right>Điểm</Th><Th right>Gợi ý</Th><Th>Hành động hàng đầu</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(r => {
              const losing = r.roi != null && r.roi < 0
              return (
                <tr
                  key={r.project_id}
                  onClick={() => onSelect(r.project_id)}
                  className={cn('cursor-pointer transition-colors hover:bg-slate-50', losing && 'bg-red-50/40')}
                >
                  <td className="px-3 py-2.5">
                    <div className="max-w-[220px] truncate font-medium text-slate-800" title={r.name}>{r.name}</div>
                    <div className="font-mono text-[10px] text-slate-400">{formatCid(r.cid)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatVND(r.spend)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{formatVND(r.revenue)}</td>
                  <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums', r.roi == null ? 'text-slate-400' : r.roi >= 20 ? 'text-green-600' : r.roi < 0 ? 'text-red-600' : 'text-amber-600')}>
                    {r.roi == null ? '—' : `${r.roi.toFixed(0)}%`}
                  </td>
                  <td className={cn('px-3 py-2.5 text-right font-bold tabular-nums', scoreColor(r.score))}>{r.score}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.highCount > 0 && <span className="mr-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{r.highCount} gấp</span>}
                    <span className="text-slate-500">{r.actionCount}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="line-clamp-1 max-w-[280px] text-slate-600" title={r.topAction ?? ''}>
                      {r.hasMetrics ? (r.topAction ?? '— ổn —') : <span className="text-slate-400">chưa có số liệu</span>}
                    </span>
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
