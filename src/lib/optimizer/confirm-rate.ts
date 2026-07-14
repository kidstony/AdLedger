// ─────────────────────────────────────────────────────────────────────────────
// Tiền thực nhận vs tiền màn hình (confirm-rate) — toán thuần.
//
// Network hiển thị doanh thu "pending" (tiền màn hình) ngay, nhưng đến kỳ thanh
// toán thường trả ÍT HƠN (trừ đơn ảo/không duyệt). Camp tính lãi bằng tiền màn
// hình có thể thực chất lỗ. Module này so từng kỳ thanh toán (confirmed, có
// payout_start_date/payout_end_date) với tổng tiền màn hình CÙNG KỲ → ra hệ số
// "thực trả / màn hình" trượt trên N kỳ gần nhất. Engine nhân hệ số này vào ROI
// (roi_effective) và báo động khi kỳ mới trả thiếu hơn hẳn các kỳ trước.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfirmedPeriod {
  date: string                 // ngày ghi nhận thanh toán
  amount: number               // tiền thực nhận
  start: string | null         // payout_start_date
  end: string | null           // payout_end_date
}

export interface ConfirmPeriodResult {
  date: string
  confirmed: number
  pending: number
  rate: number                 // confirmed / pending (0..~1.x)
}

export interface ConfirmRateResult {
  rate: number | null          // hệ số trượt trên các kỳ khớp được (Σconfirmed / Σpending)
  periods: ConfirmPeriodResult[]   // các kỳ khớp được, mới nhất cuối
  latestDropDpt: number | null // kỳ mới nhất trả thiếu thêm bao nhiêu điểm % so trung bình kỳ trước
}

// pendingByDate = DT màn hình theo ngày (đã delta hóa nếu cumulative).
export function computeConfirmRate(opts: {
  confirmed: ConfirmedPeriod[]
  pendingByDate: Record<string, number>
  maxPeriods: number
}): ConfirmRateResult {
  // Chỉ kỳ có khung ngày payout mới khớp được với tiền màn hình cùng kỳ.
  const usable = opts.confirmed
    .filter(c => c.start && c.end && c.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-opts.maxPeriods)

  const periods: ConfirmPeriodResult[] = []
  for (const c of usable) {
    let pending = 0
    for (const [d, v] of Object.entries(opts.pendingByDate)) {
      if (d >= c.start! && d <= c.end!) pending += v
    }
    if (pending <= 0) continue   // không có tiền màn hình cùng kỳ → không so được
    periods.push({ date: c.date, confirmed: c.amount, pending, rate: c.amount / pending })
  }

  if (!periods.length) return { rate: null, periods: [], latestDropDpt: null }

  const totalConfirmed = periods.reduce((s, p) => s + p.confirmed, 0)
  const totalPending = periods.reduce((s, p) => s + p.pending, 0)
  const rate = totalPending > 0 ? totalConfirmed / totalPending : null

  // Kỳ mới nhất so với trung bình các kỳ trước — tụt nhiều = network đang trả thiếu hơn.
  let latestDropDpt: number | null = null
  if (periods.length >= 2) {
    const latest = periods[periods.length - 1]
    const prev = periods.slice(0, -1)
    const prevAvg = prev.reduce((s, p) => s + p.rate, 0) / prev.length
    latestDropDpt = (prevAvg - latest.rate) * 100
  }

  return { rate, periods, latestDropDpt }
}
