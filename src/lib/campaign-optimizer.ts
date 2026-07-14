import {
  BreakdownMeta,
  CampaignHealth,
  CampaignMetric,
  CampaignOptimizerResult,
  CampaignSettings,
  HealthTrend,
  KeywordAgg,
  KeywordMetric,
  OptimizationSuggestion,
  OptSeverity,
  SearchTermAgg,
  SearchTermMetric,
  SegmentAgg,
  SegmentMetric,
  SegmentRevenueAgg,
  SegmentType,
} from './types'
import { countryNameByGeoId } from './geo-targets'
import { mineWinDayInsights } from './insight-miner'
import { buildLaunchPlan } from './launch-checklist'

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
  MIN_CLICKS_TO_JUDGE: 20,       // cần ít nhất N click mới đủ để kết luận (currency-agnostic)
  MIN_DAYS_TO_JUDGE: 3,          // cần ít nhất N ngày dữ liệu
  DAYPART_SPEND_FRACTION: 0.05,  // 1 thứ trong tuần "đáng kể" nếu ≥ 5% tổng chi phí
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
  // WoW (so kỳ trước cùng độ dài):
  WOW_CPC_ALERT: 20,             // CPC tăng > 20% vs kỳ trước → cảnh báo
  WOW_ROI_DROP: 20,             // ROI giảm > 20 điểm % vs kỳ trước → cảnh báo
  WOW_SPEND_UP: 15,             // chi phí tăng > 15%
  WOW_REV_DOWN: 10,             // DT Màn hình giảm > 10% (đi kèm spend tăng → xấu)
  // Playbook E1/E2:
  BID_CEILING_RATIO: 0.6,       // CPC an toàn ≤ 60% giá trị DT Màn hình mỗi click (playbook 3c)
  HARVEST_MIN_CLICKS: 10,       // search term cần ≥ N click mới đáng gặt (playbook 4a)
  HARVEST_CTR_RATIO: 1.2,       // CTR term ≥ 120% CTR campaign = đúng intent
  CAMP_YOUNG_DAYS: 7,           // camp chạy < N ngày = dữ liệu còn non (playbook 0)
  ABS_TOP_HIGH: 0.7,            // Abs-top IS ≥ 70% + margin mỏng → đua top vô ích (playbook 2c)
  // Doanh thu breakdown từ network affiliate (revenue_breakdown — Engine thu):
  BD_COVERAGE_MIN: 0.5,         // breakdown phải phủ ≥ 50% DT Màn hình mới tin segment ROI
  BD_SEG_MIN_CLICKS: 10,        // segment cần ≥ N click mới kết luận "không ra tiền"
  BD_MIN_SEG_REVENUE: 5,        // $ — DT segment tối thiểu để gợi ý geo_scale
  SEG_COST_COVERAGE_MIN: 0.7,   // chi phí segment phải phủ ≥ 70% chi phí camp mới tin ROI segment (tránh chia rác khi Google Ads sync thiếu ngày)
  QS_DIAG_MAX: 5,               // QS ≤ mức này + chi phí đáng kể → chẩn bệnh theo 3 thành phần QS
} as const

// Ngưỡng có thể override từ DB (optimizer_settings.thresholds) — Optimizer v2.
export type OptimizerCfg = { -readonly [K in keyof typeof CFG]: (typeof CFG)[K] extends number ? number : (typeof CFG)[K] }

interface PeriodTotals {
  metrics: CampaignMetric[]
  totalRevenue: number
  totalCost: number
  totalSpend: number
}

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
  prev?: PeriodTotals                    // kỳ trước cùng độ dài — để so xu hướng WoW (D2)
  settings?: CampaignSettings            // ngân sách + chiến lược giá thầu (D3)
  campStartDate?: string | null          // projects.camp_start_date — cờ "camp non" (playbook 0)
  testBudget?: number | null             // projects.test_budget — stop-loss test camp mới
  lifetime?: { spend: number; revenue: number }  // lũy kế từ start camp (cho stop-loss)
  segmentRevenue?: SegmentRevenueAgg[]   // DT breakdown từ network theo segment (value-space Google)
  breakdownMeta?: BreakdownMeta          // độ phủ/chất lượng dữ liệu breakdown (gate tin cậy)
  segmentCostCoverage?: number           // Σ chi phí segment / tổng chi phí camp (0..1) — thấp = thiếu ngày → khóa ROI segment
}

// Chiến lược giá thầu tự động (không đặt bid tay được) → đổi lời khuyên "tăng bid".
const MANUAL_BID_STRATEGIES = ['MANUAL_CPC', 'MANUAL_CPM', 'MANUAL_CPV']
function isAutomatedBidding(strategy: string | null | undefined): boolean {
  return strategy != null && strategy !== '' && !MANUAL_BID_STRATEGIES.includes(strategy)
}

// Chẩn bệnh QS (playbook 3a): thành phần nào BELOW_AVERAGE → lý do ngắn gọn.
export function qsReasons(k: Pick<KeywordAgg, 'qs_expected_ctr' | 'qs_ad_relevance' | 'qs_landing_page'>): string[] {
  const out: string[] = []
  if (k.qs_expected_ctr === 'BELOW_AVERAGE') out.push('CTR kỳ vọng thấp')
  if (k.qs_ad_relevance === 'BELOW_AVERAGE') out.push('ad lệch keyword')
  if (k.qs_landing_page === 'BELOW_AVERAGE') out.push('landing kém')
  return out
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
    if (r.qs_expected_ctr) e.qs_expected_ctr = r.qs_expected_ctr
    if (r.qs_ad_relevance) e.qs_ad_relevance = r.qs_ad_relevance
    if (r.qs_landing_page) e.qs_landing_page = r.qs_landing_page
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
// segmentRevenue (tùy chọn) = DT breakdown từ network: loại segment nào CÓ dữ liệu doanh
// thu thì mọi segment chi phí của loại đó được gán revenue (không khớp = 0 — nghĩa là
// "có dữ liệu, không ra tiền"); loại không có dữ liệu giữ revenue undefined ("chưa biết").
export function aggregateSegments(rows: SegmentMetric[], segmentRevenue?: SegmentRevenueAgg[]): SegmentAgg[] {
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

  if (segmentRevenue?.length) {
    const revByKey = new Map(segmentRevenue.map(r => [`${r.segment_type}|${r.segment_value}`, r]))
    const typesWithRev = new Set(segmentRevenue.map(r => r.segment_type))
    for (const e of out) {
      if (!typesWithRev.has(e.segment_type)) continue
      const key = `${e.segment_type}|${e.segment_value}`
      const rv = revByKey.get(key)
      e.revenue = rv?.revenue ?? 0
      e.conversions = rv?.conversions ?? null
      e.roi = e.cost > 0 ? ((e.revenue - e.cost) / e.cost) * 100 : null
      revByKey.delete(key)
    }
    // DT ở segment KHÔNG có chi phí (vd chuyển đổi từ nước ngoài geo target) → thêm dòng
    // cost=0 để bảng breakdown nhìn thấy (tín hiệu rò/organic), rule không đụng tới.
    for (const rv of revByKey.values()) {
      out.push({
        segment_type: rv.segment_type, segment_value: rv.segment_value,
        impressions: 0, clicks: 0, cost: 0, ctr: 0,
        revenue: rv.revenue, conversions: rv.conversions, roi: null,
      })
    }
  }
  return out.sort((a, b) => b.cost - a.cost)
}

// Định dạng tiền khớp UI (formatVND = '$' + 2 số lẻ, đơn vị tài khoản Google Ads).
const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const intFmt = new Intl.NumberFormat('en-US')
const money = (n: number) => '$' + usdFmt.format(n)
const count = (n: number) => intFmt.format(Math.round(n))
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

function computeHealth(d: PeriodTotals, cfg: OptimizerCfg = CFG as unknown as OptimizerCfg): CampaignHealth {
  const { metrics, totalRevenue, totalCost, totalSpend } = d
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
  const absTopRate = weightedRate(metrics, m => m.abs_top_is ?? null)

  // Health score 0..100 (heuristic, minh bạch):
  //   ROI (±40), CTR (±20), Impression Share (±20), xu hướng CPC (±20).
  let score = 50
  if (roi != null) score += Math.max(-40, Math.min(40, roi * 0.8))
  score += Math.max(-20, Math.min(20, (ctr - cfg.CTR_FLOOR) * 8))
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
    absTopIs: absTopRate != null ? absTopRate * 100 : null,
    spend: totalSpend,
    revenue: totalRevenue,
    clicks,
    impressions,
    conversions: conversions > 0 ? conversions : null,
    score: Math.round(Math.max(0, Math.min(100, score))),
  }
}

function computeTrend(cur: CampaignHealth, prev: CampaignHealth): HealthTrend {
  const pctChange = (c: number, p: number) => (p !== 0 ? ((c - p) / Math.abs(p)) * 100 : null)
  return {
    spendPct: pctChange(cur.spend, prev.spend),
    revenuePct: pctChange(cur.revenue, prev.revenue),
    roiDelta: cur.roi != null && prev.roi != null ? cur.roi - prev.roi : null,
    cpcPct: pctChange(cur.avgCpc, prev.avgCpc),
    ctrDelta: cur.ctr - prev.ctr,
    isDelta: cur.impressionShare != null && prev.impressionShare != null ? cur.impressionShare - prev.impressionShare : null,
  }
}

let seq = 0
function makeSuggestion(
  s: Omit<OptimizationSuggestion, 'id'> & { id?: string },
): OptimizationSuggestion {
  // dedupeKey mặc định = ruleKey (1 card/rule/camp); rule theo scope tự truyền dedupeKey riêng.
  return { ...s, id: s.id ?? `sug-${++seq}`, dedupeKey: s.dedupeKey ?? s.ruleKey }
}

// cfgOverride (Optimizer v2): ngưỡng override từ optimizer_settings.thresholds —
// không truyền = dùng CFG mặc định (hành vi cũ giữ nguyên).
export function optimizeCampaign(input: OptimizerInput, cfgOverride?: Partial<OptimizerCfg>): CampaignOptimizerResult {
  const cfg: OptimizerCfg = { ...(CFG as unknown as OptimizerCfg), ...cfgOverride }
  seq = 0
  const health = computeHealth(input, cfg)
  if (input.prev) health.trend = computeTrend(health, computeHealth(input.prev, cfg))
  const suggestions: OptimizationSuggestion[] = []

  const { metrics, totalRevenue, totalCost, totalSpend, campaign_id, campaignLabel, project_id } = input
  const days = new Set(metrics.map(m => m.date)).size
  const hasConversionTracking = metrics.some(m => (m.conversions ?? 0) > 0)
  const scope = { level: 'campaign' as const, label: campaignLabel, campaign_id, project_id }
  // Gate "đủ dữ liệu để kết luận" theo SỐ CLICK (không phụ thuộc tiền tệ — trước
  // đây dùng ngưỡng VND nên tài khoản USD không bao giờ vượt → chặn hết rule cut).
  const enoughData = health.clicks >= cfg.MIN_CLICKS_TO_JUDGE && days >= cfg.MIN_DAYS_TO_JUDGE

  // ── ROI-based (confidence 'roi') ──────────────────────────────────────────

  // 1. Chi tiêu đáng kể nhưng KHÔNG có doanh thu → CẮT.
  if (enoughData && totalRevenue === 0) {
    suggestions.push(makeSuggestion({
      ruleKey: 'cut_no_revenue',
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
  if (enoughData && totalRevenue > 0 && health.roi != null && health.roi < cfg.LOSS_ROI) {
    const loss = totalCost - totalRevenue
    suggestions.push(makeSuggestion({
      ruleKey: 'cut_deep_loss',
      type: 'cut', severity: 'high', confidence: 'roi', scope,
      title: 'Camp lỗ — ROI âm sâu',
      detail: `ROI ${pct(health.roi)} (dưới ngưỡng ${cfg.LOSS_ROI}%). Lỗ khoảng ${money(loss)} trong kỳ.`,
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
  if (health.roi != null && health.roi > cfg.TARGET_ROI
      && health.isLostBudget != null && health.isLostBudget / 100 > cfg.IS_BUDGET_THRESHOLD) {
    const lostFrac = health.isLostBudget / 100
    const upside = totalRevenue * (lostFrac / Math.max(0.01, 1 - lostFrac))
    const budget = input.settings?.daily_budget ?? null
    const suggestedBudget = budget != null ? budget * (1 + Math.min(0.3, lostFrac + 0.1)) : null
    const budgetEvidence = budget != null ? [{ metric: 'Ngân sách/ngày', value: money(budget) }] : []
    const budgetAction = suggestedBudget != null
      ? `Tăng ngân sách từ ${money(budget!)} → thử ~${money(suggestedBudget)}/ngày (từng bước 15–25%), giữ ROI trên ${cfg.TARGET_ROI}%.`
      : `Tăng ngân sách từng bước (15–25%/lần), theo dõi ROI giữ trên ${cfg.TARGET_ROI}%.`
    suggestions.push(makeSuggestion({
      ruleKey: 'raise_budget_scale',
      params: { roi: health.roi, isLostBudget: health.isLostBudget, dailyBudget: budget, suggestedBudget },
      type: 'raise_budget', severity: 'high', confidence: 'roi', scope,
      title: 'Scale — tăng ngân sách để giành thêm hiển thị',
      detail: `Camp đang lãi (ROI ${pct(health.roi)}) nhưng mất ${pct(health.isLostBudget)} hiển thị vì hết ngân sách. Đang bỏ lỡ traffic sinh lời.`,
      evidence: [
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'IS mất do ngân sách', value: pct(health.isLostBudget) },
        ...budgetEvidence,
      ],
      recommendedAction: budgetAction,
      impactScore: Math.max(upside, totalRevenue * 0.2),
    }))
  }

  // 4. Đủ lãi + IS mất do THỨ HẠNG cao → TĂNG BID / cải thiện QS.
  //    Nếu đang dùng bid tự động (Maximize/tCPA/tROAS) thì "tăng bid tay" vô nghĩa
  //    → đổi thành nới target / tăng ngân sách.
  //    GUARD: nếu CPC đã vượt trần lời-mỗi-click (rule 4b) thì KHÔNG gợi ý tăng —
  //    trần bid là kim chỉ nam (playbook 3c), tránh 2 lời khuyên ngược nhau.
  const revPerClickAll = totalRevenue > 0 && health.clicks > 0 ? totalRevenue / health.clicks : null
  const bidCeiling = revPerClickAll != null ? revPerClickAll * cfg.BID_CEILING_RATIO : null
  const cpcOverCeiling = enoughData && bidCeiling != null && health.avgCpc > 0 && health.avgCpc > bidCeiling
  if (!cpcOverCeiling && health.roi != null && health.roi > cfg.TARGET_ROI
      && health.isLostRank != null && health.isLostRank / 100 > cfg.IS_RANK_THRESHOLD) {
    const strategy = input.settings?.bidding_strategy ?? null
    const automated = isAutomatedBidding(strategy)
    const strategyEvidence = strategy ? [{ metric: 'Chiến lược bid', value: strategy }] : []
    suggestions.push(makeSuggestion({
      ruleKey: 'raise_bid_rank',
      params: { roi: health.roi, isLostRank: health.isLostRank, avgCpc: health.avgCpc, automated },
      type: 'raise_bid', severity: 'medium', confidence: 'roi', scope,
      title: automated ? 'Nới target — đang thua thứ hạng dù có lãi' : 'Tăng bid — đang thua thứ hạng dù có lãi',
      detail: `Mất ${pct(health.isLostRank)} hiển thị do Ad Rank thấp trong khi camp vẫn lãi (ROI ${pct(health.roi)}).${automated ? ` Camp dùng bid tự động (${strategy}) nên không đặt bid tay được.` : ''}`,
      evidence: [
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'IS mất do thứ hạng', value: pct(health.isLostRank) },
        ...strategyEvidence,
      ],
      recommendedAction: automated
        ? 'Nới target CPA (tăng tCPA) / giảm target ROAS, hoặc tăng ngân sách; cải thiện Quality Score.'
        : 'Tăng bid ở keyword sinh lời và/hoặc cải thiện Quality Score (mẫu QC + landing).',
      impactScore: totalRevenue * 0.15,
    }))
  }

  // 4b. Trần bid theo lời-mỗi-click (playbook 3c) — "kim chỉ nam bid" khi không có
  //     conversion tracking: CPC trung bình không nên vượt BID_CEILING_RATIO của giá
  //     trị DT Màn hình mỗi click.
  if (cpcOverCeiling && revPerClickAll != null && bidCeiling != null) {
    const revPerClick = revPerClickAll
    const ceiling = bidCeiling
    {
      const ratio = (health.avgCpc / revPerClick) * 100
      suggestions.push(makeSuggestion({
        ruleKey: 'bid_ceiling',
        params: { avgCpc: health.avgCpc, revPerClick, ceiling },
        type: 'lower_bid', severity: health.roi != null && health.roi < 0 ? 'high' : 'medium', confidence: 'roi', scope,
        title: 'CPC vượt trần an toàn — giảm bid từng nấc',
        detail: `Mỗi click tạo ~${money(revPerClick)} DT Màn hình nhưng đang trả ${money(health.avgCpc)}/click (${ratio.toFixed(0)}% giá trị click, trần an toàn ${cfg.BID_CEILING_RATIO * 100}%). Biên không đủ nuôi chi phí.`,
        evidence: [
          { metric: 'CPC trung bình', value: money(health.avgCpc) },
          { metric: 'DT/click', value: money(revPerClick) },
          { metric: 'Trần an toàn', value: money(ceiling) },
        ],
        recommendedAction: `Giảm bid từng nấc (−15–20%/lần) tới khi CPC ≤ ~${money(ceiling)}; theo dõi 5–7 ngày dữ liệu chín rồi chỉnh tiếp.`,
        impactScore: (health.avgCpc - ceiling) * health.clicks,
      }))
    }
  }

  // 4c. Đua top vô ích (playbook 2c): đứng vị trí 1 tuyệt đối quá nhiều trong khi
  //     margin mỏng → thử tụt 1 hạng, CPC thường giảm mạnh hơn lượng click mất.
  const absTop = health.absTopIs
  if (absTop != null && absTop >= cfg.ABS_TOP_HIGH * 100
      && health.roi != null && health.roi >= 0 && health.roi < cfg.TARGET_ROI) {
    suggestions.push(makeSuggestion({
      ruleKey: 'abs_top_wasteful',
      params: { absTopIs: absTop, roi: health.roi, avgCpc: health.avgCpc },
      type: 'lower_bid', severity: 'medium', confidence: 'roi', scope,
      title: 'Đua top tuyệt đối trong khi margin mỏng — thử giảm bid 1 nấc',
      detail: `${pct(absTop, 0)} hiển thị đang ở vị trí 1 tuyệt đối nhưng ROI chỉ ${pct(health.roi)}. Tụt 1 hạng thường giảm CPC mạnh hơn lượng click mất → tổng lời tăng.`,
      evidence: [
        { metric: 'Abs-top IS', value: pct(absTop, 0) },
        { metric: 'ROI', value: pct(health.roi) },
        { metric: 'CPC trung bình', value: money(health.avgCpc) },
      ],
      recommendedAction: 'Giảm bid nhẹ (−10–15%), theo dõi CPC/ROI 5–7 ngày; nếu ROI tăng → giữ, nếu volume tụt quá → hoàn.',
      impactScore: totalSpend * 0.15,
    }))
  }

  // 4d. Presence-or-interest (playbook 1a-phụ): rò cost sang người *quan tâm* geo
  //     chứ không *ở* geo — mặc định của Google. Đổi sang Presence là cắt rò an toàn.
  if (input.settings?.geo_target_type === 'PRESENCE_OR_INTEREST') {
    suggestions.push(makeSuggestion({
      ruleKey: 'fix_geo_presence',
      type: 'fix_geo_setting', severity: 'medium', confidence: 'engagement', scope,
      title: 'Location đang là "Presence or interest" — rò cost ngoài geo target',
      detail: 'Cài đặt hiện tại cho phép hiển thị với người *quan tâm* tới geo (ở nơi khác) chứ không chỉ người *đang ở* geo. Với affiliate trả tiền theo geo, đây là rò kinh điển.',
      evidence: [{ metric: 'Geo target type', value: 'PRESENCE_OR_INTEREST' }],
      recommendedAction: 'Trong Campaign settings → Locations → Location options: đổi sang "Presence" (People in or regularly in your targeted locations).',
      impactScore: totalSpend * 0.1,
    }))
  }

  // (Rule 5 cũ "CPC nửa sau +25%" đã bỏ — Optimizer v2 thay bằng detector trend
  //  Theil–Sen 21 ngày trong src/lib/optimizer/anomaly.ts: baseline dài hơn, kháng
  //  nhiễu, không trùng card với anomaly CPC. cpcTrendPct vẫn tính cho health score.)

  // 6. Lãi theo THỨ trong tuần (ROI ở mức ngày vẫn hợp lệ) → gợi ý dayparting.
  //    Xấp xỉ profit ngày = doanh thu − ad_spend (bỏ qua rental/other để bắt tín hiệu).
  //    CHỈ xét các ngày ≤ ngày cuối ĐÃ CÓ doanh thu nhập ("dữ liệu chín" — playbook 0):
  //    ngày cuối kỳ thường đã sync chi phí nhưng CHƯA nhập DT → thành "lỗ giả".
  {
    const revenueDates = Object.keys(input.revenueByDate).filter(d => (input.revenueByDate[d] ?? 0) > 0)
    const matureCutoff = revenueDates.length ? revenueDates.sort()[revenueDates.length - 1] : null
    const byWeekday = new Map<number, { profit: number; spend: number }>()
    const allDates = new Set([...Object.keys(input.revenueByDate), ...Object.keys(input.spendByDate)])
    for (const d of allDates) {
      if (matureCutoff != null && d > matureCutoff) continue // DT chưa kịp nhập → bỏ qua
      const wd = new Date(d + 'T00:00:00').getDay()
      const rev = input.revenueByDate[d] ?? 0
      const sp = input.spendByDate[d] ?? 0
      const cur = byWeekday.get(wd) ?? { profit: 0, spend: 0 }
      cur.profit += rev - sp
      cur.spend += sp
      byWeekday.set(wd, cur)
    }
    const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
    const daypartMinSpend = totalSpend * cfg.DAYPART_SPEND_FRACTION
    const losers = [...byWeekday.entries()]
      .filter(([, v]) => v.profit < 0 && v.spend >= daypartMinSpend)
      .sort((a, b) => a[1].profit - b[1].profit)
    if (enoughData && totalRevenue > 0 && losers.length) {
      const [wd, v] = losers[0]
      suggestions.push(makeSuggestion({
        ruleKey: 'daypart_loss',
        params: { weekday: wd, loss: -v.profit, spend: v.spend },
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

  // (Cụm 6b cũ "so kỳ trước" — WoW spend↑&rev↓ / ROI drop / CPC alert — đã bỏ.
  //  Optimizer v2 thay bằng anomaly engine (z-score trên baseline 28 ngày, biết thứ
  //  trong tuần) trong src/lib/optimizer/anomaly.ts: cùng bắt các tình huống đó nhưng
  //  ít báo sai hơn và không sinh 2 card cho cùng 1 vấn đề. health.trend vẫn tính
  //  để hiển thị trên HealthScorecard.)

  // ── Engagement-based (confidence 'engagement' — "cần xem xét") ─────────────

  // 7. CTR thấp → nghi mẫu quảng cáo kém.
  if (health.impressions >= cfg.MIN_IMPR_FOR_CTR && health.ctr < cfg.CTR_FLOOR) {
    suggestions.push(makeSuggestion({
      ruleKey: 'low_ctr_creative',
      params: { ctr: health.ctr, impressions: health.impressions },
      type: 'fix_creative', severity: 'medium', confidence: 'engagement', scope,
      title: 'CTR thấp — xem lại mẫu quảng cáo',
      detail: `CTR ${pct(health.ctr)} dưới ngưỡng ${cfg.CTR_FLOOR}% với ${count(health.impressions)} hiển thị. Quảng cáo có thể chưa đủ hấp dẫn/đúng truy vấn.`,
      evidence: [
        { metric: 'CTR', value: pct(health.ctr) },
        { metric: 'Hiển thị', value: count(health.impressions) },
        { metric: 'Click', value: count(health.clicks) },
      ],
      recommendedAction: 'Viết lại tiêu đề/mô tả bám sát ý định tìm kiếm; A/B test 2–3 biến thể.',
      impactScore: totalSpend * 0.2,
    }))
  }

  // 7b/7c. Keyword & search term (P2) — engagement, không có doanh thu ở mức này.
  const kwAgg = aggregateKeywords(input.keywords ?? [])
  const stAgg = aggregateSearchTerms(input.searchTerms ?? [])
  const metricCost = metrics.reduce((s, m) => s + m.cost, 0)
  const sigCost = metricCost * cfg.KW_COST_FRACTION
  const roiNeg = health.roi != null && health.roi < 0

  const badKws = kwAgg.filter(k =>
    (k.clicks === 0 && k.cost > 0) ||
    (k.cost >= sigCost && (k.ctr < health.ctr * cfg.LOW_CTR_RATIO || (k.quality_score != null && k.quality_score <= cfg.QS_LOW))),
  )
  if (badKws.length) {
    const wasted = badKws.reduce((s, k) => s + k.cost, 0)
    const top = badKws.slice(0, 3).map(k => k.keyword_text || '(?)').join(', ')
    suggestions.push(makeSuggestion({
      ruleKey: 'pause_keyword',
      params: { count: badKws.length, wasted },
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
      items: badKws.slice(0, 8).map(k => {
        const reasons = qsReasons(k)
        return {
          label: k.keyword_text || '(?)', cost: k.cost,
          meta: `${k.match_type} · CTR ${pct(k.ctr)}${k.quality_score != null ? ` · QS ${k.quality_score}` : ''}${reasons.length ? ` · ${reasons.join(', ')}` : ''}`,
        }
      }),
    }))
  }

  const badTerms = stAgg.filter(t =>
    (t.clicks === 0 && t.cost > 0) ||
    (t.cost >= sigCost && t.ctr < health.ctr * cfg.LOW_CTR_RATIO),
  )
  if (badTerms.length) {
    const wasted = badTerms.reduce((s, t) => s + t.cost, 0)
    const top = badTerms.slice(0, 3).map(t => `"${t.search_term}"`).join(', ')
    suggestions.push(makeSuggestion({
      ruleKey: 'add_negative',
      params: { count: badTerms.length, wasted },
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
      items: badTerms.slice(0, 8).map(t => ({
        label: t.search_term, cost: t.cost,
        meta: `${count(t.clicks)} click · CTR ${pct(t.ctr)}`,
      })),
    }))
  }

  // 7c-2. Broad match thả cửa (playbook 1c): không có conversion signal, broad match
  //       chỉ tối ưu "click rẻ" chứ không phải "click ra tiền" → siết phrase/exact.
  const broadKws = kwAgg.filter(k => k.match_type === 'BROAD' && k.cost >= sigCost)
  if (broadKws.length) {
    const broadCost = broadKws.reduce((s, k) => s + k.cost, 0)
    suggestions.push(makeSuggestion({
      ruleKey: 'tighten_broad',
      params: { count: broadKws.length, broadCost },
      type: 'tighten_match', severity: roiNeg ? 'high' : 'medium', confidence: 'engagement',
      scope: { level: 'keyword', label: `${broadKws.length} broad keyword`, campaign_id, project_id },
      title: `${broadKws.length} keyword broad match đang chi tiêu lớn — siết về phrase/exact`,
      detail: `Không có conversion signal về Google nên broad match không thể tự học "click ra tiền" — chỉ tối ưu click rẻ. ${money(broadCost)} đang chạy broad.`,
      evidence: [
        { metric: 'Keyword broad', value: String(broadKws.length) },
        { metric: 'Chi phí broad', value: money(broadCost) },
      ],
      recommendedAction: 'Chuyển keyword chi tiêu lớn về phrase/exact; giữ broad chỉ khi kèm negative dày và theo dõi search terms sát.',
      impactScore: broadCost * 0.4,
      items: broadKws.slice(0, 8).map(k => ({ label: k.keyword_text || '(?)', cost: k.cost, meta: `CTR ${pct(k.ctr)}` })),
    }))
  }

  // 7c-3. Harvesting (playbook 4a): search term volume ổn + CTR cao + CHƯA là keyword
  //       → thêm exact riêng để kiểm soát bid cho đúng cụm ăn tiền.
  const kwTextSet = new Set(kwAgg.map(k => (k.keyword_text || '').toLowerCase().trim()).filter(Boolean))
  const winners = stAgg.filter(t =>
    t.clicks >= cfg.HARVEST_MIN_CLICKS &&
    t.cost >= sigCost &&
    health.ctr > 0 && t.ctr >= health.ctr * cfg.HARVEST_CTR_RATIO &&
    !kwTextSet.has(t.search_term.toLowerCase().trim()),
  )
  if (winners.length) {
    const winCost = winners.reduce((s, t) => s + t.cost, 0)
    suggestions.push(makeSuggestion({
      ruleKey: 'harvest_keyword',
      params: { count: winners.length, winCost, terms: winners.slice(0, 8).map(t => t.search_term) },
      type: 'harvest_keyword', severity: 'medium', confidence: 'engagement',
      scope: { level: 'search_term', label: `${winners.length} cụm thắng`, campaign_id, project_id },
      title: `${winners.length} search term đang thắng — thêm làm keyword exact riêng`,
      detail: `Cụm khách gõ nhiều, CTR vượt trung bình camp, nhưng chưa là keyword — đang trôi trong match rộng, không kiểm soát được bid. Chi phí liên quan ${money(winCost)}.`,
      evidence: [
        { metric: 'Cụm thắng', value: String(winners.length) },
        { metric: 'Chi phí liên quan', value: money(winCost) },
        { metric: 'CTR campaign', value: pct(health.ctr) },
      ],
      recommendedAction: 'Thêm các cụm này làm keyword [exact] (ad group riêng nếu đủ lớn); cụm nghi là mỏ chính → tách campaign riêng để P&L đo độc lập.',
      impactScore: winCost,
      items: winners.slice(0, 8).map(t => ({ label: t.search_term, cost: t.cost, meta: `${count(t.clicks)} click · CTR ${pct(t.ctr)}` })),
    }))
  }

  // 7c-4. Chẩn bệnh Quality Score theo 3 thành phần (Optimizer v2) — dữ liệu đã có
  //       sẵn trong keyword_metrics.qs_* nhưng trước đây chỉ dùng QS tổng. Nói rõ
  //       "điểm thấp VÌ trang đích" / "VÌ ad lệch keyword" thay vì chỉ khuyên tắt.
  //       (qs_expected_ctr BELOW_AVERAGE đã được rule creative/CTR hiện có bao phủ.)
  {
    const qsSig = kwAgg.filter(k =>
      k.quality_score != null && k.quality_score <= cfg.QS_DIAG_MAX && k.cost >= sigCost)
    const lpBad = qsSig.filter(k => k.qs_landing_page === 'BELOW_AVERAGE')
    const adBad = qsSig.filter(k => k.qs_ad_relevance === 'BELOW_AVERAGE' && k.qs_landing_page !== 'BELOW_AVERAGE')
    if (lpBad.length) {
      const wasted = lpBad.reduce((s, k) => s + k.cost, 0)
      suggestions.push(makeSuggestion({
        ruleKey: 'fix_landing_page',
        params: { count: lpBad.length, wasted },
        type: 'fix_landing_page', severity: 'medium', confidence: 'engagement',
        scope: { level: 'keyword', label: `${lpBad.length} keyword`, campaign_id, project_id },
        title: `${lpBad.length} keyword điểm thấp VÌ trang đích — sửa landing page`,
        detail: `Google chấm thành phần "Landing page experience" dưới trung bình cho các keyword này (QS ≤ ${cfg.QS_DIAG_MAX}). Trang đích chậm/lệch nội dung làm CPC đắt lên ở mọi phiên đấu giá — sửa trang đích rẻ hơn nhiều so với tăng bid.`,
        evidence: [
          { metric: 'Keyword bị chấm kém', value: String(lpBad.length) },
          { metric: 'Chi phí liên quan', value: money(wasted) },
        ],
        recommendedAction: 'Tăng tốc độ tải (ảnh, script), đưa từ khóa vào tiêu đề/nội dung trang, khớp nội dung trang với ý định tìm kiếm. Sau 1–2 tuần Google chấm lại QS.',
        impactScore: wasted * 0.3,
        items: lpBad.slice(0, 8).map(k => ({ label: k.keyword_text || '(?)', cost: k.cost, meta: `QS ${k.quality_score} · landing kém` })),
      }))
    }
    if (adBad.length) {
      const wasted = adBad.reduce((s, k) => s + k.cost, 0)
      suggestions.push(makeSuggestion({
        ruleKey: 'fix_ad_relevance',
        params: { count: adBad.length, wasted },
        type: 'fix_creative', severity: 'medium', confidence: 'engagement',
        scope: { level: 'keyword', label: `${adBad.length} keyword`, campaign_id, project_id },
        title: `${adBad.length} keyword điểm thấp VÌ ad lệch keyword — viết lại mẫu quảng cáo`,
        detail: `Google chấm thành phần "Ad relevance" dưới trung bình: mẫu quảng cáo không nhắc tới từ khóa người dùng gõ (QS ≤ ${cfg.QS_DIAG_MAX}). Nhóm lại ad group cho chặt chủ đề + đưa keyword vào tiêu đề ad sẽ kéo QS lên, CPC rẻ đi.`,
        evidence: [
          { metric: 'Keyword bị chấm kém', value: String(adBad.length) },
          { metric: 'Chi phí liên quan', value: money(wasted) },
        ],
        recommendedAction: 'Tách ad group theo cụm keyword sát nghĩa; viết tiêu đề ad chứa đúng từ khóa; xóa keyword lạc chủ đề khỏi ad group.',
        impactScore: wasted * 0.3,
        items: adBad.slice(0, 8).map(k => ({ label: k.keyword_text || '(?)', cost: k.cost, meta: `QS ${k.quality_score} · ad lệch keyword` })),
      }))
    }
  }

  // 7d. Phân khúc device/giờ/geo (P3). Mặc định engagement (CTR); loại segment nào có
  //     doanh thu breakdown từ network (Engine thu, đủ độ phủ) → nâng lên test LỢI NHUẬN
  //     thật với confidence 'roi'.
  const bdMeta = input.breakdownMeta
  const bdCoverage = bdMeta?.coverageRatio ?? 0
  // ROI theo segment (device/hour/geo dựa DT network) CHỈ đáng tin khi CẢ HAI nguồn khớp KỲ:
  //  • chi phí segment phủ đủ (segment_metrics không thiếu ngày) — nếu không, chi phí per-segment hụt
  //    → ROI phồng (vd chỉ có 3/12 ngày chi phí → ROI cả trăm nghìn %).
  //  • doanh thu breakdown KHÔNG vượt kỳ (snapshot window_end tổng-cả-kỳ ≠ DT khoảng ngày).
  const segCostCoverage = input.segmentCostCoverage ?? 1
  const segCostOk = segCostCoverage >= cfg.SEG_COST_COVERAGE_MIN
  const revenueKindOk = !bdMeta?.revenueOverRange
  const hasSegmentRevenue = (input.segmentRevenue?.length ?? 0) > 0
  const hasBreakdownRevenue = hasSegmentRevenue && bdCoverage >= cfg.BD_COVERAGE_MIN && segCostOk && revenueKindOk
  // Có DT breakdown + phủ đủ DT, nhưng LỆCH KỲ với chi phí (thiếu ngày chi phí HOẶC doanh thu snapshot
  // vượt kỳ) → KHÔNG tính ROI theo quốc gia/thiết bị (tránh số rác kiểu 200.000%). Báo rõ 1 dòng lý do.
  if (hasSegmentRevenue && bdCoverage >= cfg.BD_COVERAGE_MIN && (!segCostOk || !revenueKindOk)) {
    const reasons: string[] = []
    if (!segCostOk) reasons.push(`chi phí Google Ads theo quốc gia/thiết bị chỉ phủ ${pct(segCostCoverage * 100, 0)} chi phí camp (đồng bộ thiếu/cũ ngày)`)
    if (!revenueKindOk) reasons.push('doanh thu network theo quốc gia là snapshot tổng-cả-kỳ, KHÔNG cùng kỳ với khoảng ngày đang xem')
    suggestions.push(makeSuggestion({
      ruleKey: 'data_quality_segment',
      type: 'data_quality', severity: 'low', confidence: 'engagement', scope,
      title: 'ROI theo quốc gia/thiết bị CHƯA đáng tin — thiếu dữ liệu khớp kỳ',
      detail: `Chưa hiện gợi ý tối ưu theo quốc gia/thiết bị vì ${reasons.join(' và ')}. Cần dữ liệu chi phí + doanh thu CÙNG kỳ (theo ngày) mới tính ROI quốc gia chính xác.`,
      evidence: [
        { metric: 'Độ phủ chi phí segment', value: pct(segCostCoverage * 100, 0) },
        { metric: 'DT breakdown vượt kỳ', value: bdMeta?.revenueOverRange ? 'Có' : 'Không' },
      ],
      recommendedAction: 'Đồng bộ đủ chi phí Google Ads cho khoảng ngày đang xem; thu doanh thu network theo quốc gia × NGÀY (không dùng snapshot tổng-cả-kỳ).',
      impactScore: 0,
    }))
  }
  const segAgg = aggregateSegments(input.segments ?? [], input.segmentRevenue)
  const SEG_META: Record<SegmentType, { type: OptimizationSuggestion['type']; noun: string; action: string }> = {
    device: { type: 'device_adjust', noun: 'thiết bị', action: 'Giảm bid ở thiết bị kém hiệu suất (device bid adjustment).' },
    hour:   { type: 'daypart',       noun: 'khung giờ', action: 'Giảm bid hoặc tắt lịch ở khung giờ kém (ad schedule).' },
    geo:    { type: 'device_adjust', noun: 'vị trí',    action: 'Điều chỉnh bid theo vị trí, hoặc loại trừ vị trí kém.' },
  }
  const fmtSegVal = (s: SegmentAgg) =>
    s.segment_type === 'hour' ? `${s.segment_value}h`
    : s.segment_type === 'geo' ? (countryNameByGeoId(s.segment_value) ?? s.segment_value)
    : s.segment_value
  const TZ_CAVEAT = ' Lưu ý: chi phí theo giờ (múi giờ tài khoản Google Ads) và doanh thu theo giờ (múi giờ nguồn network) CHƯA canh khớp, cộng độ trễ chuyển đổi → ROI theo giờ chỉ mang tính THAM KHẢO, cân nhắc kỹ trước khi đặt lịch.'
  for (const stype of ['device', 'hour', 'geo'] as SegmentType[]) {
    const segs = segAgg.filter(s => s.segment_type === stype)
    if (!segs.length) continue
    const revMode = hasBreakdownRevenue && segs.some(s => s.revenue != null)
    const bad = revMode
      ? segs.filter(s =>
          s.cost >= sigCost && s.clicks >= cfg.BD_SEG_MIN_CLICKS && s.revenue != null &&
          (stype === 'geo'
            // geo 0 DT có rule geo_exclude riêng (7e) — ở đây chỉ bắt geo lỗ sâu CÓ doanh thu
            ? ((s.revenue ?? 0) > 0 && s.roi != null && s.roi < cfg.LOSS_ROI)
            : (s.revenue === 0 || (s.roi != null && s.roi < cfg.LOSS_ROI))),
        )
      : segs.filter(s =>
          (s.clicks === 0 && s.cost > 0) ||
          (s.cost >= sigCost && s.ctr < health.ctr * cfg.LOW_CTR_RATIO),
        )
    if (!bad.length) continue
    const wasted = bad.reduce((s, x) => s + x.cost, 0)
    const badRevenue = bad.reduce((s, x) => s + (x.revenue ?? 0), 0)
    const meta = SEG_META[stype]
    const top = bad.slice(0, 3).map(fmtSegVal).join(', ')
    suggestions.push(makeSuggestion({
      ruleKey: 'segment_perf',
      dedupeKey: `segment_perf:${stype}`,
      params: { segmentType: stype, count: bad.length, wasted, badRevenue, revMode },
      type: meta.type,
      // GIỜ: hạ độ tin cậy — ROI theo giờ không đáng tin (múi giờ chưa canh + độ trễ chuyển đổi)
      // → luôn severity 'low', không bao giờ "gấp". device/geo giữ nguyên.
      severity: stype === 'hour' ? 'low' : (revMode ? (roiNeg ? 'high' : 'medium') : (roiNeg ? 'medium' : 'low')),
      confidence: revMode ? 'roi' : 'engagement',
      scope: { level: 'segment', label: `${bad.length} ${meta.noun}`, campaign_id, project_id, segment_type: stype },
      title: revMode
        ? `${meta.noun[0].toUpperCase()}${meta.noun.slice(1)} đang lỗ theo doanh thu thật — ${bad.length} mục`
        : `${meta.noun[0].toUpperCase()}${meta.noun.slice(1)} hiệu suất kém — ${bad.length} mục`,
      detail: revMode
        ? `Chi phí đáng kể nhưng doanh thu từ network thấp/không có ở ${meta.noun} này. Ví dụ: ${top}. Chi ${money(wasted)}, DT chỉ ${money(badRevenue)}.${stype === 'hour' ? TZ_CAVEAT : ''}`
        : `Chi phí cao nhưng CTR thấp / không click. Ví dụ: ${top}. Tổng chi phí liên quan ${money(wasted)}.${stype === 'hour' ? TZ_CAVEAT : ''}`,
      evidence: revMode
        ? [
            { metric: `Số ${meta.noun}`, value: String(bad.length) },
            { metric: 'Chi phí liên quan', value: money(wasted) },
            { metric: 'DT nguồn (các mục)', value: money(badRevenue) },
            { metric: 'Độ phủ breakdown', value: pct(bdCoverage * 100, 0) },
          ]
        : [
            { metric: `Số ${meta.noun}`, value: String(bad.length) },
            { metric: 'Chi phí liên quan', value: money(wasted) },
            { metric: 'CTR campaign', value: pct(health.ctr) },
          ],
      recommendedAction: meta.action + (stype === 'hour' ? TZ_CAVEAT : ''),
      impactScore: (revMode ? wasted - badRevenue : wasted) * (stype === 'hour' ? 0.3 : 1),
      items: bad.slice(0, 8).map(s => ({
        label: fmtSegVal(s), cost: s.cost,
        meta: s.revenue != null
          ? `DT ${money(s.revenue)}${s.roi != null ? ` · ROI ${pct(s.roi, 0)}` : ''} · ${count(s.clicks)} click`
          : `${count(s.clicks)} click · CTR ${pct(s.ctr)}`,
      })),
    }))
  }

  // 7e. Geo theo doanh thu thật (breakdown — confidence 'roi'):
  //     - geo_exclude: quốc gia tiêu tiền + đủ click mà DT = 0 trong khi các nước khác
  //       ra tiền → loại trừ (chắc hơn hẳn tín hiệu CTR).
  //     - geo_scale: quốc gia ROI cao, còn dư địa (chưa chiếm hết chi phí) → tách camp/bid up.
  if (hasBreakdownRevenue && enoughData) {
    const geoSegs = segAgg.filter(s => s.segment_type === 'geo' && s.revenue != null)
    const geoRevTotal = geoSegs.reduce((s, x) => s + (x.revenue ?? 0), 0)
    // geoCapped: network chỉ trả top-N nước + dòng "khác" → nước vắng khỏi breakdown CHƯA CHẮC 0đ
    // (có thể nằm trong "khác") → KHÔNG khuyên loại trừ, tránh cắt nhầm nước đang ra tiền.
    const zeroRev = (geoRevTotal > 0 && !bdMeta?.geoCapped)
      ? geoSegs.filter(s =>
          (s.revenue ?? 0) === 0 && s.clicks >= cfg.BD_SEG_MIN_CLICKS &&
          s.cost >= Math.max(sigCost, metricCost * 0.05))
      : []
    if (zeroRev.length) {
      const wasted = zeroRev.reduce((s, x) => s + x.cost, 0)
      const top = zeroRev.slice(0, 3).map(fmtSegVal).join(', ')
      suggestions.push(makeSuggestion({
        ruleKey: 'geo_exclude',
        params: { geos: zeroRev.map(s => s.segment_value), wasted },
        type: 'geo_exclude', severity: roiNeg ? 'high' : 'medium', confidence: 'roi',
        scope: { level: 'segment', label: `${zeroRev.length} quốc gia`, campaign_id, project_id, segment_type: 'geo' },
        title: `${zeroRev.length} quốc gia tiêu tiền nhưng 0 doanh thu — loại trừ`,
        detail: `Theo dữ liệu chuyển đổi từ network: ${top} đã chi ${money(wasted)} mà không tạo doanh thu nào, trong khi các nước khác vẫn ra tiền (${money(geoRevTotal)}).`,
        evidence: [
          { metric: 'Quốc gia 0 DT', value: String(zeroRev.length) },
          { metric: 'Chi phí lãng phí', value: money(wasted) },
          { metric: 'DT geo toàn camp', value: money(geoRevTotal) },
          { metric: 'Độ phủ breakdown', value: pct(bdCoverage * 100, 0) },
        ],
        recommendedAction: 'Campaign settings → Locations → Exclude các quốc gia này (hoặc bid adjustment −100%).',
        impactScore: wasted,
        items: zeroRev.slice(0, 8).map(s => ({
          label: fmtSegVal(s), cost: s.cost,
          meta: `${count(s.clicks)} click · DT $0.00`,
        })),
      }))
    }
    const scalable = geoSegs.filter(s =>
      s.roi != null && s.roi >= cfg.TARGET_ROI && (s.revenue ?? 0) >= cfg.BD_MIN_SEG_REVENUE &&
      metricCost > 0 && s.cost / metricCost < 0.5,
    )
    if (scalable.length) {
      const scaleRev = scalable.reduce((s, x) => s + (x.revenue ?? 0), 0)
      const top = scalable.slice(0, 3).map(s => `${fmtSegVal(s)} (ROI ${pct(s.roi!, 0)})`).join(', ')
      suggestions.push(makeSuggestion({
        ruleKey: 'geo_scale',
        params: { geos: scalable.map(s => s.segment_value), scaleRev },
        type: 'geo_scale', severity: 'medium', confidence: 'roi',
        scope: { level: 'segment', label: `${scalable.length} quốc gia lãi`, campaign_id, project_id, segment_type: 'geo' },
        title: `${scalable.length} quốc gia đang lãi tốt — tách camp / tăng bid để scale`,
        detail: `Theo doanh thu thật từ network: ${top} sinh ${money(scaleRev)} với ROI vượt ${cfg.TARGET_ROI}% nhưng mới chiếm phần nhỏ chi phí — còn dư địa scale.`,
        evidence: [
          { metric: 'Quốc gia lãi', value: String(scalable.length) },
          { metric: 'DT các nước này', value: money(scaleRev) },
          { metric: 'Độ phủ breakdown', value: pct(bdCoverage * 100, 0) },
        ],
        recommendedAction: 'Tách campaign riêng cho quốc gia lãi để kiểm soát budget/bid độc lập, hoặc đặt location bid adjustment +10–20% từng bước.',
        impactScore: scaleRev * 0.3,
        items: scalable.slice(0, 8).map(s => ({
          label: fmtSegVal(s), cost: s.cost,
          meta: `DT ${money(s.revenue ?? 0)} · ROI ${pct(s.roi ?? 0, 0)}`,
        })),
      }))
    }
  }

  // 8. Luôn nhắc nếu thiếu conversion tracking (mở khóa tối ưu sâu hơn).
  //    Đã có dữ liệu breakdown từ network nhưng CHƯA truyền sub-id → đổi lời khuyên thành
  //    hướng dẫn gắn {campaignid} vào tracking link (mở khóa attribution theo campaign).
  if (!hasConversionTracking) {
    const hasBdData = (input.segmentRevenue?.length ?? 0) > 0
    const wantSubId = hasBdData && (bdMeta?.subIdCoverage ?? 0) === 0
    suggestions.push(makeSuggestion({
      ruleKey: 'setup_tracking',
      type: 'setup_tracking', severity: 'low', confidence: 'engagement', scope,
      title: wantSubId
        ? 'Gắn sub-id vào tracking link — mở khóa attribution theo campaign'
        : 'Chưa có conversion tracking — tối ưu sâu bị giới hạn',
      detail: wantSubId
        ? 'Engine đã thu được dữ liệu chuyển đổi theo quốc gia/thiết bị từ network, nhưng chưa có sub-id nên doanh thu chỉ gắn được theo dự án. Truyền {campaignid} của Google Ads qua sub-id → doanh thu gắn đúng từng campaign, chính xác cả khi nhiều camp chung 1 dự án.'
        : 'Cơ sở phân tích là DT Màn hình (ước tính sớm, có thể lệch DT Thực). Google Ads không thấy doanh thu (chuyển đổi ở site merchant qua link ref) nên ROI chỉ biết ở mức project × ngày; keyword/search term/device/giờ/geo chỉ tối ưu bằng tín hiệu hiệu suất.',
      evidence: wantSubId
        ? [{ metric: 'DT có sub-id', value: '0%' }, { metric: 'Độ phủ breakdown', value: pct(bdCoverage * 100, 0) }]
        : [{ metric: 'Conversion trong kỳ', value: '0' }],
      recommendedAction: wantSubId
        ? 'Google Ads → Campaign settings → Final URL suffix: thêm `<tham_số_sub_của_network>={campaignid}` (vd `aff_sub={campaignid}` hoặc `s1={campaignid}`). Network trả sub-id theo từng chuyển đổi, Engine tự tách campaign — không cần script.'
        : 'Cân nhắc import postback/conversion từ network để mở khóa tối ưu ở mức keyword.',
      impactScore: 0,
    }))
  }

  // Dữ liệu non (playbook 0): camp mới chạy hoặc quá ít ngày metrics → chỉ nên
  // chặn rác, đừng kết luận lời/lỗ vội.
  const campAgeDays = input.campStartDate
    ? Math.floor((Date.now() - new Date(input.campStartDate + 'T00:00:00Z').getTime()) / 86400000)
    : null
  const dataMaturity: 'young' | 'ok' =
    days < cfg.MIN_DAYS_TO_JUDGE || (campAgeDays != null && campAgeDays >= 0 && campAgeDays < cfg.CAMP_YOUNG_DAYS)
      ? 'young' : 'ok'

  // Lộ trình test camp mới (Launch Checklist) — chỉ khác null khi camp còn non.
  const { plan: launchPlan, suggestions: launchSuggestions } = buildLaunchPlan({
    campaign_id, campaignLabel, project_id,
    dataMaturity, campAgeDays,
    hasMetrics: metrics.length > 0,
    hasCampStartDate: !!input.campStartDate,
    hasConversionTracking,
    settings: input.settings ?? null,
    broadCount: broadKws.length,
    badTermCount: badTerms.length,
    revenueEntered: totalRevenue > 0,
    testBudget: input.testBudget ?? null,
    lifetimeSpend: input.lifetime?.spend ?? totalSpend,
    lifetimeRevenue: input.lifetime?.revenue ?? totalRevenue,
  })
  suggestions.push(...launchSuggestions)

  // Insight Miner: phân tích ngày thắng/thua → giả thuyết tách camp / test mới.
  const { analysis: winDayAnalysis, suggestions: insightSuggestions } = mineWinDayInsights({
    campaign_id, campaignLabel, project_id,
    revenueByDate: input.revenueByDate, spendByDate: input.spendByDate,
    segments: input.segments, searchTerms: input.searchTerms,
  })
  suggestions.push(...insightSuggestions)

  const rank: Record<OptSeverity, number> = { high: 3, medium: 2, low: 1 }
  suggestions.sort((a, b) => rank[b.severity] - rank[a.severity] || b.impactScore - a.impactScore)

  // Ước tính tiết kiệm/kỳ: chi phí search-term rác (chặn negative là bỏ được ngay);
  // nếu không có search term thì lấy chi phí keyword kém làm proxy.
  const estimatedSavings =
    badTerms.reduce((s, t) => s + t.cost, 0) || badKws.reduce((s, k) => s + k.cost, 0)

  return {
    health,
    suggestions,
    hasConversionTracking,
    hasBreakdownRevenue,
    estimatedSavings,
    dataMaturity,
    winDayAnalysis,
    launchPlan,
    breakdowns: {
      keywords: kwAgg.slice(0, cfg.BREAKDOWN_LIMIT),
      searchTerms: stAgg.slice(0, cfg.BREAKDOWN_LIMIT),
      segments: segAgg.slice(0, cfg.BREAKDOWN_LIMIT * 3),
    },
  }
}

// tiện ích cho test/nơi khác nếu cần format bằng chứng thủ công
export const _fmt = { money, pct }
