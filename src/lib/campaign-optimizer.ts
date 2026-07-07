import {
  CampaignHealth,
  CampaignMetric,
  CampaignOptimizerResult,
  KeywordAgg,
  KeywordMetric,
  OptimizationSuggestion,
  OptSeverity,
  SearchTermAgg,
  SearchTermMetric,
  SegmentAgg,
  SegmentMetric,
  SegmentType,
} from './types'
import { countryNameByGeoId } from './geo-targets'

// ─────────────────────────────────────────────────────────────────────────────
// Rule engine tối ưu campaign — DETERMINISTIC, giải thích được, KHÔNG dùng LLM.
//
// Cơ sở doanh thu = DT Màn hình (screen revenue, affiliate_revenue type='pending')
// vì có sớm, kịp cho tối ưu. Affiliate KHÔNG có conversion tracking nên tín hiệu
// tiền chỉ biết ở mức project × ngày. Vì vậy:
//   • confidence 'roi'        → dùng DT Màn hình → gợi ý CHẮC (scale/cut/budget).
//   • confidence 'engagement' → chỉ tín hiệu hiệu suất (CTR/CPC/IS) → "cần xem xét".
//
// Ngưỡng gom ở CFG để chỉnh 1 chỗ. Đơn vị tiền = đơn vị tài khoản Google Ads.
// ─────────────────────────────────────────────────────────────────────────────

export const CFG = {
  MIN_SPEND_TO_JUDGE: 200_000,   // dưới mức này chưa đủ dữ liệu để kết luận cắt
  MIN_DAYS_TO_JUDGE: 3,          // cần ít nhất N ngày dữ liệu
  LOSS_ROI: -20,                 // ROI% dưới mức này = đang lỗ nặng → cắt
  TARGET_ROI: 20,                // ROI% trên mức này = đủ lãi để scale
  IS_BUDGET_THRESHOLD: 0.10,     // IS mất do budget > 10% → tăng budget
  IS_RANK_THRESHOLD: 0.15,       // IS mất do rank > 15% → tăng bid
  CPC_TREND_ALERT: 25,           // CPC nửa sau tăng > 25% so nửa đầu → cảnh báo margin
  CTR_FLOOR: 1.0,                // CTR% dưới mức này (search) → nghi mẫu QC kém
  MIN_IMPR_FOR_CTR: 500,         // cần đủ impression mới kết luận CTR
  // P2 — keyword & search term (engagement, không có doanh thu ở mức này):
  KW_COST_FRACTION: 0.03,        // keyword/term chi phí ≥ 3% chi phí campaign = đáng kể
  LOW_CTR_RATIO: 0.5,            // CTR < 50% CTR campaign = kém
  QS_LOW: 3,                     // quality score ≤ 3 = kém
  BREAKDOWN_LIMIT: 20,           // số dòng tối đa trả về cho bảng breakdown
} as const

export interface OptimizerInput {
  campaign_id: string
  campaignLabel: string
  project_id?: string
  metrics: CampaignMetric[]              // campaign_metrics theo ngày (đã lọc kỳ)
  revenueByDate: Record<string, number>  // DT Màn hình theo ngày (project)
  spendByDate: Record<string, number>    // ad_spend theo ngày (nguồn P&L)
  totalRevenue: number                   // DT Màn hình trong kỳ
  totalCost: number                      // spend + rental + other (P&L cost)
  totalSpend: number                     // riêng ad spend
  keywords?: KeywordMetric[]             // keyword_metrics theo ngày (P2)
  searchTerms?: SearchTermMetric[]       // search_term_metrics theo ngày (P2)
  segments?: SegmentMetric[]             // segment_metrics device/hour/geo (P3)
}

// Gộp keyword theo (criterion, ad_group) trên toàn kỳ. Sắp theo chi phí giảm dần.
export function aggregateKeywords(rows: KeywordMetric[]): KeywordAgg[] {
  const m = new Map<string, KeywordAgg>()
  for (const r of rows) {
    const key = `${r.criterion_id}|${r.ad_group_id}`
    const e = m.get(key) ?? {
      criterion_id: r.criterion_id, ad_group_id: r.ad_group_id,
      keyword_text: r.keyword_text, match_type: r.match_type,
      impressions: 0, clicks: 0, cost: 0, ctr: 0, avgCpc: 0, quality_score: r.quality_score,
    }
    e.impressions += r.impressions
    e.clicks += r.clicks
    e.cost += r.cost
    if (r.quality_score != null) e.quality_score = r.quality_score
    m.set(key, e)
  }
  const out = [...m.values()]
  for (const e of out) {
    e.ctr = e.impressions > 0 ? (e.clicks / e.impressions) * 100 : 0
    e.avgCpc = e.clicks > 0 ? e.cost / e.clicks : 0
  }
  return out.sort((a, b) => b.cost - a.cost)
}

// Gộp search term theo cụm truy vấn trên toàn kỳ. Sắp theo chi phí giảm dần.
export function aggregateSearchTerms(rows: SearchTermMetric[]): SearchTermAgg[] {
  const m = new Map<string, SearchTermAgg>()
  for (const r of rows) {
    const e = m.get(r.search_term) ?? { search_term: r.search_term, impressions: 0, clicks: 0, cost: 0, ctr: 0 }
    e.impressions += r.impressions
    e.clicks += r.clicks
    e.cost += r.cost
    m.set(r.search_term, e)
  }
  const out = [...m.values()]
  for (const e of out) e.ctr = e.impressions > 0 ? (e.clicks / e.impressions) * 100 : 0
  return out.sort((a, b) => b.cost - a.cost)
}

// Gộp segment (device/hour/geo) theo (type, value) trên toàn kỳ. Sắp theo chi phí.
export function aggregateSegments(rows: SegmentMetric[]): SegmentAgg[] {
  const m = new Map<string, SegmentAgg>()
  for (const r of rows) {
    const key = `${r.segment_type}|${r.segment_value}`
    const e = m.get(key) ?? { segment_type: r.segment_type, segment_value: r.segment_value, impressions: 0, clicks: 0, cost: 0, ctr: 0 }
    e.impressions += r.impressions
    e.clicks += r.clicks
    e.cost += r.cost
    m.set(key, e)
  }
  const out = [...m.values()]
  for (const e of out) e.ctr = e.impressions > 0 ? (e.clicks / e.impressions) * 100 : 0
  return out.sort((a, b) => b.cost - a.cost)
}

const fmtInt = new Intl.NumberFormat('vi-VN')
const money = (n: number) => fmtInt.format(Math.round(n))
const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`

// Trung bình có trọng số theo impressions, bỏ qua null.
function weightedRate(metrics: CampaignMetric[], pick: (m: CampaignMetric) => number | null): number | null {
  let num = 0, den = 0
  for (const m of metrics) {
    const v = pick(m)
    if (v == null) continue
    num += v * m.impressions
    den += m.impressions
  }
  return den > 0 ? num / den : null
}

// Xu hướng CPC: CPC nửa sau vs nửa đầu kỳ (% thay đổi). Null nếu thiếu clicks.
function cpcTrend(metrics: CampaignMetric[]): number | null {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 4) return null
  const mid = Math.floor(sorted.length / 2)
  const cpc = (rows: CampaignMetric[]) => {
    const c = rows.reduce((s, r) => s + r.clicks, 0)
    const cost = rows.reduce((s, r) => s + r.cost, 0)
    return c > 0 ? cost / c : null
  }
  const first = cpc(sorted.slice(0, mid))
  const second = cpc(sorted.slice(mid))
  if (first == null || second == null || first === 0) return null
  return ((second - first) / first) * 100
}

function computeHealth(input: OptimizerInput): CampaignHealth {
  const { metrics, totalRevenue, totalCost, totalSpend } = input
  const impressions = metrics.reduce((s, m) => s + m.impressions, 0)
  const clicks = metrics.reduce((s, m) => s + m.clicks, 0)
  const conversions = metrics.reduce((s, m) => s + (m.conversions ?? 0), 0)
  const metricCost = metrics.reduce((s, m) => s + m.cost, 0)

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
  const avgCpc = clicks > 0 ? metricCost / clicks : 0
  const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : null

  const isRate = weightedRate(metrics, m => m.search_impression_share)
  const isBudget = weightedRate(metrics, m => m.search_budget_lost_is)
  const isRank = weightedRate(metrics, m => m.search_rank_lost_is)

  // Health score 0..100 (heuristic, minh bạch):
  //   ROI (±40), CTR (±20), Impression Share (±20), xu hướng CPC (±20).
  let score = 50
  if (roi != null) score += Math.max(-40, Math.min(40, roi * 0.8))
  score += Math.max(-20, Math.min(20, (ctr - CFG.CTR_FLOOR) * 8))
  if (isRate != null) score += (isRate - 0.5) * 40
  const trend = cpcTrend(metrics)
  if (trend != null) score -= Math.max(0, Math.min(20, trend * 0.4))

  return {
    roi,
    ctr,
    avgCpc,
    cpcTrendPct: trend,
    impressionShare: isRate != null ? isRate * 100 : null,
    isLostBudget: isBudget != null ? isBudget * 100 : null,
    isLostRank: isRank != null ? isRank * 100 : null,
    spend: totalSpend,
    revenue: totalRevenue,
    clicks,
    impressions,
    conversions: conversions > 0 ? conversions : null,
    score: Math.round(Math.max(0, Math.min(100, score))),
  }
}

let seq = 0
function makeSuggestion(
  s: Omit<OptimizationSuggestion, 'id'> & { id?: string },
): OptimizationSuggestion {
  return { id: s.id ?? `sug-${++seq}`, ...s }
}

export function optimizeCampaign(input: OptimizerInput): CampaignOptimizerResult {
  seq = 0
  const health = computeHealth(input)
  const suggestions: OptimizationSuggestion[] = []

  const { metrics, totalRevenue, totalCost, totalSpend, campaign_id, campaignLabel, project_id } = input
  const days = new Set(metrics.map(m => m.date)).size
  const hasConversionTracking = metrics.some(m => (m.conversions ?? 0) > 0)
  const scope = { level: 'campaign' as const, label: campaignLabel, campaign_id, project_id }
  const enoughData = totalSpend >= CFG.MIN_SPEND_TO_JUDGE && days >= CFG.MIN_DAYS_TO_JUDGE

  // ── ROI-based (confidence 'roi') ──────────────────────────────────────────

  // 1. Chi tiêu đáng kể nhưng KHÔNG có doanh thu → CẮT.
  if (enoughData && totalRevenue === 0) {
    suggestions.push(makeSuggestion({
      type: 'cut', severity: 'high', confidence: 'roi', scope,
      title: 'Cắt camp — tiêu tiền nhưng chưa có DT Màn hình',
      detail: `Đã chi ${money(totalSpend)} trong ${days} ngày mà DT Màn hình = 0. Camp đang lỗ toàn bộ chi phí.`,
      evidence: [
        { metric: 'Chi phí QC', value: money(totalSpend) },
        { metric: 'DT Màn hình', value: '0' },
        { metric: 'Số ngày', value: String(days) },
      ],
      recommendedAction: 'Tạm dừng camp; rà lại targeting/keyword/landing trước khi bật lại.',
      impactScore: totalSpend,
    }))
  }

  // 2. Có doanh thu nhưng ROI âm nặng → CẮT / thu hẹp.
  if (enoughData && totalRevenue > 0 && health.roi != null && health.roi < CFG.LOSS_ROI) {
    const loss = totalCost - totalRevenue
    suggestions.push(makeSuggestion({
      type: 'cut', severity: 'high', confidence: 'roi', scope,
      title: 'Camp lỗ — ROI âm sâu',
      detail: `ROI ${pct(health.roi)} (dưới ngưỡng ${CFG.LOSS_ROI}%). Lỗ khoảng ${money(loss)} trong kỳ.`,
      evidence: [
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'DT Màn hình', value: money(totalRevenue) },
        { metric: 'Tổng chi phí', value: money(totalCost) },
      ],
      recommendedAction: 'Cắt hoặc thu hẹp về khung keyword/thời điểm còn lãi; giảm bid mạnh.',
      impactScore: loss,
    }))
  }

  // 3. Đủ lãi + IS mất do NGÂN SÁCH cao → TĂNG BUDGET (scale).
  if (health.roi != null && health.roi > CFG.TARGET_ROI
      && health.isLostBudget != null && health.isLostBudget / 100 > CFG.IS_BUDGET_THRESHOLD) {
    const lostFrac = health.isLostBudget / 100
    const upside = totalRevenue * (lostFrac / Math.max(0.01, 1 - lostFrac))
    suggestions.push(makeSuggestion({
      type: 'raise_budget', severity: 'high', confidence: 'roi', scope,
      title: 'Scale — tăng ngân sách để giành thêm hiển thị',
      detail: `Camp đang lãi (ROI ${pct(health.roi)}) nhưng mất ${pct(health.isLostBudget)} hiển thị vì hết ngân sách. Đang bỏ lỡ traffic sinh lời.`,
      evidence: [
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'IS mất do ngân sách', value: pct(health.isLostBudget) },
        { metric: 'DT Màn hình', value: money(totalRevenue) },
      ],
      recommendedAction: `Tăng ngân sách từng bước (15–25%/lần), theo dõi ROI giữ trên ${CFG.TARGET_ROI}%.`,
      impactScore: Math.max(upside, totalRevenue * 0.2),
    }))
  }

  // 4. Đủ lãi + IS mất do THỨ HẠNG cao → TĂNG BID / cải thiện QS.
  if (health.roi != null && health.roi > CFG.TARGET_ROI
      && health.isLostRank != null && health.isLostRank / 100 > CFG.IS_RANK_THRESHOLD) {
    suggestions.push(makeSuggestion({
      type: 'raise_bid', severity: 'medium', confidence: 'roi', scope,
      title: 'Tăng bid — đang thua thứ hạng dù có lãi',
      detail: `Mất ${pct(health.isLostRank)} hiển thị do Ad Rank thấp trong khi camp vẫn lãi (ROI ${pct(health.roi)}).`,
      evidence: [
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'IS mất do thứ hạng', value: pct(health.isLostRank) },
      ],
      recommendedAction: 'Tăng bid ở keyword sinh lời và/hoặc cải thiện Quality Score (mẫu QC + landing).',
      impactScore: totalRevenue * 0.15,
    }))
  }

  // 5. CPC tăng nhanh + biên mỏng → CẢNH BÁO MARGIN.
  if (health.cpcTrendPct != null && health.cpcTrendPct > CFG.CPC_TREND_ALERT
      && (health.roi == null || health.roi < CFG.TARGET_ROI)) {
    suggestions.push(makeSuggestion({
      type: 'margin_alert', severity: 'medium', confidence: 'roi', scope,
      title: 'Cảnh báo margin — CPC đang tăng',
      detail: `CPC nửa sau kỳ tăng ${pct(health.cpcTrendPct)} so nửa đầu, trong khi ROI chưa vượt ${CFG.TARGET_ROI}%. Biên lợi nhuận đang bị bào mòn.`,
      evidence: [
        { metric: 'Xu hướng CPC', value: `+${pct(health.cpcTrendPct)}` },
        { metric: 'CPC trung bình', value: money(health.avgCpc) },
        { metric: 'ROI', value: health.roi != null ? pct(health.roi) : '—' },
      ],
      recommendedAction: 'Rà bid strategy, thêm negative keyword, kiểm giá thầu đối thủ; cân nhắc giảm bid.',
      impactScore: totalSpend * 0.5,
    }))
  }

  // 6. Lãi theo THỨ trong tuần (ROI ở mức ngày vẫn hợp lệ) → gợi ý dayparting.
  //    Xấp xỉ profit ngày = doanh thu − ad_spend (bỏ qua rental/other để bắt tín hiệu).
  {
    const byWeekday = new Map<number, { profit: number; spend: number }>()
    const allDates = new Set([...Object.keys(input.revenueByDate), ...Object.keys(input.spendByDate)])
    for (const d of allDates) {
      const wd = new Date(d + 'T00:00:00').getDay()
      const rev = input.revenueByDate[d] ?? 0
      const sp = input.spendByDate[d] ?? 0
      const cur = byWeekday.get(wd) ?? { profit: 0, spend: 0 }
      cur.profit += rev - sp
      cur.spend += sp
      byWeekday.set(wd, cur)
    }
    const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    const losers = [...byWeekday.entries()]
      .filter(([, v]) => v.profit < 0 && v.spend >= CFG.MIN_SPEND_TO_JUDGE)
      .sort((a, b) => a[1].profit - b[1].profit)
    if (enoughData && totalRevenue > 0 && losers.length) {
      const [wd, v] = losers[0]
      suggestions.push(makeSuggestion({
        type: 'daypart', severity: 'medium', confidence: 'roi', scope,
        title: 'Dayparting — có ngày trong tuần đang lỗ',
        detail: `${WD[wd]} lỗ khoảng ${money(-v.profit)} (chi ${money(v.spend)}). Cân nhắc giảm bid/tắt lịch ngày này.`,
        evidence: [
          { metric: 'Ngày lỗ nhất', value: WD[wd] },
          { metric: 'Lỗ', value: money(-v.profit) },
          { metric: 'Chi phí ngày đó', value: money(v.spend) },
        ],
        recommendedAction: `Đặt ad schedule giảm bid ${WD[wd]}, hoặc tắt nếu vẫn lỗ sau khi giảm.`,
        impactScore: -v.profit,
      }))
    }
  }

  // ── Engagement-based (confidence 'engagement' — "cần xem xét") ─────────────

  // 7. CTR thấp → nghi mẫu quảng cáo kém.
  if (health.impressions >= CFG.MIN_IMPR_FOR_CTR && health.ctr < CFG.CTR_FLOOR) {
    suggestions.push(makeSuggestion({
      type: 'fix_creative', severity: 'medium', confidence: 'engagement', scope,
      title: 'CTR thấp — xem lại mẫu quảng cáo',
      detail: `CTR ${pct(health.ctr)} dưới ngưỡng ${CFG.CTR_FLOOR}% với ${money(health.impressions)} hiển thị. Quảng cáo có thể chưa đủ hấp dẫn/đúng truy vấn.`,
      evidence: [
        { metric: 'CTR', value: pct(health.ctr) },
        { metric: 'Hiển thị', value: money(health.impressions) },
        { metric: 'Click', value: money(health.clicks) },
      ],
      recommendedAction: 'Viết lại tiêu đề/mô tả bám sát ý định tìm kiếm; A/B test 2–3 biến thể.',
      impactScore: totalSpend * 0.2,
    }))
  }

  // 7b/7c. Keyword & search term (P2) — engagement, không có doanh thu ở mức này.
  const kwAgg = aggregateKeywords(input.keywords ?? [])
  const stAgg = aggregateSearchTerms(input.searchTerms ?? [])
  const metricCost = metrics.reduce((s, m) => s + m.cost, 0)
  const sigCost = metricCost * CFG.KW_COST_FRACTION
  const roiNeg = health.roi != null && health.roi < 0

  const badKws = kwAgg.filter(k =>
    (k.clicks === 0 && k.cost > 0) ||
    (k.cost >= sigCost && (k.ctr < health.ctr * CFG.LOW_CTR_RATIO || (k.quality_score != null && k.quality_score <= CFG.QS_LOW))),
  )
  if (badKws.length) {
    const wasted = badKws.reduce((s, k) => s + k.cost, 0)
    const top = badKws.slice(0, 3).map(k => k.keyword_text || '(?)').join(', ')
    suggestions.push(makeSuggestion({
      type: 'pause_keyword', severity: roiNeg ? 'high' : 'medium', confidence: 'engagement',
      scope: { level: 'keyword', label: `${badKws.length} keyword`, campaign_id, project_id },
      title: `${badKws.length} keyword hiệu suất kém — cân nhắc tắt`,
      detail: `Chi phí cao nhưng CTR thấp / Quality Score kém / không có click. Ví dụ: ${top}. Tổng chi phí liên quan ${money(wasted)}.`,
      evidence: [
        { metric: 'Số keyword', value: String(badKws.length) },
        { metric: 'Chi phí liên quan', value: money(wasted) },
        { metric: 'CTR campaign', value: pct(health.ctr) },
      ],
      recommendedAction: 'Rà bảng bên dưới; tắt/giảm bid keyword kém hiệu suất; xem lại match type.',
      impactScore: wasted,
    }))
  }

  const badTerms = stAgg.filter(t =>
    (t.clicks === 0 && t.cost > 0) ||
    (t.cost >= sigCost && t.ctr < health.ctr * CFG.LOW_CTR_RATIO),
  )
  if (badTerms.length) {
    const wasted = badTerms.reduce((s, t) => s + t.cost, 0)
    const top = badTerms.slice(0, 3).map(t => `"${t.search_term}"`).join(', ')
    suggestions.push(makeSuggestion({
      type: 'add_negative', severity: roiNeg ? 'high' : 'medium', confidence: 'engagement',
      scope: { level: 'search_term', label: `${badTerms.length} search term`, campaign_id, project_id },
      title: `${badTerms.length} search term nghi phí rác — cân nhắc negative`,
      detail: `Truy vấn tốn chi phí mà CTR thấp / không click. Ví dụ: ${top}. Tổng chi phí liên quan ${money(wasted)}.`,
      evidence: [
        { metric: 'Số search term', value: String(badTerms.length) },
        { metric: 'Chi phí liên quan', value: money(wasted) },
        { metric: 'CTR campaign', value: pct(health.ctr) },
      ],
      recommendedAction: 'Rà bảng bên dưới; thêm negative keyword cho truy vấn không liên quan.',
      impactScore: wasted,
    }))
  }

  // 7d. Phân khúc device/giờ/geo (P3) — engagement, gợi ý điều chỉnh bid/lịch.
  const segAgg = aggregateSegments(input.segments ?? [])
  const SEG_META: Record<SegmentType, { type: OptimizationSuggestion['type']; noun: string; action: string }> = {
    device: { type: 'device_adjust', noun: 'thiết bị', action: 'Giảm bid ở thiết bị kém hiệu suất (device bid adjustment).' },
    hour:   { type: 'daypart',       noun: 'khung giờ', action: 'Giảm bid hoặc tắt lịch ở khung giờ kém (ad schedule).' },
    geo:    { type: 'device_adjust', noun: 'vị trí',    action: 'Điều chỉnh bid theo vị trí, hoặc loại trừ vị trí kém.' },
  }
  const fmtSegVal = (s: SegmentAgg) =>
    s.segment_type === 'hour' ? `${s.segment_value}h`
    : s.segment_type === 'geo' ? (countryNameByGeoId(s.segment_value) ?? s.segment_value)
    : s.segment_value
  for (const stype of ['device', 'hour', 'geo'] as SegmentType[]) {
    const segs = segAgg.filter(s => s.segment_type === stype)
    if (!segs.length) continue
    const bad = segs.filter(s =>
      (s.clicks === 0 && s.cost > 0) ||
      (s.cost >= sigCost && s.ctr < health.ctr * CFG.LOW_CTR_RATIO),
    )
    if (!bad.length) continue
    const wasted = bad.reduce((s, x) => s + x.cost, 0)
    const meta = SEG_META[stype]
    const top = bad.slice(0, 3).map(fmtSegVal).join(', ')
    suggestions.push(makeSuggestion({
      type: meta.type, severity: roiNeg ? 'medium' : 'low', confidence: 'engagement',
      scope: { level: 'segment', label: `${bad.length} ${meta.noun}`, campaign_id, project_id, segment_type: stype },
      title: `${meta.noun[0].toUpperCase()}${meta.noun.slice(1)} hiệu suất kém — ${bad.length} mục`,
      detail: `Chi phí cao nhưng CTR thấp / không click. Ví dụ: ${top}. Tổng chi phí liên quan ${money(wasted)}.`,
      evidence: [
        { metric: `Số ${meta.noun}`, value: String(bad.length) },
        { metric: 'Chi phí liên quan', value: money(wasted) },
        { metric: 'CTR campaign', value: pct(health.ctr) },
      ],
      recommendedAction: meta.action,
      impactScore: wasted,
    }))
  }

  // 8. Luôn nhắc nếu thiếu conversion tracking (mở khóa tối ưu sâu hơn).
  if (!hasConversionTracking) {
    suggestions.push(makeSuggestion({
      type: 'setup_tracking', severity: 'low', confidence: 'engagement', scope,
      title: 'Chưa có conversion tracking — tối ưu sâu bị giới hạn',
      detail: 'Cơ sở phân tích là DT Màn hình (ước tính sớm, có thể lệch DT Thực). Google Ads không thấy doanh thu (chuyển đổi ở site merchant qua link ref) nên ROI chỉ biết ở mức project × ngày; keyword/search term/device/giờ/geo chỉ tối ưu bằng tín hiệu hiệu suất.',
      evidence: [{ metric: 'Conversion trong kỳ', value: '0' }],
      recommendedAction: 'Cân nhắc import postback/conversion từ network để mở khóa tối ưu ở mức keyword.',
      impactScore: 0,
    }))
  }

  const rank: Record<OptSeverity, number> = { high: 3, medium: 2, low: 1 }
  suggestions.sort((a, b) => rank[b.severity] - rank[a.severity] || b.impactScore - a.impactScore)

  return {
    health,
    suggestions,
    hasConversionTracking,
    breakdowns: {
      keywords: kwAgg.slice(0, CFG.BREAKDOWN_LIMIT),
      searchTerms: stAgg.slice(0, CFG.BREAKDOWN_LIMIT),
      segments: segAgg.slice(0, CFG.BREAKDOWN_LIMIT * 3),
    },
  }
}

// tiện ích cho test/nơi khác nếu cần format bằng chứng thủ công
export const _fmt = { money, pct }
