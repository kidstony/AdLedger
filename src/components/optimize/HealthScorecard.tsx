'use client'

import { cn, formatVND } from '@/lib/utils'
import type { CampaignHealth, CampaignSettings } from '@/lib/types'

const intFmt = new Intl.NumberFormat('en-US')
const fmtCount = (n: number) => intFmt.format(Math.round(n))

const BID_LABEL: Record<string, string> = {
  MANUAL_CPC: 'Manual CPC', MAXIMIZE_CONVERSIONS: 'Tối đa chuyển đổi',
  MAXIMIZE_CONVERSION_VALUE: 'Tối đa giá trị CĐ', TARGET_CPA: 'Target CPA',
  TARGET_ROAS: 'Target ROAS', TARGET_SPEND: 'Tối đa click',
  TARGET_IMPRESSION_SHARE: 'Target IS', MANUAL_CPM: 'Manual CPM', MANUAL_CPV: 'Manual CPV',
  PERCENT_CPC: 'Percent CPC', COMMISSION: 'Commission',
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-600'
  if (score >= 45) return 'text-amber-600'
  return 'text-red-600'
}

// Mũi tên thay đổi vs kỳ trước. goodUp=true: tăng là tốt (xanh); false: tăng là xấu (đỏ).
function Delta({ value, unit, goodUp }: { value: number | null | undefined; unit: '%' | 'pt'; goodUp: boolean }) {
  if (value == null || Math.abs(value) < 0.5) return null
  const up = value > 0
  const good = up === goodUp
  return (
    <span className={cn('ml-1 align-middle text-[10px] font-semibold', good ? 'text-green-600' : 'text-red-600')}>
      {up ? '▲' : '▼'}{Math.abs(value).toFixed(0)}{unit === '%' ? '%' : 'pt'}
    </span>
  )
}

function Tile({ label, value, sub, tone = 'default', delta, help }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad'; delta?: React.ReactNode; help?: string
}) {
  const toneCls = {
    default: 'text-slate-800', good: 'text-green-600', warn: 'text-amber-600', bad: 'text-red-600',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div title={help} className={cn('text-[11px] font-medium uppercase tracking-wide text-slate-400', help && 'cursor-help underline decoration-dotted decoration-slate-300')}>{label}</div>
      <div className={cn('mt-1 text-xl font-bold tabular-nums', toneCls)}>{value}{delta}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}

export default function HealthScorecard({ health, cost, confirmedRevenue, settings }: {
  health: CampaignHealth
  cost: { spend: number; rental: number; other: number; total: number }
  confirmedRevenue: number
  settings?: CampaignSettings | null
}) {
  const roiTone = health.roi == null ? 'default' : health.roi >= 20 ? 'good' : health.roi < 0 ? 'bad' : 'warn'
  const cpcWithin = health.cpcTrendPct
  const wow = health.trend

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
          <span title="Doanh thu hiển thị sớm trên dashboard network — tín hiệu nhanh, CHƯA phải tiền đã nhận." className="cursor-help text-slate-500 underline decoration-dotted decoration-slate-300">DT Màn hình: <b className="text-slate-800">{formatVND(health.revenue)}</b><Delta value={wow?.revenuePct} unit="%" goodUp /></span>
          <span title="Doanh thu đã xác nhận/chốt — tiền chắc chắn, nhưng về trễ theo chu kỳ thanh toán." className="cursor-help text-amber-600 underline decoration-dotted decoration-amber-300">DT Thực: <b>{formatVND(confirmedRevenue)}</b></span>
          <span className="text-slate-500">Chi phí QC: <b className="text-slate-800">{formatVND(cost.spend)}</b><Delta value={wow?.spendPct} unit="%" goodUp={false} /></span>
          {cost.rental > 0 && <span className="text-slate-500">Thuê TK: <b className="text-slate-800">{formatVND(cost.rental)}</b></span>}
          {cost.other > 0 && <span className="text-slate-500">CP khác: <b className="text-slate-800">{formatVND(cost.other)}</b></span>}
          <span className="text-slate-500">Tổng chi phí: <b className="text-slate-800">{formatVND(cost.total)}</b></span>
          {settings?.daily_budget != null && (
            <span className="text-slate-500">Ngân sách/ngày: <b className="text-slate-800">{formatVND(settings.daily_budget)}</b></span>
          )}
          {settings?.bidding_strategy && (
            <span className="text-slate-500">Bid: <b className="text-slate-800">{BID_LABEL[settings.bidding_strategy] ?? settings.bidding_strategy}</b></span>
          )}
        </div>
      </div>

      {/* Chỉ số hiệu suất */}
      {wow && <p className="text-[11px] text-slate-400">▲▼ = thay đổi so với kỳ trước cùng độ dài (xanh = tốt lên, đỏ = xấu đi). Rê chuột vào tên chỉ số để xem giải thích.</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="ROI" value={health.roi == null ? '—' : `${health.roi.toFixed(1)}%`} tone={roiTone}
          help="Lãi/lỗ trên mỗi $1 chi phí. ROI 20% = bỏ $1 thu về $1.2. Âm = đang lỗ."
          delta={<Delta value={wow?.roiDelta} unit="pt" goodUp />}
          sub={health.roi == null ? 'chưa có chi phí' : 'theo DT Màn hình'} />
        <Tile label="CTR" value={`${health.ctr.toFixed(2)}%`}
          help="Tỉ lệ người thấy quảng cáo rồi bấm vào. CTR thấp = mẫu quảng cáo chưa hấp dẫn/đúng ý tìm kiếm."
          delta={<Delta value={wow?.ctrDelta} unit="pt" goodUp />}
          sub={`${fmtCount(health.clicks)} click / ${fmtCount(health.impressions)} hiển thị`} />
        <Tile label="CPC trung bình" value={formatVND(health.avgCpc)}
          help="Giá trả cho mỗi click. CPC tăng dần = traffic đang đắt lên, bào mòn lãi."
          tone={cpcWithin != null && cpcWithin > 25 ? 'warn' : 'default'}
          delta={<Delta value={wow?.cpcPct} unit="%" goodUp={false} />}
          sub={cpcWithin == null ? undefined : `${cpcWithin >= 0 ? '+' : ''}${cpcWithin.toFixed(1)}% cuối kỳ`} />
        <Tile label="Impression Share"
          help="Bạn xuất hiện được bao nhiêu % số lần có thể xuất hiện. Mất do ngân sách = hết tiền giữa chừng; mất do thứ hạng = thua đấu giá."
          value={health.impressionShare == null ? '—' : `${health.impressionShare.toFixed(0)}%`}
          delta={<Delta value={wow?.isDelta} unit="pt" goodUp />}
          sub={[
            health.isLostBudget != null ? `mất ${health.isLostBudget.toFixed(0)}% do ngân sách` : null,
            health.absTopIs != null ? `top tuyệt đối ${health.absTopIs.toFixed(0)}%` : null,
          ].filter(Boolean).join(' · ') || undefined} />
      </div>
    </div>
  )
}
