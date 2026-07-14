import { EvalMetric, RuleEvalSpec } from './defaults'

// ─────────────────────────────────────────────────────────────────────────────
// Vòng đo kết quả (feedback loop) — toán thuần.
//
// User bấm "Đã áp dụng" → engine chờ EV_WINDOW_DAYS rồi so cửa sổ TRƯỚC (N ngày
// mature kết thúc tại ngày áp dụng) vs cửa sổ SAU (N ngày mature sau ngày áp
// dụng) trên đúng metric của rule. Cải thiện ≥ EV_WIN_PCT → 'won'; xấu đi ≥
// EV_WIN_PCT → 'lost'; lưng chừng → 'inconclusive'. Nếu ≥2 đề xuất áp cùng camp
// với cửa sổ chồng nhau → 'confounded' (không biết thay đổi nào tạo kết quả —
// hiện UI nhưng KHÔNG tính vào độ tin cậy rule).
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalDailyStat {
  date: string
  spend: number
  revenue_screen: number
  clicks: number
  impressions: number
  mature: boolean
}

export interface EvalOutcome {
  status: 'need_more_data' | 'done'
  verdict?: 'won' | 'lost' | 'inconclusive'
  metric: EvalMetric
  pre: number | null
  post: number | null
  deltaPct: number | null
  postClicks: number
  note?: string
}

// Gộp metric trên 1 cửa sổ ngày (tổng-trước-rồi-chia, không trung bình các tỷ lệ ngày).
function windowMetric(rows: EvalDailyStat[], metric: EvalMetric): number | null {
  if (!rows.length) return null
  const spend = rows.reduce((s, r) => s + r.spend, 0)
  const rev = rows.reduce((s, r) => s + r.revenue_screen, 0)
  const clicks = rows.reduce((s, r) => s + r.clicks, 0)
  const impr = rows.reduce((s, r) => s + r.impressions, 0)
  switch (metric) {
    case 'spend': return spend
    case 'revenue_screen': return rev
    case 'profit': return rev - spend
    case 'cpc': return clicks > 0 ? spend / clicks : null
    case 'ctr': return impr > 0 ? (clicks / impr) * 100 : null
    case 'roi': return spend > 0 ? ((rev - spend) / spend) * 100 : null
  }
}

export function evaluateOutcome(opts: {
  spec: RuleEvalSpec
  appliedDate: string          // YYYY-MM-DD (ngày user bấm Đã áp dụng)
  stats: EvalDailyStat[]       // đủ dài để phủ cả 2 cửa sổ
  windowDays: number
  winPct: number               // EV_WIN_PCT
}): EvalOutcome {
  const { spec, appliedDate, windowDays, winPct } = opts
  const mature = opts.stats.filter(s => s.mature).sort((a, b) => a.date.localeCompare(b.date))

  const preRows = mature.filter(s => s.date <= appliedDate).slice(-windowDays)
  const postRows = mature.filter(s => s.date > appliedDate).slice(0, windowDays)
  const postClicks = postRows.reduce((s, r) => s + r.clicks, 0)

  // Cửa sổ SAU chưa đủ ngày mature / chưa đủ click → chờ thêm (engine gia hạn 1 lần).
  const minClicks = spec.minClicks ?? 0
  if (postRows.length < Math.max(3, Math.floor(windowDays * 0.6)) || postClicks < minClicks) {
    return { status: 'need_more_data', metric: spec.metric, pre: null, post: null, deltaPct: null, postClicks }
  }

  const pre = windowMetric(preRows, spec.metric)
  const post = windowMetric(postRows, spec.metric)
  if (pre == null || post == null) {
    return {
      status: 'done', verdict: 'inconclusive', metric: spec.metric,
      pre, post, deltaPct: null, postClicks,
      note: 'Thiếu dữ liệu để tính metric ở một trong hai cửa sổ',
    }
  }

  // delta theo hướng "tốt lên": up → post − pre; down → pre − post.
  // Ngưỡng thắng/thua = winPct% của |pre| (có sàn nhỏ để pre ~ 0 không chia rác).
  const rawDelta = spec.successWhen === 'up' ? post - pre : pre - post
  const floorByMetric: Record<EvalMetric, number> = {
    cpc: 0.02, ctr: 0.2, roi: 5, revenue_screen: 2, spend: 2, profit: 2,
  }
  const threshold = Math.max(Math.abs(pre) * (winPct / 100), floorByMetric[spec.metric])
  const deltaPct = pre !== 0 ? (rawDelta / Math.abs(pre)) * 100 : null

  let verdict: 'won' | 'lost' | 'inconclusive' = 'inconclusive'
  if (rawDelta >= threshold) verdict = 'won'
  else if (rawDelta <= -threshold) verdict = 'lost'

  return { status: 'done', verdict, metric: spec.metric, pre, post, deltaPct, postClicks }
}

// 2 khoảng [aStart, aEnd] và [bStart, bEnd] (ISO date) có chồng nhau không.
export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}
