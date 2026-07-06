import { AdDevice, AttributionType, Project } from './types'

// Quy chi phí QC (ad_spend) của một campaign về từng ref-link project (sub-project)
// dùng chung 1 CID/campaign. Dùng cho cả dashboard (usePnlData) lẫn trang chi tiết.

export interface SpendRow {
  campaign_id: string
  date: string
  spend: number
  device: AdDevice
  ad_group_id: string
}

export type AttrProject = Pick<
  Project,
  | 'project_id'
  | 'attribution_type'
  | 'attribution_device'
  | 'attribution_ad_group_id'
  | 'attribution_from'
  | 'attribution_to'
  | 'attribution_weight'
>

const typeOf = (p: AttrProject): AttributionType => p.attribution_type ?? 'campaign'

// Chọn nhóm sibling "khớp" một row spend, theo tier cụ thể nhất có ứng viên:
//   ad_group > device > date_window > default (campaign | manual_pct).
// Nếu không tier nào khớp (vd row.date ngoài mọi date_window) → trả về [] để
// caller fallback về toàn bộ sibling, đảm bảo không mất chi phí (tổng bất biến).
function matchTier(row: SpendRow, siblings: AttrProject[]): AttrProject[] {
  const adGroup = siblings.filter(
    p => typeOf(p) === 'ad_group' && p.attribution_ad_group_id === row.ad_group_id,
  )
  if (adGroup.length) return adGroup

  const device = siblings.filter(
    p => typeOf(p) === 'device' && p.attribution_device === row.device,
  )
  if (device.length) return device

  const window = siblings.filter(
    p =>
      typeOf(p) === 'date_window' &&
      (!p.attribution_from || row.date >= p.attribution_from) &&
      (!p.attribution_to || row.date <= p.attribution_to),
  )
  if (window.length) return window

  return siblings.filter(p => {
    const t = typeOf(p)
    return t === 'campaign' || t === 'manual_pct'
  })
}

// Chia một khoản chi phí cho nhiều sibling khi không tách được ở nguồn.
// Ưu tiên trọng số % thủ công (attribution_weight); nếu không có thì theo
// doanh thu (revenueByProject, nên truyền screen_revenue để có tín hiệu sớm);
// nếu tổng doanh thu = 0 thì chia đều.
export function splitSpend(
  total: number,
  siblings: AttrProject[],
  revenueByProject: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  if (!siblings.length) return out
  if (siblings.length === 1) {
    out.set(siblings[0].project_id, total)
    return out
  }

  const hasWeights = siblings.some(p => (p.attribution_weight ?? 0) > 0)
  let basis = hasWeights
    ? siblings.map(p => Math.max(0, p.attribution_weight ?? 0))
    : siblings.map(p => Math.max(0, revenueByProject.get(p.project_id) ?? 0))
  let sum = basis.reduce((a, b) => a + b, 0)
  if (sum <= 0) {
    basis = siblings.map(() => 1) // fallback chia đều
    sum = siblings.length
  }
  siblings.forEach((p, i) => out.set(p.project_id, (total * basis[i]) / sum))
  return out
}

// Phân bổ một row spend về (các) project. Trả về Map<project_id, phần_spend>.
// Tổng các phần luôn == row.spend (không mất chi phí) khi siblings không rỗng.
export function allocateSpendRow(
  row: SpendRow,
  siblings: AttrProject[],
  revenueByProject: Map<string, number>,
): Map<string, number> {
  if (!siblings.length) return new Map()
  const chosen = matchTier(row, siblings)
  const target = chosen.length ? chosen : siblings
  return splitSpend(row.spend, target, revenueByProject)
}

// Gom project theo google_campaign_id (một campaign có thể có nhiều ref-link project).
export function buildSiblingsByCampaign(projects: Project[]): Map<string, Project[]> {
  const map = new Map<string, Project[]>()
  projects.forEach(p => {
    if (!p.google_campaign_id) return
    const arr = map.get(p.google_campaign_id) ?? []
    arr.push(p)
    map.set(p.google_campaign_id, arr)
  })
  return map
}
