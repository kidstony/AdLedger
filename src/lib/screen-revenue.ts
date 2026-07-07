// Tính DT Màn hình (screen revenue) cho MỘT project từ các dòng affiliate_revenue
// type='pending'. Nhân bản logic delta trong usePnlData.ts (nguồn tham chiếu) để
// dùng ở server (api/optimize) — không phân tán công thức.
//
//  • daily      : `amount` là DT từng ngày → cộng thẳng.
//  • cumulative : `amount` là số luỹ kế → delta ngày = amount − prev; prev khởi từ
//    baselinePrev (dòng pending cuối trước khoảng ngày; = 0 nếu cycle_end/không có);
//    sau ngày cycle_end → reset prev = 0 cho ngày kế (platform reset sau thanh toán).

export interface PendingRow {
  date: string
  amount: number
  cycle_end?: boolean | null
}

export function computeScreenRevenue(
  pendingRows: PendingRow[],
  isCumulative: boolean,
  baselinePrev = 0,
): { byDate: Record<string, number>; total: number } {
  const byDate: Record<string, number> = {}
  let total = 0

  if (!isCumulative) {
    for (const r of pendingRows) {
      byDate[r.date] = (byDate[r.date] ?? 0) + r.amount
      total += r.amount
    }
    return { byDate, total }
  }

  const sorted = [...pendingRows].sort((a, b) => a.date.localeCompare(b.date))
  let prev = baselinePrev
  for (const r of sorted) {
    const delta = r.amount - prev
    byDate[r.date] = (byDate[r.date] ?? 0) + delta
    total += delta
    prev = r.cycle_end ? 0 : r.amount
  }
  return { byDate, total }
}
