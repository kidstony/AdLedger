import { CFG, OptimizerCfg } from '@/lib/campaign-optimizer'

// ─────────────────────────────────────────────────────────────────────────────
// Optimizer v2 — ngưỡng mặc định + metadata để settings UI TỰ render.
//
// optimizer_settings.thresholds (jsonb) CHỈ chứa override {key: value} so với
// DEFAULT_THRESHOLDS ở đây — xóa key = quay về mặc định. label viết bằng lời
// dễ hiểu (user không quen thuật ngữ chuyên ngành).
// ─────────────────────────────────────────────────────────────────────────────

export type ThresholdGroup =
  | 'quyet_dinh'   // ngưỡng ra quyết định cắt/scale/bid
  | 'du_lieu'      // gate chất lượng/đủ dữ liệu
  | 'dot_bien'     // phát hiện đột biến (z-score)
  | 'trend'        // xuống dốc từ từ (nhiều tuần)
  | 'tien_thuc'    // tiền thực nhận (confirm-rate)
  | 'danh_gia'     // vòng đo kết quả sau khi áp dụng
  | 'phieu_test'   // mặc định phiếu test

export interface ThresholdDef {
  key: string
  value: number
  label: string          // lời dễ hiểu, tiếng Việt
  group: ThresholdGroup
  min: number
  max: number
  step: number
  unit?: string          // '%', '$', 'ngày', 'click', 'đпt', '×'...
}

export const DEFAULT_THRESHOLDS: ThresholdDef[] = [
  // ── Ra quyết định (từ CFG cũ — giữ nguyên giá trị) ────────────────────────
  { key: 'LOSS_ROI',            value: CFG.LOSS_ROI,            label: 'Lỗ quá mức này thì khuyên cắt camp',                group: 'quyet_dinh', min: -80, max: 0,   step: 5,    unit: '%' },
  { key: 'TARGET_ROI',          value: CFG.TARGET_ROI,          label: 'Lãi trên mức này thì khuyên scale',                 group: 'quyet_dinh', min: 5,   max: 100, step: 5,    unit: '%' },
  { key: 'IS_BUDGET_THRESHOLD', value: CFG.IS_BUDGET_THRESHOLD, label: 'Mất hiển thị vì hết ngân sách trên mức này → khuyên tăng ngân sách', group: 'quyet_dinh', min: 0.05, max: 0.5, step: 0.05, unit: '×' },
  { key: 'IS_RANK_THRESHOLD',   value: CFG.IS_RANK_THRESHOLD,   label: 'Mất hiển thị vì thua hạng trên mức này → khuyên tăng bid',           group: 'quyet_dinh', min: 0.05, max: 0.5, step: 0.05, unit: '×' },
  { key: 'BID_CEILING_RATIO',   value: CFG.BID_CEILING_RATIO,   label: 'Giá click an toàn tối đa (theo % tiền mỗi click tạo ra)',            group: 'quyet_dinh', min: 0.3, max: 0.9, step: 0.05, unit: '×' },
  { key: 'ABS_TOP_HIGH',        value: CFG.ABS_TOP_HIGH,        label: 'Đứng top 1 quá tỷ lệ này + lãi mỏng → khuyên thử giảm bid',          group: 'quyet_dinh', min: 0.4, max: 0.95, step: 0.05, unit: '×' },
  { key: 'CTR_FLOOR',           value: CFG.CTR_FLOOR,           label: 'Tỷ lệ bấm dưới mức này → nghi mẫu quảng cáo kém',   group: 'quyet_dinh', min: 0.3, max: 5,   step: 0.1,  unit: '%' },
  { key: 'DAYPART_SPEND_FRACTION', value: CFG.DAYPART_SPEND_FRACTION, label: 'Ngày trong tuần chiếm trên tỷ lệ chi phí này mới xét lỗ/lãi', group: 'quyet_dinh', min: 0.02, max: 0.2, step: 0.01, unit: '×' },
  { key: 'KW_COST_FRACTION',    value: CFG.KW_COST_FRACTION,    label: 'Từ khóa/cụm từ chiếm trên tỷ lệ chi phí này mới đáng xét',           group: 'quyet_dinh', min: 0.01, max: 0.1, step: 0.01, unit: '×' },
  { key: 'LOW_CTR_RATIO',       value: CFG.LOW_CTR_RATIO,       label: 'Tỷ lệ bấm dưới mức này so với camp = kém',          group: 'quyet_dinh', min: 0.2, max: 0.8, step: 0.05, unit: '×' },
  { key: 'QS_LOW',              value: CFG.QS_LOW,              label: 'Điểm chất lượng từ khóa ≤ mức này = kém',           group: 'quyet_dinh', min: 1,   max: 5,   step: 1 },
  { key: 'QS_DIAG_MAX',         value: CFG.QS_DIAG_MAX,         label: 'Điểm chất lượng ≤ mức này thì chẩn bệnh chi tiết',  group: 'quyet_dinh', min: 3,   max: 7,   step: 1 },
  { key: 'HARVEST_MIN_CLICKS',  value: CFG.HARVEST_MIN_CLICKS,  label: 'Cụm từ cần tối thiểu bao nhiêu click mới đáng "gặt" thành keyword',  group: 'quyet_dinh', min: 5, max: 50, step: 5, unit: 'click' },
  { key: 'HARVEST_CTR_RATIO',   value: CFG.HARVEST_CTR_RATIO,   label: 'Tỷ lệ bấm phải vượt camp bao nhiêu lần mới đáng gặt', group: 'quyet_dinh', min: 1, max: 2, step: 0.1, unit: '×' },

  // ── Gate đủ dữ liệu ────────────────────────────────────────────────────────
  { key: 'MIN_CLICKS_TO_JUDGE', value: CFG.MIN_CLICKS_TO_JUDGE, label: 'Cần tối thiểu bao nhiêu click mới dám kết luận',    group: 'du_lieu', min: 10,  max: 200, step: 10, unit: 'click' },
  { key: 'MIN_DAYS_TO_JUDGE',   value: CFG.MIN_DAYS_TO_JUDGE,   label: 'Cần tối thiểu bao nhiêu ngày dữ liệu',              group: 'du_lieu', min: 2,   max: 14,  step: 1,  unit: 'ngày' },
  { key: 'CAMP_YOUNG_DAYS',     value: CFG.CAMP_YOUNG_DAYS,     label: 'Camp dưới bao nhiêu ngày tuổi = còn non (chỉ hiện checklist)', group: 'du_lieu', min: 3, max: 14, step: 1, unit: 'ngày' },
  { key: 'MIN_IMPR_FOR_CTR',    value: CFG.MIN_IMPR_FOR_CTR,    label: 'Cần bao nhiêu lượt hiển thị mới xét tỷ lệ bấm',     group: 'du_lieu', min: 100, max: 5000, step: 100 },
  { key: 'BD_COVERAGE_MIN',     value: CFG.BD_COVERAGE_MIN,     label: 'Doanh thu chi tiết (theo nước) phải phủ tỷ lệ này mới tin ROI theo nước', group: 'du_lieu', min: 0.3, max: 0.9, step: 0.05, unit: '×' },
  { key: 'BD_SEG_MIN_CLICKS',   value: CFG.BD_SEG_MIN_CLICKS,   label: 'Một nước/thiết bị cần tối thiểu bao nhiêu click mới kết luận "không ra tiền"', group: 'du_lieu', min: 5, max: 50, step: 5, unit: 'click' },
  { key: 'BD_MIN_SEG_REVENUE',  value: CFG.BD_MIN_SEG_REVENUE,  label: 'Doanh thu một nước tối thiểu ($) mới khuyên scale nước đó', group: 'du_lieu', min: 1, max: 50, step: 1, unit: '$' },
  { key: 'SEG_COST_COVERAGE_MIN', value: CFG.SEG_COST_COVERAGE_MIN, label: 'Chi phí theo nước/thiết bị phải phủ tỷ lệ này của camp mới tin ROI', group: 'du_lieu', min: 0.5, max: 0.95, step: 0.05, unit: '×' },

  // ── Đột biến (so với nền 28 ngày) ─────────────────────────────────────────
  { key: 'AN_BASELINE_DAYS',    value: 28,  label: 'Số ngày làm nền so sánh',                              group: 'dot_bien', min: 14, max: 56, step: 7, unit: 'ngày' },
  { key: 'AN_MIN_BASELINE_DAYS',value: 7,   label: 'Cần tối thiểu bao nhiêu ngày nền mới soi đột biến',    group: 'dot_bien', min: 5,  max: 21, step: 1, unit: 'ngày' },
  { key: 'AN_Z_WARN',           value: 2.5, label: 'Độ lệch bất thường mức CẢNH BÁO (z-score)',            group: 'dot_bien', min: 1.5, max: 4, step: 0.25 },
  { key: 'AN_Z_HIGH',           value: 3.5, label: 'Độ lệch bất thường mức NGHIÊM TRỌNG (z-score)',        group: 'dot_bien', min: 2.5, max: 6, step: 0.25 },
  { key: 'AN_CPC_SPIKE_PCT',    value: 40,  label: 'Giá click tăng vọt trên % này trong 1 ngày = nghiêm trọng', group: 'dot_bien', min: 20, max: 100, step: 5, unit: '%' },
  { key: 'AN_CTR_COLLAPSE_PCT', value: 40,  label: 'Tỷ lệ bấm sập trên % này trong 1 ngày = nghiêm trọng', group: 'dot_bien', min: 20, max: 80, step: 5, unit: '%' },
  { key: 'AN_ROI_DROP_WARN',    value: 15,  label: 'Lãi/lỗ tụt bao nhiêu điểm % so với nền = cảnh báo',    group: 'dot_bien', min: 5, max: 40, step: 5, unit: 'đpt' },
  { key: 'AN_ROI_DROP_HIGH',    value: 30,  label: 'Lãi/lỗ tụt bao nhiêu điểm % = nghiêm trọng',           group: 'dot_bien', min: 15, max: 60, step: 5, unit: 'đpt' },
  { key: 'AN_IS_LOST_WARN',     value: 10,  label: 'Mất hiển thị vì hết tiền tăng bao nhiêu điểm % = cảnh báo', group: 'dot_bien', min: 5, max: 30, step: 5, unit: 'đpt' },
  { key: 'AN_MIN_CLICKS',       value: 20,  label: 'Ngày đó cần tối thiểu bao nhiêu click mới soi giá click/tỷ lệ bấm', group: 'dot_bien', min: 10, max: 100, step: 5, unit: 'click' },
  { key: 'AN_MIN_SPEND',        value: 5,   label: 'Ngày đó cần chi tối thiểu ($) mới soi chi phí/lãi lỗ', group: 'dot_bien', min: 1, max: 50, step: 1, unit: '$' },
  { key: 'AN_GEO_HOT_MULT',     value: 3,   label: 'Doanh thu một nước gấp mấy lần bình thường = nước hot (cảnh báo)', group: 'dot_bien', min: 2, max: 10, step: 0.5, unit: '×' },
  { key: 'AN_GEO_HOT_MULT_HIGH',value: 5,   label: 'Gấp mấy lần = rất hot (đề xuất phiếu test ngay)',      group: 'dot_bien', min: 3, max: 15, step: 0.5, unit: '×' },
  { key: 'AN_GEO_HOT_MIN_USD',  value: 3,   label: 'Doanh thu nước hot tối thiểu ($) mới đáng nói',        group: 'dot_bien', min: 1, max: 50, step: 1, unit: '$' },
  { key: 'AN_GEO_HOT_HIGH_USD', value: 10,  label: 'Nước MỚI xuất hiện với doanh thu trên ($) = rất hot',  group: 'dot_bien', min: 3, max: 100, step: 1, unit: '$' },
  { key: 'AN_COOLDOWN_DAYS',    value: 3,   label: 'Cùng một đột biến không báo lại trong bao nhiêu ngày', group: 'dot_bien', min: 1, max: 14, step: 1, unit: 'ngày' },

  // ── Xuống dốc từ từ (trend nhiều tuần) ────────────────────────────────────
  { key: 'TR_WINDOW_DAYS',      value: 21,  label: 'Soi chiều hướng trên bao nhiêu ngày',                  group: 'trend', min: 14, max: 42, step: 7, unit: 'ngày' },
  { key: 'TR_CPC_WARN_PCT',     value: 20,  label: 'Giá click bò dần lên tổng cộng % này = cảnh báo',      group: 'trend', min: 10, max: 50, step: 5, unit: '%' },
  { key: 'TR_CPC_HIGH_PCT',     value: 35,  label: 'Giá click bò lên % này = nghiêm trọng',                group: 'trend', min: 20, max: 80, step: 5, unit: '%' },
  { key: 'TR_REV_WARN_PCT',     value: 25,  label: 'Doanh thu tụt dần tổng cộng % này = cảnh báo',         group: 'trend', min: 10, max: 60, step: 5, unit: '%' },
  { key: 'TR_REV_HIGH_PCT',     value: 40,  label: 'Doanh thu tụt dần % này = nghiêm trọng',               group: 'trend', min: 25, max: 80, step: 5, unit: '%' },
  { key: 'TR_ROI_WARN_DPT',     value: 15,  label: 'Lãi/lỗ trượt dần bao nhiêu điểm % = cảnh báo',         group: 'trend', min: 5, max: 40, step: 5, unit: 'đpt' },
  { key: 'TR_COOLDOWN_DAYS',    value: 7,   label: 'Cùng một cảnh báo chiều hướng không lặp lại trong bao nhiêu ngày', group: 'trend', min: 3, max: 21, step: 1, unit: 'ngày' },

  // ── Tiền thực nhận (confirm-rate) + sự cố network ────────────────────────
  { key: 'CR_PERIODS',          value: 3,   label: 'Tính tỷ lệ thực trả trên mấy kỳ thanh toán gần nhất',  group: 'tien_thuc', min: 1, max: 6, step: 1, unit: 'kỳ' },
  { key: 'CR_DROP_DPT',         value: 10,  label: 'Kỳ mới trả thiếu thêm bao nhiêu điểm % thì báo động',  group: 'tien_thuc', min: 5, max: 30, step: 5, unit: 'đpt' },
  { key: 'OUT_MIN_CLICKS',      value: 20,  label: 'Nghi mất kết nối network khi doanh thu = 0 mà vẫn có trên bao nhiêu click', group: 'tien_thuc', min: 10, max: 100, step: 5, unit: 'click' },
  { key: 'OUT_STALE_HOURS',     value: 24,  label: 'Dữ liệu network cũ hơn bao nhiêu giờ = chưa tươi (tạm ngừng kết luận doanh thu)', group: 'tien_thuc', min: 8, max: 72, step: 4, unit: 'giờ' },

  // ── Vòng đo kết quả sau khi áp dụng ───────────────────────────────────────
  { key: 'EV_WINDOW_DAYS',      value: 7,   label: 'Đo kết quả sau khi áp dụng trong bao nhiêu ngày',      group: 'danh_gia', min: 5, max: 14, step: 1, unit: 'ngày' },
  { key: 'EV_WIN_PCT',          value: 10,  label: 'Cải thiện trên % này = đề xuất ĐÚNG; xấu đi trên % này = SAI', group: 'danh_gia', min: 5, max: 30, step: 5, unit: '%' },
  { key: 'EV_EXPIRE_DAYS',      value: 5,   label: 'Đề xuất hết còn đúng bao nhiêu ngày thì tự ẩn',        group: 'danh_gia', min: 3, max: 14, step: 1, unit: 'ngày' },
  { key: 'EV_COOLDOWN_DAYS',    value: 7,   label: 'Đề xuất đã bỏ qua thì bao nhiêu ngày sau mới nhắc lại', group: 'danh_gia', min: 3, max: 30, step: 1, unit: 'ngày' },

  // ── Phiếu test ────────────────────────────────────────────────────────────
  { key: 'TK_MAX_BUDGET',       value: 30,  label: 'Ngân sách test mặc định tối đa ($)',                   group: 'phieu_test', min: 5, max: 200, step: 5, unit: '$' },
  { key: 'TK_MAX_DAYS',         value: 10,  label: 'Test tối đa bao nhiêu ngày rồi chốt thắng/thua',       group: 'phieu_test', min: 5, max: 30, step: 1, unit: 'ngày' },
  { key: 'TK_MIN_DAYS',         value: 5,   label: 'Chạy tối thiểu bao nhiêu ngày mới được kết luận THẮNG sớm', group: 'phieu_test', min: 3, max: 10, step: 1, unit: 'ngày' },
  { key: 'TK_MIN_CLICKS',       value: 50,  label: 'Cần tối thiểu bao nhiêu click mới kết luận',           group: 'phieu_test', min: 20, max: 300, step: 10, unit: 'click' },
  { key: 'TK_MIN_REVENUE',      value: 10,  label: 'Doanh thu tối thiểu ($) để tính là thắng',             group: 'phieu_test', min: 3, max: 100, step: 1, unit: '$' },
  { key: 'TK_ABANDON_DAYS',     value: 14,  label: 'Phiếu không gắn camp trong bao nhiêu ngày thì tự đóng', group: 'phieu_test', min: 7, max: 30, step: 1, unit: 'ngày' },
  { key: 'TK_LOST_COOLDOWN_DAYS', value: 30, label: 'Test thua thì bao nhiêu ngày sau mới đề xuất lại cùng ý tưởng', group: 'phieu_test', min: 14, max: 90, step: 7, unit: 'ngày' },
]

export type Thresholds = Record<string, number>

// Gộp: mặc định + override từ DB (chỉ nhận key hợp lệ, giá trị trong [min, max]).
export function mergeThresholds(overrides?: Record<string, unknown> | null): Thresholds {
  const out: Thresholds = {}
  for (const d of DEFAULT_THRESHOLDS) out[d.key] = d.value
  if (overrides) {
    for (const d of DEFAULT_THRESHOLDS) {
      const v = overrides[d.key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[d.key] = Math.min(d.max, Math.max(d.min, v))
      }
    }
  }
  return out
}

// Rút phần ngưỡng thuộc CFG cũ để truyền vào optimizeCampaign(input, cfg).
export function toOptimizerCfg(th: Thresholds): Partial<OptimizerCfg> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(CFG)) {
    if (th[k] != null) out[k] = th[k]
  }
  return out as Partial<OptimizerCfg>
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec đo kết quả per-rule (feedback loop): sau khi user bấm "Đã áp dụng",
// engine chờ windowDays rồi so cửa sổ TRƯỚC vs SAU trên đúng metric của rule.
// Rule không có spec (setup_tracking, data_quality...) = chỉ ghi nhận, không đo.
// ─────────────────────────────────────────────────────────────────────────────

export type EvalMetric = 'cpc' | 'ctr' | 'roi' | 'revenue_screen' | 'spend' | 'profit'

export interface RuleEvalSpec {
  metric: EvalMetric
  successWhen: 'up' | 'down'
  minClicks?: number      // cửa sổ SAU cần đủ click mới kết luận (mặc định 20)
}

export const RULE_EVAL: Record<string, RuleEvalSpec> = {
  cut_no_revenue:     { metric: 'profit',         successWhen: 'up' },
  cut_deep_loss:      { metric: 'profit',         successWhen: 'up' },
  launch_stoploss:    { metric: 'profit',         successWhen: 'up' },
  raise_budget_scale: { metric: 'revenue_screen', successWhen: 'up', minClicks: 20 },
  raise_bid_rank:     { metric: 'revenue_screen', successWhen: 'up', minClicks: 20 },
  bid_ceiling:        { metric: 'cpc',            successWhen: 'down', minClicks: 20 },
  abs_top_wasteful:   { metric: 'cpc',            successWhen: 'down', minClicks: 20 },
  fix_geo_presence:   { metric: 'roi',            successWhen: 'up' },
  daypart_loss:       { metric: 'profit',         successWhen: 'up' },
  low_ctr_creative:   { metric: 'ctr',            successWhen: 'up', minClicks: 20 },
  fix_ad_relevance:   { metric: 'ctr',            successWhen: 'up', minClicks: 20 },
  fix_landing_page:   { metric: 'cpc',            successWhen: 'down', minClicks: 20 },
  pause_keyword:      { metric: 'roi',            successWhen: 'up' },
  add_negative:       { metric: 'roi',            successWhen: 'up' },
  tighten_broad:      { metric: 'roi',            successWhen: 'up' },
  harvest_keyword:    { metric: 'revenue_screen', successWhen: 'up' },
  segment_perf:       { metric: 'roi',            successWhen: 'up' },
  geo_exclude:        { metric: 'profit',         successWhen: 'up' },
  geo_scale:          { metric: 'revenue_screen', successWhen: 'up' },
  insight_win_lift:   { metric: 'profit',         successWhen: 'up' },
  insight_lose_lift:  { metric: 'profit',         successWhen: 'up' },
  insight_spike_day:  { metric: 'profit',         successWhen: 'up' },
  // Rule sinh từ anomaly/trend/confirm (engine tạo):
  anomaly_cpc:        { metric: 'cpc',            successWhen: 'down', minClicks: 20 },
  anomaly_ctr:        { metric: 'ctr',            successWhen: 'up', minClicks: 20 },
  anomaly_spend:      { metric: 'roi',            successWhen: 'up' },
  anomaly_revenue:    { metric: 'revenue_screen', successWhen: 'up' },
  anomaly_roi:        { metric: 'roi',            successWhen: 'up' },
  anomaly_is_budget:  { metric: 'revenue_screen', successWhen: 'up' },
  trend_cpc:          { metric: 'cpc',            successWhen: 'down', minClicks: 20 },
  trend_revenue:      { metric: 'revenue_screen', successWhen: 'up' },
  trend_roi:          { metric: 'roi',            successWhen: 'up' },
  scale_test_winner:  { metric: 'revenue_screen', successWhen: 'up' },
}

// Trọng số độ chắc: đề xuất dựa doanh thu thật đáng tin hơn tín hiệu hiệu suất.
export const CONF_WEIGHT: Record<'roi' | 'engagement', number> = { roi: 1.0, engagement: 0.6 }

export interface RuleStat { won: number; lost: number; inconclusive: number; confounded: number }

// Độ tin cậy per-rule (Laplace smoothing) — cold start = 0.5, hội tụ theo outcome thật.
export function ruleReliability(stat?: RuleStat | null): number {
  const won = stat?.won ?? 0
  const lost = stat?.lost ?? 0
  return (won + 1) / (won + lost + 2)
}

export function suggestionScore(impact: number, confidence: 'roi' | 'engagement', stat?: RuleStat | null): number {
  return impact * CONF_WEIGHT[confidence] * ruleReliability(stat)
}
