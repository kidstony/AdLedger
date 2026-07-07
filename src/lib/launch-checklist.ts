import { CampaignSettings, LaunchCheckItem, LaunchPlan, OptimizationSuggestion } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Lộ trình test camp mới — hướng dẫn theo giai đoạn cho người mới (playbook 0–1).
// Chỉ hiện khi camp còn non; camp trưởng thành (đủ dữ liệu + đã có doanh thu)
// thì ẩn — engine gợi ý cut/scale bình thường.
// Stop-loss: user đặt projects.test_budget; chi lũy kế chạm mức mà DT lũy kế = 0
// → báo ĐỎ "DỪNG TEST" + đẩy thẻ cut ưu tiên cao.
// ─────────────────────────────────────────────────────────────────────────────

export const LAUNCH_CFG = {
  STOPLOSS_WARN_FRACTION: 0.8,   // chi ≥ 80% ngân sách test → cảnh báo sớm
} as const

// Chiến lược bid cần conversion data để học — vô nghĩa khi affiliate không có tracking.
const CONVERSION_BID_STRATEGIES = ['TARGET_CPA', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS']

export interface LaunchArgs {
  campaign_id: string
  campaignLabel: string
  project_id?: string
  dataMaturity: 'young' | 'ok'
  campAgeDays: number | null
  hasMetrics: boolean
  hasCampStartDate: boolean
  hasConversionTracking: boolean
  settings?: CampaignSettings | null
  broadCount: number        // số keyword broad match chi tiêu đáng kể
  badTermCount: number      // số search term nghi rác chưa chặn
  revenueEntered: boolean   // đã nhập DT Màn hình trong kỳ
  testBudget: number | null
  lifetimeSpend: number
  lifetimeRevenue: number
}

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number) => '$' + usdFmt.format(n)

let seq = 0
const sug = (s: Omit<OptimizationSuggestion, 'id'>): OptimizationSuggestion => ({ id: `ln-${++seq}`, ...s })

export function buildLaunchPlan(a: LaunchArgs): {
  plan: LaunchPlan | null
  suggestions: OptimizationSuggestion[]
} {
  seq = 0
  // Camp trưởng thành → không cần lộ trình test.
  if (a.dataMaturity === 'ok' && a.hasMetrics && a.revenueEntered) {
    return { plan: null, suggestions: [] }
  }

  const age = a.campAgeDays
  const stage: 1 | 2 | 3 = age == null
    ? (a.hasMetrics ? 2 : 1)
    : age <= 3 ? 1 : age <= 7 ? 2 : 3
  const stageMeta: Record<1 | 2 | 3, { label: string; guide: string }> = {
    1: {
      label: 'Chặn rác (ngày 1–3)',
      guide: 'ĐỪNG kết luận lời/lỗ giai đoạn này. Việc duy nhất đáng làm: mỗi ngày quét search terms → chặn cụm rác; kiểm tra cài đặt nền bên dưới. Mọi con số khác đều còn là nhiễu.',
    },
    2: {
      label: 'Đọc tín hiệu sớm (ngày 4–7)',
      guide: 'Bắt đầu nhìn CTR/CPC/IS và nhập DT Màn hình hằng ngày. Vẫn chưa kết luận — chỉ dừng sớm nếu chạm stop-loss mà chưa có đồng doanh thu nào.',
    },
    3: {
      label: 'Chờ dữ liệu chín (tuần 2)',
      guide: 'Doanh thu network thường về trễ — tiếp tục nhập DT đều. Khi đủ ngày dữ liệu chín, lộ trình này tự ẩn và engine sẽ gợi ý cắt/scale như bình thường.',
    },
  }

  const items: LaunchCheckItem[] = []
  const it = (id: string, status: LaunchCheckItem['status'], label: string, detail?: string) =>
    items.push({ id, status, label, detail })

  // ── Auto-check từ dữ liệu thật ──
  it('sync', a.hasMetrics ? 'pass' : 'todo',
    'Số liệu Google Ads đã đồng bộ về',
    a.hasMetrics ? undefined : 'Dán script tab "Hàng ngày" (trang Tích hợp) vào Google Ads và Run — chưa có số liệu thì mọi phân tích đều mù.')

  it('start_date', a.hasCampStartDate ? 'pass' : 'warn',
    'Đã đặt ngày start camp cho dự án',
    a.hasCampStartDate ? undefined : 'Đặt "Ngày start camp" trong Quản lý dự án để app tính đúng tuổi camp và giai đoạn test.')

  const strategy = a.settings?.bidding_strategy ?? null
  if (strategy == null) {
    it('bid_strategy', 'info', 'Chiến lược giá thầu (chưa sync — chạy script bản mới)')
  } else if (!a.hasConversionTracking && CONVERSION_BID_STRATEGIES.includes(strategy)) {
    it('bid_strategy', 'warn', `Bid ${strategy} nhưng KHÔNG có conversion tracking`,
      'Smart bidding không có dữ liệu chuyển đổi để học → chạy mù. Camp test nên dùng Manual CPC (hoặc Maximize clicks + trần CPC).')
  } else {
    it('bid_strategy', 'pass', `Chiến lược bid phù hợp để test (${strategy})`)
  }

  const geo = a.settings?.geo_target_type ?? null
  if (geo == null) {
    it('geo_setting', 'info', 'Location options (chưa sync — chạy script bản mới)')
  } else if (geo === 'PRESENCE_OR_INTEREST') {
    it('geo_setting', 'warn', 'Location đang là "Presence or interest" — rò cost ngoài geo',
      'Đổi sang "Presence" trong Campaign settings → Locations → Location options.')
  } else {
    it('geo_setting', 'pass', 'Location = Presence (đúng cho affiliate trả theo geo)')
  }

  it('broad', a.broadCount === 0 ? 'pass' : 'warn',
    a.broadCount === 0 ? 'Không chạy broad match' : `${a.broadCount} keyword broad match đang chi tiêu`,
    a.broadCount === 0 ? undefined : 'Người mới nên bắt đầu bằng phrase/exact — broad không có conversion signal sẽ đốt tiền vào click rẻ nhưng lạc đề.')

  it('search_terms', a.badTermCount === 0 ? 'pass' : 'warn',
    a.badTermCount === 0 ? 'Không còn search term nghi rác' : `${a.badTermCount} search term nghi rác chưa chặn`,
    a.badTermCount === 0 ? undefined : 'Xem bảng "Search term theo chi phí" bên dưới → thêm negative keyword. Việc quan trọng nhất của giai đoạn test.')

  it('revenue_entry', a.revenueEntered ? 'pass' : 'todo',
    a.revenueEntered ? 'Đã nhập DT Màn hình' : 'Chưa nhập DT Màn hình',
    a.revenueEntered ? undefined : 'Nhập DT Màn hình hằng ngày (trang Nhập doanh thu) — không có nó, app không tính được ROI/stop-loss cho camp.')

  // ── Stop-loss ──
  const stopLossHit = a.testBudget != null && a.testBudget > 0
    && a.lifetimeSpend >= a.testBudget && a.lifetimeRevenue <= 0
  if (a.testBudget == null || a.testBudget <= 0) {
    it('stop_loss', 'todo', 'Chưa đặt ngân sách test (stop-loss)',
      'Đặt mức tối đa chấp nhận mất để test (vd $50). Chi lũy kế chạm mức mà chưa có doanh thu → app báo DỪNG.')
  } else if (stopLossHit) {
    it('stop_loss', 'warn', `ĐÃ CHẠM STOP-LOSS: tiêu ${money(a.lifetimeSpend)}/${money(a.testBudget)} mà chưa có doanh thu`,
      'Dừng test. Rà lại offer/keyword/landing trước khi đốt thêm tiền.')
  } else if (a.lifetimeSpend >= a.testBudget * LAUNCH_CFG.STOPLOSS_WARN_FRACTION) {
    it('stop_loss', 'warn', `Sắp chạm ngân sách test: ${money(a.lifetimeSpend)}/${money(a.testBudget)}`,
      a.lifetimeRevenue > 0 ? 'Đã có doanh thu — cân nhắc nới ngân sách nếu tín hiệu tốt.' : 'Chuẩn bị quyết định dừng/tiếp nếu doanh thu vẫn chưa về.')
  } else {
    it('stop_loss', 'pass', `Ngân sách test: đã dùng ${money(a.lifetimeSpend)}/${money(a.testBudget)}`)
  }

  // ── Manual — chỉ hướng dẫn, app không kiểm được ──
  it('m_negative', 'info', 'Thêm negative list cơ bản TRƯỚC khi bật camp',
    'free, crack, torrent, tuyển dụng, lương, scam/lừa đảo, tên thương hiệu không liên quan…')
  it('m_landing', 'info', 'Tự đi lại hành trình khách trên mobile + desktop',
    'Gõ keyword → thấy ad → bấm → landing. Lệch thông điệp ở nhịp nào là mất tiền ở nhịp đó.')
  it('m_geo_payout', 'info', 'Geo target khớp danh sách quốc gia offer TRẢ TIỀN',
    'Cost ở geo ngoài payout là mất trắng — đối chiếu điều khoản offer trước khi bật.')

  const plan: LaunchPlan = {
    stage, stageLabel: stageMeta[stage].label, stageGuide: stageMeta[stage].guide,
    campAgeDays: age,
    lifetimeSpend: a.lifetimeSpend, lifetimeRevenue: a.lifetimeRevenue,
    testBudget: a.testBudget, stopLossHit, items,
  }

  const suggestions: OptimizationSuggestion[] = []
  if (stopLossHit && a.testBudget != null) {
    suggestions.push(sug({
      type: 'cut', severity: 'high', confidence: 'roi',
      scope: { level: 'campaign', label: a.campaignLabel, campaign_id: a.campaign_id, project_id: a.project_id },
      title: 'Chạm ngân sách test mà chưa có doanh thu — DỪNG TEST',
      detail: `Đã tiêu ${money(a.lifetimeSpend)} / ngân sách test ${money(a.testBudget)} từ khi start camp mà DT Màn hình lũy kế = 0.`,
      evidence: [
        { metric: 'Chi lũy kế', value: money(a.lifetimeSpend) },
        { metric: 'Ngân sách test', value: money(a.testBudget) },
        { metric: 'DT lũy kế', value: '$0.00' },
      ],
      recommendedAction: 'Pause camp. Rà lại theo thứ tự: offer còn trả cho geo này? → search terms có đúng intent? → landing/pre-lander. Chỉ bật lại khi sửa được ít nhất 1 nghi vấn.',
      impactScore: a.lifetimeSpend,
    }))
  }

  return { plan, suggestions }
}
