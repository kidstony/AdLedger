import {
  OptimizationSuggestion,
  SearchTermMetric,
  SegmentMetric,
  WinDayAnalysis,
  WinDayLift,
} from './types'
import { countryNameByGeoId } from './geo-targets'

// ─────────────────────────────────────────────────────────────────────────────
// Insight Miner — phân tích ngày thắng/thua (win-day mix analysis).
//
// Doanh thu affiliate chỉ có ở mức project × ngày (không theo phân khúc), nên
// cách duy nhất "mổ" được ngày tốt là so CƠ CẤU CHI PHÍ theo phân khúc
// (geo/device/giờ/search-term) giữa nhóm ngày LÃI và nhóm ngày LỖ:
//   • phân khúc nghiêng hẳn về ngày lãi → giả thuyết tách camp/tăng bid để đo;
//   • nghiêng về ngày lỗ → giảm bid / loại trừ thử.
// Đây là TƯƠNG QUAN, không phải nhân quả → mọi output gắn nhãn "Giả thuyết",
// lời khuyên luôn là tách ra để P&L đo độc lập (playbook 4a — phá điểm mù đo).
// Chỉ xét "ngày chín" (≤ ngày cuối đã nhập doanh thu) để tránh lỗ giả.
// ─────────────────────────────────────────────────────────────────────────────

export const INSIGHT_CFG = {
  MIN_DAYS: 6,            // cần ≥ N ngày chín
  MIN_GROUP: 2,           // mỗi nhóm (win/lose) cần ≥ N ngày
  MIN_SHARE: 0.10,        // phân khúc phải chiếm ≥ 10% chi phí của nhóm mới đáng nói
  MIN_COST_FRACTION: 0.03,// và ≥ 3% tổng chi phí dim (lọc nhiễu tuyệt đối)
  LIFT_PP: 10,            // |lift| ≥ 10 điểm % mới tính là "nghiêng hẳn"
  SPIKE_MULT: 2.5,        // ngày lãi nhất: cost phân khúc ≥ 2.5× trung bình ngày khác = đột biến
  MAX_ITEMS: 6,           // số item tối đa mỗi thẻ gợi ý
} as const

export interface MinerInput {
  campaign_id: string
  campaignLabel: string
  project_id?: string
  revenueByDate: Record<string, number>
  spendByDate: Record<string, number>
  segments?: SegmentMetric[]
  searchTerms?: SearchTermMetric[]
}

const usdFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number) => '$' + usdFmt.format(n)

type Dim = WinDayLift['dim']

function fmtLabel(dim: Dim, value: string): string {
  if (dim === 'geo') return countryNameByGeoId(value) ?? value
  if (dim === 'hour') return `${value}h`
  return value
}

let seq = 0
const sug = (s: Omit<OptimizationSuggestion, 'id'>): OptimizationSuggestion => ({ id: `ins-${++seq}`, ...s })

export function mineWinDayInsights(input: MinerInput): {
  analysis: WinDayAnalysis | null
  suggestions: OptimizationSuggestion[]
} {
  seq = 0
  const { revenueByDate, spendByDate } = input

  // 1. Ngày chín: ≤ ngày cuối có doanh thu > 0.
  const revDates = Object.keys(revenueByDate).filter(d => (revenueByDate[d] ?? 0) > 0).sort()
  const cutoff = revDates[revDates.length - 1]
  if (!cutoff) return { analysis: null, suggestions: [] }

  const allDates = [...new Set([...Object.keys(revenueByDate), ...Object.keys(spendByDate)])]
    .filter(d => d <= cutoff)
    .sort()
  const days = allDates.map(date => {
    const revenue = revenueByDate[date] ?? 0
    const spend = spendByDate[date] ?? 0
    return { date, revenue, spend, profit: revenue - spend }
  })

  // 2. Phân nhóm + gate đủ dữ liệu.
  const winDays = days.filter(d => d.profit > 0).map(d => d.date)
  const loseDays = days.filter(d => d.profit <= 0).map(d => d.date)
  if (days.length < INSIGHT_CFG.MIN_DAYS || winDays.length < INSIGHT_CFG.MIN_GROUP || loseDays.length < INSIGHT_CFG.MIN_GROUP) {
    return { analysis: null, suggestions: [] }
  }
  const winSet = new Set(winDays)
  const loseSet = new Set(loseDays)
  const matureSet = new Set(allDates)

  // 3. Gom chi phí theo (dim, value) × nhóm ngày + theo từng ngày (cho spike).
  interface Cell { costWin: number; costLose: number; cost: number; byDate: Map<string, number> }
  const cells = new Map<string, Cell>()          // key: dim|value
  const dimTotals = new Map<Dim, { win: number; lose: number }>()

  const add = (dim: Dim, value: string, date: string, cost: number) => {
    if (!matureSet.has(date) || cost <= 0) return
    const key = `${dim}|${value}`
    const c = cells.get(key) ?? { costWin: 0, costLose: 0, cost: 0, byDate: new Map() }
    c.cost += cost
    c.byDate.set(date, (c.byDate.get(date) ?? 0) + cost)
    const t = dimTotals.get(dim) ?? { win: 0, lose: 0 }
    if (winSet.has(date)) { c.costWin += cost; t.win += cost }
    else if (loseSet.has(date)) { c.costLose += cost; t.lose += cost }
    dimTotals.set(dim, t)
    cells.set(key, c)
  }

  for (const s of input.segments ?? []) add(s.segment_type, s.segment_value, s.date, s.cost)
  for (const t of input.searchTerms ?? []) add('search_term', t.search_term, t.date, t.cost)

  // 4. Tính lift từng phân khúc.
  const lifts: WinDayLift[] = []
  for (const [key, c] of cells) {
    const [dim, value] = [key.slice(0, key.indexOf('|')) as Dim, key.slice(key.indexOf('|') + 1)]
    const t = dimTotals.get(dim)
    if (!t || t.win <= 0 || t.lose <= 0) continue
    const shareWin = c.costWin / t.win
    const shareLose = c.costLose / t.lose
    if (Math.max(shareWin, shareLose) < INSIGHT_CFG.MIN_SHARE) continue
    if (c.cost < (t.win + t.lose) * INSIGHT_CFG.MIN_COST_FRACTION) continue
    const liftPp = (shareWin - shareLose) * 100
    if (Math.abs(liftPp) < INSIGHT_CFG.LIFT_PP) continue
    lifts.push({
      dim, value, label: fmtLabel(dim, value),
      shareWinPct: shareWin * 100, shareLosePct: shareLose * 100,
      liftPp, cost: c.cost,
    })
  }
  lifts.sort((a, b) => b.liftPp - a.liftPp)

  const analysis: WinDayAnalysis = { matureDays: days.length, winDays, loseDays, days, lifts }
  const suggestions: OptimizationSuggestion[] = []
  const scope = { level: 'campaign' as const, label: input.campaignLabel, campaign_id: input.campaign_id, project_id: input.project_id }
  const pct0 = (n: number) => `${n.toFixed(0)}%`

  // 5a. Giả thuyết TÁCH: phân khúc nghiêng về ngày thắng.
  const positives = lifts.filter(l => l.liftPp >= INSIGHT_CFG.LIFT_PP)
  if (positives.length) {
    const top = positives.slice(0, INSIGHT_CFG.MAX_ITEMS)
    suggestions.push(sug({
      type: 'split_test', severity: 'medium', confidence: 'engagement', scope,
      title: `Giả thuyết — ngày thắng nghiêng về ${top.slice(0, 3).map(l => l.label).join(', ')}`,
      detail: `So ${winDays.length} ngày lãi với ${loseDays.length} ngày lỗ: ngày nào tiền quảng cáo dồn vào các phân khúc này thì ngày đó thường LÃI. Mới là tương quan (chưa chắc nhân quả) — đáng tách ra chạy riêng để biết chắc.`,
      evidence: [
        { metric: 'Ngày lãi / lỗ', value: `${winDays.length} / ${loseDays.length}` },
        { metric: 'Phân khúc nghiêng win', value: String(positives.length) },
      ],
      recommendedAction: 'Tách campaign riêng (geo/term) hoặc tăng bid adjustment (device/giờ) cho các phân khúc này; theo dõi P&L camp tách 7–14 ngày chín.',
      impactScore: top.reduce((s, l) => s + l.cost, 0),
      items: top.map(l => ({
        label: `${l.label} (${l.dim === 'search_term' ? 'term' : l.dim})`,
        cost: l.cost,
        meta: `chiếm ${pct0(l.shareWinPct)} chi phí ngày lãi, chỉ ${pct0(l.shareLosePct)} ngày lỗ`,
      })),
    }))
  }

  // 5b. Giả thuyết GIẢM: phân khúc nghiêng về ngày lỗ.
  const negatives = lifts.filter(l => l.liftPp <= -INSIGHT_CFG.LIFT_PP).sort((a, b) => a.liftPp - b.liftPp)
  if (negatives.length) {
    const top = negatives.slice(0, INSIGHT_CFG.MAX_ITEMS)
    suggestions.push(sug({
      type: 'split_test', severity: 'medium', confidence: 'engagement', scope,
      title: `Giả thuyết — ${top.slice(0, 3).map(l => l.label).join(', ')} gắn với ngày lỗ`,
      detail: `Ngày nào tiền quảng cáo dồn vào các phân khúc này thì ngày đó thường LỖ (so ${loseDays.length} ngày lỗ với ${winDays.length} ngày lãi). Cân nhắc giảm bid / loại trừ thử rồi quan sát P&L.`,
      evidence: [
        { metric: 'Ngày lãi / lỗ', value: `${winDays.length} / ${loseDays.length}` },
        { metric: 'Phân khúc nghiêng lose', value: String(negatives.length) },
      ],
      recommendedAction: 'Giảm bid từng nấc (−20–30%) hoặc loại trừ thử phân khúc này 5–7 ngày chín; hoàn lại nếu doanh thu tụt.',
      impactScore: top.reduce((s, l) => s + l.cost, 0) * 0.5,
      items: top.map(l => ({
        label: `${l.label} (${l.dim === 'search_term' ? 'term' : l.dim})`,
        cost: l.cost,
        meta: `chiếm ${pct0(l.shareLosePct)} chi phí ngày lỗ, còn ngày lãi chỉ ${pct0(l.shareWinPct)}`,
      })),
    }))
  }

  // 5c. Đột biến trên NGÀY LÃI NHẤT: phân khúc/term bùng ≥ SPIKE_MULT× trung bình
  //     các ngày chín khác (hoặc mới xuất hiện với chi phí đáng kể) → hướng test mới.
  const bestDay = [...days].sort((a, b) => b.profit - a.profit)[0]
  if (bestDay && bestDay.profit > 0) {
    const spikes: { label: string; cost: number; meta: string }[] = []
    for (const [key, c] of cells) {
      const [dim, value] = [key.slice(0, key.indexOf('|')) as Dim, key.slice(key.indexOf('|') + 1)]
      const onBest = c.byDate.get(bestDay.date) ?? 0
      if (onBest <= 0) continue
      const otherDays = days.length - 1
      const avgOther = otherDays > 0 ? (c.cost - onBest) / otherDays : 0
      const t = dimTotals.get(dim)
      const dimTotal = t ? t.win + t.lose : 0
      const significant = dimTotal > 0 && onBest >= dimTotal * INSIGHT_CFG.MIN_COST_FRACTION
      if (!significant) continue
      if (avgOther === 0 || onBest >= avgOther * INSIGHT_CFG.SPIKE_MULT) {
        spikes.push({
          label: `${fmtLabel(dim, value)} (${dim === 'search_term' ? 'term' : dim})`,
          cost: onBest,
          meta: avgOther === 0 ? 'mới xuất hiện đúng ngày lãi nhất' : `×${(onBest / avgOther).toFixed(1)} so trung bình ngày khác`,
        })
      }
    }
    if (spikes.length) {
      spikes.sort((a, b) => b.cost - a.cost)
      const top = spikes.slice(0, INSIGHT_CFG.MAX_ITEMS)
      suggestions.push(sug({
        type: 'split_test', severity: 'low', confidence: 'engagement', scope,
        title: `Giả thuyết — đột biến đúng ngày lãi nhất (${bestDay.date})`,
        detail: `Ngày lãi nhất (+${money(bestDay.profit)}) có phân khúc/cụm từ bùng chi tiêu bất thường so với các ngày khác. Có thể chính là nguồn tạo đột biến doanh thu — đáng test tách riêng.`,
        evidence: [
          { metric: 'Ngày lãi nhất', value: bestDay.date },
          { metric: 'Lãi ngày đó', value: money(bestDay.profit) },
        ],
        recommendedAction: 'Test tách phân khúc/cụm từ này (campaign riêng hoặc exact keyword + bid riêng) để xác nhận nó thực sự ra tiền.',
        impactScore: top.reduce((s, x) => s + x.cost, 0),
        items: top,
      }))
    }
  }

  return { analysis, suggestions }
}
