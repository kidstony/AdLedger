import { Thresholds } from './defaults'

// ─────────────────────────────────────────────────────────────────────────────
// Phát hiện đột biến & xu hướng — toán THUẦN (không đụng DB) để test được.
//
// • Đột biến 1 ngày: robust z-score = (giá trị − median) / (MAD × 1.4826) trên
//   nền 28 ngày. Median/MAD kháng nhiễu (1-2 ngày dị thường trong nền không phá
//   baseline như mean/std). Có nhận biết thứ trong tuần cho các metric theo
//   khối lượng (spend/doanh thu/ROI).
// • Xuống dốc từ từ: độ dốc Theil–Sen (median của mọi slope 2 điểm) trên 21
//   ngày — bắt kiểu "giá click nhích 2%/ngày" mà z-score 1 ngày không thấy.
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyStatPoint {
  date: string           // YYYY-MM-DD
  spend: number
  revenue_screen: number
  clicks: number
  impressions: number
  cpc: number | null
  ctr: number | null
  roi: number | null
  is_lost_budget: number | null   // 0..1
  mature: boolean
}

export interface AnomalyFinding {
  metric: string                   // 'cpc'|'ctr'|'spend'|'revenue'|'roi'|'is_lost_budget'|'geo_revenue'|'offer_revenue'|'cpc_trend'|'revenue_trend'|'roi_trend'
  dimension: Record<string, string> | null
  dedupeKey: string
  direction: 'up' | 'down'
  severity: 'warn' | 'high'
  value: number
  baseline: number
  spread: number
  zscore: number | null
  window: Record<string, unknown>  // {date, baseline_days, dow_aware} | {slope, drift_pct, window_days}
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// MAD chuẩn hóa về tương đương độ lệch chuẩn (×1.4826 cho phân phối chuẩn).
export function madSpread(xs: number[], med: number): number {
  if (!xs.length) return 0
  return median(xs.map(x => Math.abs(x - med))) * 1.4826
}

interface BaselineOpts {
  dowAware: boolean       // thử baseline theo thứ trong tuần nếu lệch đủ lớn
  minN: number            // tối thiểu bao nhiêu điểm nền
  floor: number           // spread tối thiểu khi MAD = 0 (chuỗi phẳng)
}

export interface Baseline { median: number; spread: number; dowAware: boolean; n: number }

export function robustBaseline(
  series: { date: string; value: number }[],   // KHÔNG gồm ngày đang xét
  targetDate: string,
  opts: BaselineOpts,
): Baseline | null {
  if (series.length < opts.minN) return null
  const values = series.map(p => p.value)
  const medAll = median(values)
  let med = medAll
  let pool = values
  let dowUsed = false
  if (opts.dowAware) {
    const wd = new Date(targetDate + 'T00:00:00Z').getUTCDay()
    const sameDow = series.filter(p => new Date(p.date + 'T00:00:00Z').getUTCDay() === wd).map(p => p.value)
    if (sameDow.length >= 4) {
      const medDow = median(sameDow)
      // thứ này lệch >25% so với chung → dùng nền theo thứ (vd cuối tuần thấp hẳn)
      if (medAll !== 0 && Math.abs(medDow - medAll) / Math.abs(medAll) > 0.25) {
        med = medDow
        pool = sameDow
        dowUsed = true
      }
    }
  }
  let spread = madSpread(pool, med)
  if (spread === 0) spread = Math.max(0.1 * Math.abs(med), opts.floor)
  return { median: med, spread, dowAware: dowUsed, n: pool.length }
}

export function zOf(value: number, b: Baseline): number {
  return b.spread > 0 ? (value - b.median) / b.spread : 0
}

// Theil–Sen: median của slope mọi cặp điểm — robust với ngày dị thường.
// x = chỉ số ngày (0,1,2...), trả slope đơn vị/ngày. null nếu < 5 điểm.
export function theilSenSlope(values: number[]): number | null {
  const pts = values.map((v, i) => ({ x: i, y: v })).filter(p => Number.isFinite(p.y))
  if (pts.length < 5) return null
  const slopes: number[] = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].x !== pts[i].x) slopes.push((pts[j].y - pts[i].y) / (pts[j].x - pts[i].x))
    }
  }
  return slopes.length ? median(slopes) : null
}

// ─────────────────────────────────────────────────────────────────────────────
// Đột biến 1 ngày trên chuỗi thống kê camp
// ─────────────────────────────────────────────────────────────────────────────

export function detectDailyAnomalies(stats: DailyStatPoint[], th: Thresholds): AnomalyFinding[] {
  const out: AnomalyFinding[] = []
  const sorted = [...stats].sort((a, b) => a.date.localeCompare(b.date))
  if (!sorted.length) return out

  const baselineDays = th.AN_BASELINE_DAYS
  const minN = th.AN_MIN_BASELINE_DAYS

  // Ngày đích: CPC/CTR/spend = ngày mới nhất có dữ liệu; doanh thu/ROI = ngày
  // mature mới nhất (tiền màn hình trễ 1-2 ngày → ngày cuối luôn "hụt giả").
  const lastAny = sorted[sorted.length - 1]
  const matureRows = sorted.filter(p => p.mature)
  const lastMature = matureRows[matureRows.length - 1] ?? null

  const seriesBefore = (rows: DailyStatPoint[], target: string, pick: (p: DailyStatPoint) => number | null) =>
    rows
      .filter(p => p.date < target)
      .slice(-baselineDays)
      .map(p => ({ date: p.date, value: pick(p) }))
      .filter((p): p is { date: string; value: number } => p.value != null && Number.isFinite(p.value))

  const push = (f: Omit<AnomalyFinding, 'dedupeKey'>) => {
    const dimHash = f.dimension ? ':' + Object.values(f.dimension).join('|') : ''
    out.push({ ...f, dedupeKey: `${f.metric}${dimHash}` })
  }

  // ── CPC tăng vọt (same-day) ────────────────────────────────────────────────
  if (lastAny.cpc != null && lastAny.clicks >= th.AN_MIN_CLICKS && lastAny.impressions >= th.MIN_IMPR_FOR_CTR) {
    const base = robustBaseline(seriesBefore(sorted, lastAny.date, p => (p.clicks >= th.AN_MIN_CLICKS ? p.cpc : null)), lastAny.date, { dowAware: false, minN, floor: 0.05 })
    if (base) {
      const z = zOf(lastAny.cpc, base)
      const pctUp = base.median > 0 ? ((lastAny.cpc - base.median) / base.median) * 100 : 0
      if (z >= th.AN_Z_WARN) {
        push({
          metric: 'cpc', dimension: null, direction: 'up',
          severity: z >= th.AN_Z_HIGH || pctUp >= th.AN_CPC_SPIKE_PCT ? 'high' : 'warn',
          value: lastAny.cpc, baseline: base.median, spread: base.spread, zscore: z,
          window: { date: lastAny.date, baseline_days: base.n, dow_aware: base.dowAware, pct: pctUp },
        })
      }
    }
  }

  // ── CTR sập (same-day) ─────────────────────────────────────────────────────
  if (lastAny.ctr != null && lastAny.clicks >= th.AN_MIN_CLICKS && lastAny.impressions >= th.MIN_IMPR_FOR_CTR) {
    const base = robustBaseline(seriesBefore(sorted, lastAny.date, p => (p.impressions >= th.MIN_IMPR_FOR_CTR ? p.ctr : null)), lastAny.date, { dowAware: false, minN, floor: 0.1 })
    if (base) {
      const z = zOf(lastAny.ctr, base)
      const pctDown = base.median > 0 ? ((base.median - lastAny.ctr) / base.median) * 100 : 0
      if (z <= -th.AN_Z_WARN) {
        push({
          metric: 'ctr', dimension: null, direction: 'down',
          severity: z <= -th.AN_Z_HIGH || pctDown >= th.AN_CTR_COLLAPSE_PCT ? 'high' : 'warn',
          value: lastAny.ctr, baseline: base.median, spread: base.spread, zscore: z,
          window: { date: lastAny.date, baseline_days: base.n, dow_aware: base.dowAware, pct: -pctDown },
        })
      }
    }
  }

  // ── Chi phí bùng (same-day, biết thứ trong tuần) ──────────────────────────
  if (lastAny.spend >= th.AN_MIN_SPEND) {
    const base = robustBaseline(seriesBefore(sorted, lastAny.date, p => p.spend), lastAny.date, { dowAware: true, minN, floor: 1 })
    if (base) {
      const z = zOf(lastAny.spend, base)
      if (z >= 3) {
        push({
          metric: 'spend', dimension: null, direction: 'up',
          severity: z >= 4 ? 'high' : 'warn',
          value: lastAny.spend, baseline: base.median, spread: base.spread, zscore: z,
          window: { date: lastAny.date, baseline_days: base.n, dow_aware: base.dowAware },
        })
      }
    }
  }

  // ── Doanh thu tụt/vọt (chỉ ngày MATURE — tiền màn hình trễ 1-2 ngày) ──────
  if (lastMature) {
    const matBefore = seriesBefore(matureRows, lastMature.date, p => p.revenue_screen)
    const base = robustBaseline(matBefore, lastMature.date, { dowAware: true, minN, floor: 1 })
    if (base && base.median >= th.AN_MIN_SPEND) {
      const z = zOf(lastMature.revenue_screen, base)
      if (Math.abs(z) >= th.AN_Z_WARN) {
        push({
          metric: 'revenue', dimension: null, direction: z > 0 ? 'up' : 'down',
          severity: Math.abs(z) >= th.AN_Z_HIGH ? 'high' : 'warn',
          value: lastMature.revenue_screen, baseline: base.median, spread: base.spread, zscore: z,
          window: { date: lastMature.date, baseline_days: base.n, dow_aware: base.dowAware },
        })
      }
    }

    // ── ROI tụt (điểm %, không z — ROI là tỷ lệ) ────────────────────────────
    if (lastMature.roi != null && lastMature.spend >= th.AN_MIN_SPEND) {
      const roiSeries = seriesBefore(matureRows, lastMature.date, p => (p.spend >= th.AN_MIN_SPEND ? p.roi : null))
      if (roiSeries.length >= minN) {
        const med = median(roiSeries.map(p => p.value))
        const drop = med - lastMature.roi
        if (drop >= th.AN_ROI_DROP_WARN) {
          push({
            metric: 'roi', dimension: null, direction: 'down',
            severity: drop >= th.AN_ROI_DROP_HIGH ? 'high' : 'warn',
            value: lastMature.roi, baseline: med, spread: 0, zscore: null,
            window: { date: lastMature.date, baseline_days: roiSeries.length, drop_dpt: drop },
          })
        }
      }
    }
  }

  // ── Mất hiển thị vì hết ngân sách nhảy vọt (same-day, điểm %) ─────────────
  if (lastAny.is_lost_budget != null && lastAny.spend >= th.AN_MIN_SPEND) {
    const isSeries = seriesBefore(sorted, lastAny.date, p => p.is_lost_budget)
    if (isSeries.length >= minN) {
      const med = median(isSeries.map(p => p.value))
      const jump = (lastAny.is_lost_budget - med) * 100
      if (jump >= th.AN_IS_LOST_WARN) {
        push({
          metric: 'is_lost_budget', dimension: null, direction: 'up',
          severity: jump >= th.AN_IS_LOST_WARN * 2 ? 'high' : 'warn',
          value: lastAny.is_lost_budget * 100, baseline: med * 100, spread: 0, zscore: null,
          window: { date: lastAny.date, baseline_days: isSeries.length, jump_dpt: jump },
        })
      }
    }
  }

  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Xuống dốc từ từ — Theil–Sen trên cửa sổ dài
// ─────────────────────────────────────────────────────────────────────────────

export function detectTrends(stats: DailyStatPoint[], th: Thresholds): AnomalyFinding[] {
  const out: AnomalyFinding[] = []
  const mature = stats.filter(p => p.mature).sort((a, b) => a.date.localeCompare(b.date)).slice(-th.TR_WINDOW_DAYS)
  const need = Math.ceil(th.TR_WINDOW_DAYS * 0.7)   // cho phép thiếu vài ngày dữ liệu
  const lastDate = mature[mature.length - 1]?.date

  const drift = (values: (number | null)[]): { slope: number; driftPct: number; med: number } | null => {
    const clean = values.filter((v): v is number => v != null && Number.isFinite(v))
    if (clean.length < need) return null
    const slope = theilSenSlope(clean)
    if (slope == null) return null
    const med = median(clean)
    if (med === 0) return null
    const driftPct = (slope * (clean.length - 1)) / Math.abs(med) * 100
    return { slope, driftPct, med }
  }

  // CPC bò dần lên
  {
    const d = drift(mature.map(p => (p.clicks >= 5 ? p.cpc : null)))
    if (d && d.driftPct >= th.TR_CPC_WARN_PCT) {
      out.push({
        metric: 'cpc_trend', dimension: null, dedupeKey: 'cpc_trend', direction: 'up',
        severity: d.driftPct >= th.TR_CPC_HIGH_PCT ? 'high' : 'warn',
        value: d.driftPct, baseline: d.med, spread: 0, zscore: null,
        window: { date: lastDate, window_days: th.TR_WINDOW_DAYS, slope_per_day: d.slope, drift_pct: d.driftPct },
      })
    }
  }
  // Doanh thu nguội dần
  {
    const d = drift(mature.map(p => p.revenue_screen))
    if (d && d.med >= th.AN_MIN_SPEND && -d.driftPct >= th.TR_REV_WARN_PCT) {
      out.push({
        metric: 'revenue_trend', dimension: null, dedupeKey: 'revenue_trend', direction: 'down',
        severity: -d.driftPct >= th.TR_REV_HIGH_PCT ? 'high' : 'warn',
        value: d.driftPct, baseline: d.med, spread: 0, zscore: null,
        window: { date: lastDate, window_days: th.TR_WINDOW_DAYS, slope_per_day: d.slope, drift_pct: d.driftPct },
      })
    }
  }
  // ROI trượt dần (đơn vị điểm %, không chia median)
  {
    const clean = mature.map(p => (p.spend >= th.AN_MIN_SPEND ? p.roi : null)).filter((v): v is number => v != null)
    if (clean.length >= need) {
      const slope = theilSenSlope(clean)
      if (slope != null) {
        const driftDpt = slope * (clean.length - 1)
        if (-driftDpt >= th.TR_ROI_WARN_DPT) {
          out.push({
            metric: 'roi_trend', dimension: null, dedupeKey: 'roi_trend', direction: 'down',
            severity: -driftDpt >= th.TR_ROI_WARN_DPT * 2 ? 'high' : 'warn',
            value: driftDpt, baseline: median(clean), spread: 0, zscore: null,
            window: { date: lastDate, window_days: th.TR_WINDOW_DAYS, slope_per_day: slope, drift_dpt: driftDpt },
          })
        }
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Nước / offer HOT — đột biến cơ hội (→ đề xuất phiếu test)
// rows = doanh thu USD theo (ngày × key) đã lọc snapshot; key = mã nước / tên offer.
// ─────────────────────────────────────────────────────────────────────────────

export interface HotFinding {
  key: string          // 'US' | offer name
  todayUsd: number
  baselineUsd: number  // median các ngày trước có mặt key này (0 nếu key mới)
  mult: number | null  // todayUsd / baseline; null nếu key mới xuất hiện
  isNew: boolean
  severity: 'warn' | 'high'
  date: string
}

export function detectHotKeys(
  rows: { date: string; key: string; usd: number }[],
  th: Thresholds,
): HotFinding[] {
  if (!rows.length) return []
  const dates = [...new Set(rows.map(r => r.date))].sort()
  const today = dates[dates.length - 1]
  if (!today || dates.length < 2) return []   // cần ít nhất 1 ngày nền

  const byKey = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const m = byKey.get(r.key) ?? new Map<string, number>()
    m.set(r.date, (m.get(r.date) ?? 0) + r.usd)
    byKey.set(r.key, m)
  }

  const out: HotFinding[] = []
  for (const [key, m] of byKey) {
    const todayUsd = m.get(today) ?? 0
    if (todayUsd < th.AN_GEO_HOT_MIN_USD) continue
    const prior = [...m.entries()].filter(([d]) => d < today).map(([, v]) => v)
    if (!prior.length) {
      // key MỚI xuất hiện — chỉ đáng nói khi đủ lớn
      if (todayUsd >= th.AN_GEO_HOT_HIGH_USD) {
        out.push({ key, todayUsd, baselineUsd: 0, mult: null, isNew: true, severity: 'high', date: today })
      }
      continue
    }
    const base = median(prior)
    if (base <= 0) continue
    const mult = todayUsd / base
    if (mult >= th.AN_GEO_HOT_MULT) {
      out.push({
        key, todayUsd, baselineUsd: base, mult, isNew: false,
        severity: mult >= th.AN_GEO_HOT_MULT_HIGH && todayUsd >= th.AN_GEO_HOT_HIGH_USD ? 'high' : 'warn',
        date: today,
      })
    }
  }
  return out.sort((a, b) => b.todayUsd - a.todayUsd)
}

// ─────────────────────────────────────────────────────────────────────────────
// Nghi sự cố network: doanh thu hôm nay = 0 trên MỌI camp của account trong khi
// vẫn có click và nền doanh thu > 0 → khả năng chết link/đăng xuất, KHÔNG phải
// camp tệ. Trả true = ức chế các đề xuất cut/loại-geo dựa doanh thu.
// ─────────────────────────────────────────────────────────────────────────────

export function looksLikeOutage(opts: {
  todayRevenue: number
  baselineRevenueMedian: number
  todayClicks: number
  minClicks: number
}): boolean {
  return opts.todayRevenue === 0
    && opts.baselineRevenueMedian > 0
    && opts.todayClicks >= opts.minClicks
}
