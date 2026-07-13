// Lớp join doanh thu breakdown (revenue_breakdown — Engine thu từ network affiliate)
// với chi phí Google Ads theo segment (segment_metrics) cho mục Tối Ưu Camp.
// Chuyển value-space: country ISO alpha-2 → geo criterion ID, device → MOBILE/DESKTOP/
// TABLET, hour → '0'..'23' — để khớp thẳng vào SegmentAgg của campaign-optimizer.

import { geoIdByAlpha2 } from './geo-targets'
import type { BreakdownMeta, SegmentRevenueAgg } from './types'

// Dòng revenue_breakdown đọc từ DB (đã lọc project + khoảng ngày).
export interface BreakdownRow {
  date: string
  country: string          // ISO alpha-2 hoặc ''
  device: string           // mobile|desktop|tablet|other|''
  hour: number             // 0..23 hoặc -1
  sub_id: string
  campaign_id: string | null
  revenue: number          // tiền tệ nguồn
  currency: string
  revenue_usd: number | null
  conversions: number | null
  revenue_type: 'pending' | 'confirmed'
  network_id: string
  report: string           // tên report (phân biệt snapshot window_end vs per-conversion)
}

// Bỏ trùng SNAPSHOT: report date_mode='window_end' ghi 1 dòng tổng-cả-kỳ mỗi lần sync → cộng
// nhiều ngày = chồng kỳ. Chỉ giữ ngày MỚI NHẤT của mỗi (network_id, report) snapshot; report
// per-conversion (mỗi dòng = 1 chuyển đổi ngày thật) giữ MỌI ngày.
// snapshotKeys = tập "network_id|report" có date_mode='window_end' (lấy từ engine_network_configs).
export function dedupeSnapshotRows(rows: BreakdownRow[], snapshotKeys: Set<string>): BreakdownRow[] {
  if (snapshotKeys.size === 0) return rows
  const latest = new Map<string, string>()   // network|report → ngày mới nhất
  for (const r of rows) {
    const key = `${r.network_id}|${r.report}`
    if (!snapshotKeys.has(key)) continue
    const cur = latest.get(key)
    if (!cur || r.date > cur) latest.set(key, r.date)
  }
  return rows.filter(r => {
    const key = `${r.network_id}|${r.report}`
    return snapshotKeys.has(key) ? r.date === latest.get(key) : true
  })
}

// Dựng tập "network_id|report" của các report breakdown snapshot (date_mode='window_end')
// từ engine_network_configs — dùng cho dedupeSnapshotRows.
export function snapshotKeysFromConfigs(
  configs: { network_id: string; config: unknown }[],
): Set<string> {
  const keys = new Set<string>()
  for (const c of configs) {
    const reports = (c.config as { reports?: { kind?: string; name?: string; date_mode?: string }[] } | null)?.reports
    if (!Array.isArray(reports)) continue
    for (const r of reports) {
      if (r?.kind === 'breakdown' && r.date_mode === 'window_end' && r.name) {
        keys.add(`${c.network_id}|${r.name}`)
      }
    }
  }
  return keys
}

// USD của 1 dòng: revenue_usd đã đóng băng lúc engine ghi; thiếu (tỷ giá chết) thì chỉ
// nhận nếu nguồn vốn là USD — không trộn tiền tệ khác vào tổng.
export function usdOf(r: Pick<BreakdownRow, 'revenue' | 'revenue_usd' | 'currency'>): number | null {
  if (r.revenue_usd != null) return r.revenue_usd
  return r.currency === 'USD' ? r.revenue : null
}

// Cơ sở phân tích = pending (khớp DT Màn hình); network chỉ có confirmed thì dùng confirmed.
export function pickRevenueType(rows: BreakdownRow[]): 'pending' | 'confirmed' {
  return rows.some(r => r.revenue_type === 'pending') ? 'pending' : 'confirmed'
}

// Attribution: khi ≥80% doanh thu (theo USD) có sub_id → tin sub-id, lọc đúng những dòng
// gắn campaign này (chính xác cả khi nhiều camp chung 1 project). Chưa đủ phủ → giữ
// toàn bộ dòng của project (hành vi project-level).
const SUB_ID_TRUST = 0.8
export function filterForAttribution(
  rows: BreakdownRow[],
  campaignId: string,
): { rows: BreakdownRow[]; attribution: 'campaign' | 'project' } {
  let total = 0, withSub = 0
  for (const r of rows) {
    const usd = usdOf(r)
    if (usd == null) continue
    total += usd
    if (r.sub_id) withSub += usd
  }
  if (total > 0 && withSub / total >= SUB_ID_TRUST) {
    return { rows: rows.filter(r => r.campaign_id === campaignId), attribution: 'campaign' }
  }
  return { rows, attribution: 'project' }
}

// Gộp doanh thu theo segment trong value-space Google Ads. Chỉ tính loại revenue_type
// được chọn (pending ưu tiên) để không cộng trùng pending + confirmed của cùng ngày.
export function toSegmentRevenue(rows: BreakdownRow[]): SegmentRevenueAgg[] {
  const type = pickRevenueType(rows)
  const m = new Map<string, SegmentRevenueAgg>()
  const add = (segment_type: SegmentRevenueAgg['segment_type'], segment_value: string, revenue: number, conversions: number | null) => {
    const key = `${segment_type}|${segment_value}`
    const e = m.get(key) ?? { segment_type, segment_value, revenue: 0, conversions: null }
    e.revenue += revenue
    if (conversions != null) e.conversions = (e.conversions ?? 0) + conversions
    m.set(key, e)
  }
  for (const r of rows) {
    if (r.revenue_type !== type) continue
    const usd = usdOf(r)
    if (usd == null) continue
    if (r.country) {
      const geoId = geoIdByAlpha2(r.country)
      if (geoId) add('geo', geoId, usd, r.conversions)
    }
    if (r.device && r.device !== 'other') add('device', r.device.toUpperCase(), usd, r.conversions)
    if (r.hour >= 0) add('hour', String(r.hour), usd, r.conversions)
  }
  return [...m.values()]
}

// Meta chất lượng dữ liệu breakdown — gate tin cậy (coverage) + tín hiệu sub-id.
export function breakdownMeta(
  rows: BreakdownRow[],
  totalScreenRevenue: number,
  attribution: 'campaign' | 'project',
): BreakdownMeta {
  const type = pickRevenueType(rows)
  // total THẬT = MAX theo chiều (geo/device/giờ/all), KHÔNG cộng chéo: mỗi report đo CÙNG khoản
  // doanh thu theo 1 chiều (geo-report, device-report, per-conv giờ) → cộng lại là đếm trùng.
  let geoUsd = 0, deviceUsd = 0, hourUsd = 0, allUsd = 0, withSub = 0
  let hasGeo = false, hasDevice = false, hasHour = false
  let geoOtherUsd = 0   // doanh thu dòng "khác"/uncategorized (country=''&device=''&hour<0) = server cap top-N
  for (const r of rows) {
    if (r.revenue_type !== type) continue
    const usd = usdOf(r)
    if (usd == null) continue
    allUsd += usd
    if (r.sub_id) withSub += usd
    if (r.country) { geoUsd += usd; hasGeo = true }
    else if (!r.device && r.hour < 0 && usd > 0) geoOtherUsd += usd
    if (r.device) { deviceUsd += usd; hasDevice = true }
    if (r.hour >= 0) { hourUsd += usd; hasHour = true }
  }
  // Geo bị cap top-N: có nước cụ thể (hasGeo) VÀ tồn tại chunk "khác" đáng kể → nước vắng ≠ 0đ.
  const geoCapped = hasGeo && geoOtherUsd > Math.max(0.5, geoUsd * 0.02)
  // total = max chiều; nếu không dòng nào mang chiều (chỉ có revenue trơn) thì dùng tổng thô.
  const dimMax = Math.max(geoUsd, deviceUsd, hourUsd)
  const total = dimMax > 0 ? dimMax : allUsd
  // Doanh thu breakdown VƯỢT kỳ: total (vd snapshot window_end tổng-cả-kỳ) lớn hơn hẳn DT Màn hình
  // của khoảng ngày → doanh thu KHÔNG cùng kỳ với chi phí → ROI theo segment không đáng tin.
  // (coverageRatio bị cap 1.0 nên che mất chuyện vượt kỳ; cờ này bắt nó.)
  const revenueOverRange = totalScreenRevenue > 0 && total > totalScreenRevenue * 1.2
  return {
    coverageRatio: totalScreenRevenue > 0 ? Math.min(1, total / totalScreenRevenue) : (total > 0 ? 1 : 0),
    hasGeo,
    hasDevice,
    hasHour,
    subIdCoverage: total > 0 ? withSub / total : 0,
    attribution,
    geoCapped,
    revenueOverRange,
  }
}
