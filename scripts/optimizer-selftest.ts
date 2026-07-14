/* Self-test logic thuần của Optimizer v2 — chạy: npx tsx scripts/optimizer-selftest.ts
   Không đụng DB/mạng. Kiểm: toán đột biến (median/MAD/z, DOW), trend Theil–Sen,
   nước/offer hot, confirm-rate, chấm outcome đề xuất, state machine phiếu test,
   nghi sự cố network, merge ngưỡng. Exit code ≠ 0 nếu có case sai. */

import {
  median, madSpread, theilSenSlope,
  detectDailyAnomalies, detectTrends, detectHotKeys, looksLikeOutage,
  DailyStatPoint,
} from '../src/lib/optimizer/anomaly'
import { computeConfirmRate } from '../src/lib/optimizer/confirm-rate'
import { evaluateOutcome, windowsOverlap, EvalDailyStat } from '../src/lib/optimizer/evaluate'
import { evaluateTicket, synthesizeTicket, TicketDay } from '../src/lib/optimizer/tests'
import { mergeThresholds, toOptimizerCfg, RULE_EVAL, ruleReliability, suggestionScore } from '../src/lib/optimizer/defaults'
import { optimizeCampaign } from '../src/lib/campaign-optimizer'
import { CampaignMetric } from '../src/lib/types'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra) : '') }
}

const th = mergeThresholds(null)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const dayN = (n: number) => iso(new Date(Date.UTC(2026, 5, 1 + n)))   // 2026-06-01 + n

// ── 1. Toán cơ bản ────────────────────────────────────────────────────────────
console.log('\n[1] median / MAD / z-score')
check('median lẻ', median([3, 1, 2]) === 2)
check('median chẵn', median([1, 2, 3, 4]) === 2.5)
check('MAD kháng nhiễu (1 outlier không phá spread)', madSpread([10, 10, 11, 9, 10, 100], 10) < 5)
check('Theil–Sen slope chuỗi tăng đều +1/ngày', Math.abs((theilSenSlope([1, 2, 3, 4, 5, 6]) ?? 0) - 1) < 1e-9)
check('Theil–Sen kháng outlier', Math.abs((theilSenSlope([1, 2, 3, 100, 5, 6]) ?? 0) - 1) < 0.5)

// ── 2. Đột biến CPC 1 ngày ───────────────────────────────────────────────────
console.log('\n[2] Đột biến trong ngày (z-score, nền 28 ngày)')
const mkStats = (n: number, mut?: (p: DailyStatPoint, i: number) => void): DailyStatPoint[] =>
  Array.from({ length: n }, (_, i) => {
    const p: DailyStatPoint = {
      date: dayN(i), spend: 20, revenue_screen: 30, clicks: 40, impressions: 2000,
      cpc: 0.5, ctr: 2, roi: 50, is_lost_budget: 0.05, mature: true,
    }
    mut?.(p, i)
    return p
  })

{
  // 29 ngày phẳng CPC 0.5, ngày cuối vọt 1.0 (+100%)
  const stats = mkStats(29, (p, i) => { if (i === 28) { p.cpc = 1.0; p.spend = 40 } })
  const found = detectDailyAnomalies(stats, th)
  check('bắt được CPC tăng vọt', found.some(f => f.metric === 'cpc' && f.direction === 'up'), found.map(f => f.metric))
  check('CPC vọt +100% = nghiêm trọng', found.find(f => f.metric === 'cpc')?.severity === 'high')
}
{
  // chuỗi phẳng không có gì bất thường → không báo
  const found = detectDailyAnomalies(mkStats(29), th)
  check('chuỗi phẳng → không báo CPC/CTR/revenue', !found.some(f => ['cpc', 'ctr', 'revenue'].includes(f.metric)), found.map(f => f.metric))
}
{
  // doanh thu ngày mature cuối sập về 2 (bình thường 30)
  const stats = mkStats(29, (p, i) => { if (i === 28) p.revenue_screen = 2 })
  const found = detectDailyAnomalies(stats, th)
  check('bắt được doanh thu tụt', found.some(f => f.metric === 'revenue' && f.direction === 'down'))
}
{
  // DOW: chủ nhật luôn thấp (10), ngày thường 30 — CN cuối = 10 KHÔNG được báo tụt.
  // Cần ≥4 chủ nhật trong nền 28 ngày trước ngày đích → dựng 35 ngày, cắt tới CN thứ 5.
  const stats = mkStats(35, p => {
    const wd = new Date(p.date + 'T00:00:00Z').getUTCDay()
    if (wd === 0) p.revenue_screen = 10
  })
  const lastSunIdx = [...stats.keys()].reverse().find(i => new Date(stats[i].date + 'T00:00:00Z').getUTCDay() === 0)!
  const sliced = stats.slice(0, lastSunIdx + 1)
  const found = detectDailyAnomalies(sliced, th)
  check('chủ nhật thấp theo lệ → KHÔNG báo tụt (biết thứ trong tuần)',
    !found.some(f => f.metric === 'revenue' && f.direction === 'down'), found.map(f => f.metric))
}

// ── 3. Xuống dốc từ từ ───────────────────────────────────────────────────────
console.log('\n[3] Trend Theil–Sen (xuống dốc từ từ)')
{
  // CPC bò +0.01/ngày (0.5 → 0.78 sau 28 ngày). Detector đo drift TRONG cửa sổ
  // 21 ngày cuối: 20 ngày × 0.01 = 0.2, so median ~0.67 → ~30% ≥ ngưỡng 20%.
  const stats = mkStats(28, (p, i) => { p.cpc = 0.5 + i * 0.01 })
  const found = detectTrends(stats, th)
  check('bắt được CPC bò dần trong cửa sổ 21 ngày', found.some(f => f.metric === 'cpc_trend'), found.map(f => f.metric))
}
{
  const found = detectTrends(mkStats(28), th)
  check('chuỗi phẳng → không báo trend', found.length === 0, found.map(f => f.metric))
}

// ── 4. Nước / offer hot ──────────────────────────────────────────────────────
console.log('\n[4] Nước/offer hot')
{
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => ({ date: dayN(i), key: 'US', usd: 5 })),
    { date: dayN(10), key: 'US', usd: 30 },                    // gấp 6× → high
    ...Array.from({ length: 10 }, (_, i) => ({ date: dayN(i), key: 'GB', usd: 8 })),
    { date: dayN(10), key: 'GB', usd: 9 },                     // bình thường
    { date: dayN(10), key: 'DE', usd: 15 },                    // nước MỚI ≥ $10 → high
  ]
  const hot = detectHotKeys(rows, th)
  check('US gấp 6× → hot nghiêm trọng', hot.find(h => h.key === 'US')?.severity === 'high', hot)
  check('GB bình thường → không báo', !hot.some(h => h.key === 'GB'))
  check('DE nước mới $15 → hot', hot.find(h => h.key === 'DE')?.isNew === true)
}

// ── 5. Confirm-rate (tiền thực nhận) ─────────────────────────────────────────
console.log('\n[5] Confirm-rate')
{
  const pendingByDate: Record<string, number> = {}
  for (let i = 0; i < 30; i++) pendingByDate[dayN(i)] = 10          // $10/ngày màn hình
  const r = computeConfirmRate({
    confirmed: [
      { date: dayN(10), amount: 90, start: dayN(0), end: dayN(9) },   // kỳ 1: 90/100 = 0.9
      { date: dayN(20), amount: 60, start: dayN(10), end: dayN(19) }, // kỳ 2: 60/100 = 0.6 → tụt 30đpt
    ],
    pendingByDate, maxPeriods: 3,
  })
  check('rate gộp = 150/200 = 0.75', Math.abs((r.rate ?? 0) - 0.75) < 1e-9, r)
  check('kỳ mới tụt 30đpt so kỳ trước', Math.abs((r.latestDropDpt ?? 0) - 30) < 1e-6, r.latestDropDpt)
  const r2 = computeConfirmRate({ confirmed: [{ date: dayN(5), amount: 50, start: null, end: null }], pendingByDate, maxPeriods: 3 })
  check('kỳ không có khung payout → không khớp được (rate null)', r2.rate === null)
}

// ── 6. Chấm outcome đề xuất ──────────────────────────────────────────────────
console.log('\n[6] Feedback loop (chấm outcome sau khi áp dụng)')
{
  const stats: EvalDailyStat[] = Array.from({ length: 20 }, (_, i) => ({
    date: dayN(i), spend: 10, revenue_screen: 12, clicks: 30, impressions: 1500,
    mature: true,
  }))
  // áp dụng ngày 9; sau đó CPC giảm (spend giảm còn 7, clicks giữ) → bid_ceiling won
  for (let i = 10; i < 20; i++) { stats[i].spend = 7 }
  const out = evaluateOutcome({
    spec: RULE_EVAL.bid_ceiling, appliedDate: dayN(9), stats, windowDays: 7, winPct: 10,
  })
  check('CPC giảm 30% sau khi áp → ĐÚNG (won)', out.status === 'done' && out.verdict === 'won', out)

  const outLost = evaluateOutcome({
    spec: RULE_EVAL.bid_ceiling, appliedDate: dayN(9),
    stats: stats.map((s, i) => ({ ...s, spend: i >= 10 ? 15 : 10 })),   // CPC tăng sau khi áp
    windowDays: 7, winPct: 10,
  })
  check('CPC tăng sau khi áp → SAI (lost)', outLost.verdict === 'lost', outLost)

  const outFlat = evaluateOutcome({
    spec: RULE_EVAL.bid_ceiling, appliedDate: dayN(9),
    stats: stats.map(s => ({ ...s, spend: 10 })),
    windowDays: 7, winPct: 10,
  })
  check('không đổi → không rõ (inconclusive)', outFlat.verdict === 'inconclusive', outFlat)

  const outNoData = evaluateOutcome({
    spec: { ...RULE_EVAL.bid_ceiling, minClicks: 500 }, appliedDate: dayN(9), stats, windowDays: 7, winPct: 10,
  })
  check('thiếu click cửa sổ sau → chờ thêm dữ liệu', outNoData.status === 'need_more_data')
  check('cửa sổ chồng nhau phát hiện đúng', windowsOverlap(dayN(0), dayN(7), dayN(5), dayN(12)) && !windowsOverlap(dayN(0), dayN(4), dayN(5), dayN(12)))
}

// ── 7. Phiếu test ────────────────────────────────────────────────────────────
console.log('\n[7] Phiếu test (state machine)')
{
  const draft = synthesizeTicket({
    th, hypothesis: 'test', target: { geo: 'US' },
    sourceMedianDailySpend: 5, control: {},
  })
  check('budget mặc định = min(3×median, trần) = 15', draft.test_budget === 15, draft.test_budget)

  const mkLog = (days: number, f: (d: TicketDay, i: number) => void): TicketDay[] =>
    Array.from({ length: days }, (_, i) => {
      const d: TicketDay = { date: dayN(i), spend: 3, revenue: 5, clicks: 15, roi: 66 }
      f(d, i)
      return d
    })
  const base = { th, maxDays: 10, minClicks: 50, criteria: { threshold: 20, min_revenue: 10 }, stoploss: { max_spend_no_revenue: 15 } }

  const win = evaluateTicket({ ...base, log: mkLog(6, () => {}) })
  check('đủ ngày + click + ROI 66% → THẮNG sớm', win.verdict === 'won', win)

  const stop = evaluateTicket({ ...base, log: mkLog(6, d => { d.spend = 3; d.revenue = 0 }) })
  check('tiêu 18 > 15 mà không ra tiền → stop-loss', stop.verdict === 'stopped', stop)

  const running = evaluateTicket({ ...base, log: mkLog(3, d => { d.revenue = 1; d.spend = 1 }) })
  check('mới 3 ngày, chưa chạm gì → đang chạy', running.verdict === 'running', running)

  const lost = evaluateTicket({ ...base, log: mkLog(10, d => { d.revenue = 3; d.spend = 3; d.clicks = 20 }) })
  check('hết 10 ngày ROI 0% < 20% → THUA', lost.verdict === 'lost', lost)
}

// ── 8. Nghi sự cố network ────────────────────────────────────────────────────
console.log('\n[8] Nghi sự cố network')
check('DT=0 + có click + nền>0 → nghi sự cố', looksLikeOutage({ todayRevenue: 0, baselineRevenueMedian: 20, todayClicks: 50, minClicks: 20 }))
check('DT=0 nhưng cũng không có click → KHÔNG nghi (camp im)', !looksLikeOutage({ todayRevenue: 0, baselineRevenueMedian: 20, todayClicks: 3, minClicks: 20 }))
check('camp mới chưa từng có DT → KHÔNG nghi', !looksLikeOutage({ todayRevenue: 0, baselineRevenueMedian: 0, todayClicks: 50, minClicks: 20 }))

// ── 9. Ngưỡng + score ────────────────────────────────────────────────────────
console.log('\n[9] Ngưỡng cấu hình + điểm xếp hạng')
{
  const merged = mergeThresholds({ TARGET_ROI: 30, LOSS_ROI: -999, RUBBISH: 1 })
  check('override hợp lệ được nhận', merged.TARGET_ROI === 30)
  check('override ngoài khoảng bị kẹp về min', merged.LOSS_ROI === -80, merged.LOSS_ROI)
  check('key rác bị bỏ', !('RUBBISH' in merged))
  const cfg = toOptimizerCfg(merged)
  check('toOptimizerCfg map đúng key CFG', cfg.TARGET_ROI === 30 && cfg.BID_CEILING_RATIO === 0.6)

  check('reliability cold-start = 0.5', ruleReliability(undefined) === 0.5)
  check('reliability 7 won/2 lost ≈ 0.73', Math.abs(ruleReliability({ won: 7, lost: 2, inconclusive: 0, confounded: 0 }) - 8 / 11) < 1e-9)
  check('score roi > engagement cùng impact', suggestionScore(100, 'roi') > suggestionScore(100, 'engagement'))
}

// ── 10. Rule engine nhận cfg override ────────────────────────────────────────
console.log('\n[10] optimizeCampaign với ngưỡng override')
{
  const metrics: CampaignMetric[] = Array.from({ length: 7 }, (_, i) => ({
    campaign_id: 'c1', date: dayN(i), impressions: 1000, clicks: 50, cost: 50,
    conversions: null, conversions_value: null,
    search_impression_share: 0.6, search_budget_lost_is: 0.02, search_rank_lost_is: 0.05,
  }))
  const revenueByDate: Record<string, number> = {}
  const spendByDate: Record<string, number> = {}
  for (let i = 0; i < 7; i++) { revenueByDate[dayN(i)] = 8; spendByDate[dayN(i)] = 50 }
  const input = {
    campaign_id: 'c1', campaignLabel: 'Camp test', project_id: 'p1',
    metrics, revenueByDate, spendByDate,
    totalRevenue: 56, totalCost: 350, totalSpend: 350,
    campStartDate: dayN(-30),   // camp đủ tuổi — không dính launch checklist
  }
  // ROI = (56-350)/350 = -84% → mặc định (LOSS_ROI -20) phải cháy cut_deep_loss
  const def = optimizeCampaign(input)
  check('mặc định: ROI -84% → có đề xuất cắt', def.suggestions.some(s => s.ruleKey === 'cut_deep_loss'))
  // nới LOSS_ROI = -90 → hết cháy
  const loose = optimizeCampaign(input, { LOSS_ROI: -90 })
  check('override LOSS_ROI=-90 → không còn đề xuất cắt', !loose.suggestions.some(s => s.ruleKey === 'cut_deep_loss'))
  check('mọi suggestion đều có ruleKey + dedupeKey', def.suggestions.every(s => s.ruleKey && s.dedupeKey),
    def.suggestions.filter(s => !s.ruleKey).map(s => s.title))
  // 4 rule so-sánh-kỳ cũ đã bị thay bằng anomaly engine — không được xuất hiện lại
  check('không còn rule WoW/CPC-trend cũ', !def.suggestions.some(s => s.title.includes('so kỳ trước')))
}

console.log(`\n═══ Kết quả: ${passed} pass, ${failed} fail ═══`)
if (failed > 0) process.exit(1)
