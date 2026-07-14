import { Thresholds } from './defaults'

// ─────────────────────────────────────────────────────────────────────────────
// Phiếu test — toán thuần: sinh nội dung phiếu từ đột biến cơ hội / giả thuyết
// win-day, và chấm điểm hằng ngày cho phiếu đang chạy.
//
// Vòng đời phiếu: proposed → accepted → awaiting_camp → running →
//                 won / lost / stopped (chạm stop-loss) | abandoned | expired
// ─────────────────────────────────────────────────────────────────────────────

export interface TicketTarget {
  geo?: string          // mã nước (ISO alpha-2 hoặc geo id)
  geoLabel?: string     // tên nước dễ đọc
  device?: string
  hours?: number[]
  offer?: string
  keywords?: string[]
  notes?: string
}

export interface TicketDraft {
  hypothesis: string
  target: TicketTarget
  test_budget: number
  max_days: number
  min_clicks: number
  success_criteria: { metric: 'roi'; threshold: number; min_revenue: number }
  stoploss: { max_spend_no_revenue: number }
  control: Record<string, unknown>   // snapshot camp nguồn lúc tạo phiếu
}

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number) => '$' + usdFmt.format(n)

// Sinh phiếu mặc định (user sửa được khi chấp nhận).
export function synthesizeTicket(opts: {
  th: Thresholds
  hypothesis: string
  target: TicketTarget
  sourceMedianDailySpend: number      // median chi/ngày của camp nguồn (để gợi budget test)
  control: Record<string, unknown>
}): TicketDraft {
  const { th } = opts
  const budget = Math.max(5, Math.min(opts.sourceMedianDailySpend > 0 ? opts.sourceMedianDailySpend * 3 : th.TK_MAX_BUDGET, th.TK_MAX_BUDGET))
  return {
    hypothesis: opts.hypothesis,
    target: opts.target,
    test_budget: Math.round(budget),
    max_days: th.TK_MAX_DAYS,
    min_clicks: th.TK_MIN_CLICKS,
    success_criteria: { metric: 'roi', threshold: th.TARGET_ROI, min_revenue: th.TK_MIN_REVENUE },
    stoploss: { max_spend_no_revenue: Math.round(budget) },
    control: opts.control,
  }
}

export interface TicketDay {
  date: string
  spend: number
  revenue: number
  clicks: number
  roi: number | null
}

export interface TicketVerdict {
  verdict: 'running' | 'won' | 'lost' | 'stopped'
  totals: { spend: number; revenue: number; clicks: number; roi: number | null; days: number }
  reason: string
}

// Chấm phiếu đang chạy theo log ngày tích lũy.
export function evaluateTicket(opts: {
  log: TicketDay[]
  th: Thresholds
  maxDays: number
  minClicks: number
  criteria: { threshold: number; min_revenue: number }
  stoploss: { max_spend_no_revenue: number }
}): TicketVerdict {
  const days = opts.log.filter(d => d.spend > 0 || d.revenue > 0)
  const spend = days.reduce((s, d) => s + d.spend, 0)
  const revenue = days.reduce((s, d) => s + d.revenue, 0)
  const clicks = days.reduce((s, d) => s + d.clicks, 0)
  const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null
  const totals = { spend, revenue, clicks, roi, days: days.length }

  // Stop-loss bất kỳ lúc nào: tiêu hết ngân sách mà tiền về < 20% chi.
  if (spend >= opts.stoploss.max_spend_no_revenue && revenue < spend * 0.2) {
    return { verdict: 'stopped', totals, reason: `Đã tiêu ${money(spend)} mà doanh thu chỉ ${money(revenue)} — chạm stop-loss, dừng test.` }
  }

  // Thắng sớm: đủ ngày tối thiểu + đủ click + đủ doanh thu + ROI vượt ngưỡng.
  if (days.length >= opts.th.TK_MIN_DAYS
      && clicks >= opts.minClicks
      && revenue >= opts.criteria.min_revenue
      && roi != null && roi >= opts.criteria.threshold) {
    return { verdict: 'won', totals, reason: `ROI ${roi.toFixed(0)}% ≥ ${opts.criteria.threshold}% với ${clicks} click sau ${days.length} ngày — giả thuyết ĐÚNG.` }
  }

  // Hết hạn test: chốt theo ROI cuối cùng.
  if (days.length >= opts.maxDays) {
    if (revenue >= opts.criteria.min_revenue && roi != null && roi >= opts.criteria.threshold) {
      return { verdict: 'won', totals, reason: `Hết ${opts.maxDays} ngày: ROI ${roi.toFixed(0)}% đạt ngưỡng — giả thuyết ĐÚNG.` }
    }
    return { verdict: 'lost', totals, reason: `Hết ${opts.maxDays} ngày: ROI ${roi != null ? roi.toFixed(0) + '%' : 'không tính được'} dưới ngưỡng ${opts.criteria.threshold}% — giả thuyết SAI.` }
  }

  return { verdict: 'running', totals, reason: `Đang chạy ngày ${days.length}/${opts.maxDays}.` }
}
