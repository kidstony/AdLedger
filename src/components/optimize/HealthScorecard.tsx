'use client'

import { cn, formatVND } from '@/lib/utils'
import type { CampaignHealth } from '@/lib/types'

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600'
  if (score >= 45) return 'text-amber-600'
  return 'text-red-600'
}

function Tile({ label, value, sub, tone = 'default' }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad'
}) {
  const toneCls = {
    default: 'text-slate-800', good: 'text-green-600', warn: 'text-amber-600', bad: 'text-red-600',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn('mt-1 text-xl font-bold tabular-nums', toneCls)}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

export default function HealthScorecard({ health, cost }: {
  health: CampaignHealth
  cost: { spend: number; rental: number; other: number; total: number }
}) {
  const roiTone = health.roi == null ? 'default' : health.roi >= 20 ? 'good' : health.roi < 0 ? 'bad' : 'warn'
  const trend = health.cpcTrendPct

  return (
    <div className="space-y-3">
      {/* Điểm sức khỏe + P&L */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={cn('text-4xl font-extrabold tabular-nums', scoreColor(health.score))}>{health.score}</div>
          <div className="text-xs text-slate-400">
            <div className="font-medium text-slate-500">Điểm sức khỏe</div>
            <div>/ 100</div>
          </div>
        </div>
        <div className="h-10 w-px bg-slate-200" />
        <div className="flex flex-1 flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="text-slate-500">Doanh thu: <b className="text-slate-800">{formatVND(health.revenue)}</b></span>
          <span className="text-slate-500">Chi phí QC: <b className="text-slate-800">{formatVND(cost.spend)}</b></span>
          {cost.rental > 0 && <span className="text-slate-500">Thuê TK: <b className="text-slate-800">{formatVND(cost.rental)}</b></span>}
          {cost.other > 0 && <span className="text-slate-500">CP khác: <b className="text-slate-800">{formatVND(cost.other)}</b></span>}
          <span className="text-slate-500">Tổng chi phí: <b className="text-slate-800">{formatVND(cost.total)}</b></span>
        </div>
      </div>

      {/* Chỉ số hiệu suất */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="ROI" value={health.roi == null ? '—' : `${health.roi.toFixed(1)}%`} tone={roiTone}
          sub={health.roi == null ? 'chưa có chi phí' : undefined} />
        <Tile label="CTR" value={`${health.ctr.toFixed(2)}%`}
          sub={`${formatVND(health.clicks)} click / ${formatVND(health.impressions)} hiển thị`} />
        <Tile label="CPC trung bình" value={formatVND(health.avgCpc)}
          tone={trend != null && trend > 25 ? 'warn' : 'default'}
          sub={trend == null ? undefined : `${trend >= 0 ? '+' : ''}${trend.toFixed(1)}% cuối kỳ`} />
        <Tile label="Impression Share"
          value={health.impressionShare == null ? '—' : `${health.impressionShare.toFixed(0)}%`}
          sub={health.isLostBudget != null ? `mất ${health.isLostBudget.toFixed(0)}% do ngân sách` : undefined} />
      </div>
    </div>
  )
}
