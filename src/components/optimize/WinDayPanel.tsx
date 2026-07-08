'use client'

import { cn, formatVND } from '@/lib/utils'
import type { WinDayAnalysis } from '@/lib/types'

const DIM_LABEL: Record<string, string> = { geo: 'Quốc gia', device: 'Thiết bị', hour: 'Giờ', search_term: 'Search term' }

function LiftTable({ title, hint, rows, positive }: {
  title: string; hint: string
  rows: WinDayAnalysis['lifts']; positive: boolean
}) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className={cn('text-sm font-semibold', positive ? 'text-green-700' : 'text-red-700')}>{title}</h3>
        <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
        <p className="mt-0.5 text-[10px] text-slate-400">
          Share = phân khúc này chiếm bao nhiêu % chi phí trong nhóm ngày đó · Lệch (pp) = hiệu 2 con số — lệch càng lớn, tín hiệu càng rõ.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">Phân khúc</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400">Loại</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">Share ngày lãi</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">Share ngày lỗ</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">Lệch</th>
              <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400">Chi phí kỳ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((l, i) => (
              <tr key={i}>
                <td className="max-w-[220px] truncate px-3 py-2 font-medium text-slate-700" title={l.label}>{l.label}</td>
                <td className="px-3 py-2 text-slate-400">{DIM_LABEL[l.dim] ?? l.dim}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{l.shareWinPct.toFixed(0)}%</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{l.shareLosePct.toFixed(0)}%</td>
                <td
                  title={positive
                    ? `Ngày lãi dồn ${l.shareWinPct.toFixed(0)}% chi phí vào "${l.label}", ngày lỗ chỉ ${l.shareLosePct.toFixed(0)}% → ngày nào tiêu nhiều vào đây thường là ngày lãi.`
                    : `Ngày lỗ dồn ${l.shareLosePct.toFixed(0)}% chi phí vào "${l.label}", ngày lãi chỉ ${l.shareWinPct.toFixed(0)}% → ngày nào tiêu nhiều vào đây thường là ngày lỗ.`}
                  className={cn('cursor-help px-3 py-2 text-right font-semibold tabular-nums underline decoration-dotted', positive ? 'text-green-600' : 'text-red-600')}>
                  {l.liftPp > 0 ? '+' : ''}{l.liftPp.toFixed(0)}pp
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-800">{formatVND(l.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function WinDayPanel({ analysis }: { analysis: WinDayAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 text-center text-xs text-slate-400">
        Chưa đủ dữ liệu để phân tích ngày thắng/thua — cần ≥ 6 ngày &ldquo;chín&rdquo; (đã nhập doanh thu)
        có cả ngày lãi lẫn ngày lỗ. Thử chọn khoảng 14–30 ngày.
      </div>
    )
  }

  const positives = analysis.lifts.filter(l => l.liftPp > 0)
  const negatives = [...analysis.lifts.filter(l => l.liftPp < 0)].sort((a, b) => a.liftPp - b.liftPp)

  return (
    <div className="space-y-3">
      {/* Dải ngày lãi/lỗ */}
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">
            {analysis.matureDays} ngày chín · <span className="text-green-600">{analysis.winDays.length} lãi</span> · <span className="text-red-600">{analysis.loseDays.length} lỗ</span>
          </span>
          <span className="text-[10px] text-slate-400">🟩 ngày lãi · 🟥 ngày lỗ · hover xem số</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {analysis.days.map(d => (
            <span
              key={d.date}
              title={`${d.date}: DT ${formatVND(d.revenue)} − chi ${formatVND(d.spend)} = ${d.profit >= 0 ? '+' : ''}${formatVND(d.profit)}`}
              className={cn(
                'h-6 min-w-6 cursor-help rounded px-1 text-center text-[10px] leading-6 font-medium',
                d.profit > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
              )}
            >
              {d.date.slice(8)}
            </span>
          ))}
        </div>
      </div>

      {analysis.lifts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-center text-xs text-slate-400">
          Cơ cấu phân khúc giữa ngày lãi và ngày lỗ không lệch đáng kể (&lt;10pp) — chưa có giả thuyết tách rõ ràng.
        </div>
      ) : (
        <>
          <LiftTable positive title="Nghiêng về ngày lãi — ứng viên tách/tăng"
            hint="Phân khúc chiếm tỉ trọng chi phí cao hơn hẳn trong các ngày lãi (tương quan — cần test tách để xác nhận)."
            rows={positives} />
          <LiftTable positive={false} title="Nghiêng về ngày lỗ — ứng viên giảm/loại trừ"
            hint="Phân khúc chiếm tỉ trọng chi phí cao hơn hẳn trong các ngày lỗ."
            rows={negatives} />
        </>
      )}
    </div>
  )
}
