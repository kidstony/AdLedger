import { Project, AffiliateRevenue, PnlDaily } from './types'

interface MockAdSpend { cid: string; date: string; cost: number }

// Deterministic pseudo-random to keep data stable across reloads
function seededRand(seed: number): number {
  const x = Math.sin(seed + 1) * 10000
  return x - Math.floor(x)
}

const MCC_IDS = Array.from({ length: 10 }, (_, i) => `mcc${String(i + 1).padStart(3, '0')}`)

export const MOCK_PROJECTS: Project[] = Array.from({ length: 100 }, (_, i) => {
  const idx = i + 1
  const mccIdx = Math.floor(i / 10)
  const cidSeed = idx * 137 + 42
  const cid = String(
    Math.floor(seededRand(cidSeed) * 9_000_000_000) + 1_000_000_000
  )

  const names = [
    'Thời trang nữ', 'Sức khỏe & Làm đẹp', 'Đồ gia dụng', 'Thể thao',
    'Điện tử', 'Mẹ & Bé', 'Thực phẩm', 'Du lịch', 'Tài chính', 'Giáo dục',
  ]
  const suffix = names[i % names.length]

  return {
    project_id: `proj${String(idx).padStart(3, '0')}`,
    cid,
    name: `${suffix} ${String(idx).padStart(3, '0')}`,
    mcc_id: MCC_IDS[mccIdx],
  }
})

// Generate last 30 days of dates
function getLast30Days(): string[] {
  const dates: string[] = []
  const today = new Date('2026-06-21')
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().split('T')[0])
  }
  return dates
}

export const DATES = getLast30Days()

export const MOCK_AD_SPEND: MockAdSpend[] = []
export const MOCK_REVENUE: AffiliateRevenue[] = []

MOCK_PROJECTS.forEach((project, pi) => {
  DATES.forEach((date, di) => {
    const spendSeed = pi * 1000 + di * 7 + 3
    const spend = Math.round((seededRand(spendSeed) * 4900 + 100) * 100) / 100

    MOCK_AD_SPEND.push({ cid: project.cid, date, cost: spend })

    // ~30% projects có lỗ (revenue thấp hơn spend)
    const isLossProject = (pi * 31 + 17) % 100 < 30
    const revSeed = pi * 1000 + di * 11 + 9

    // Một số ngày không có revenue (chưa nhập) - ~20% ngày
    const noRevenueSeed = pi * 500 + di * 13 + 5
    if (seededRand(noRevenueSeed) > 0.2) {
      const revenueMultiplier = isLossProject
        ? 0.4 + seededRand(revSeed) * 0.45   // 40–85% → lỗ
        : 1.0 + seededRand(revSeed) * 1.2    // 100–220% → lãi

      const revenue = Math.round(spend * revenueMultiplier * 100) / 100
      MOCK_REVENUE.push({ project_id: project.project_id, date, revenue, screen_revenue: 0 })
    }
  })
})

export function buildPnlDaily(): PnlDaily[] {
  const spendMap = new Map<string, number>()
  const revenueMap = new Map<string, number>()
  const projectByCid = new Map<string, Project>()
  MOCK_PROJECTS.forEach(p => projectByCid.set(p.cid, p))

  MOCK_AD_SPEND.forEach(s => {
    const key = `${s.cid}__${s.date}`
    spendMap.set(key, (spendMap.get(key) ?? 0) + s.cost)
  })

  MOCK_REVENUE.forEach(r => {
    const key = `${r.project_id}__${r.date}`
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + r.revenue)
  })

  const rows: PnlDaily[] = []
  MOCK_PROJECTS.forEach(project => {
    DATES.forEach(date => {
      const spend = spendMap.get(`${project.cid}__${date}`) ?? 0
      const revenue = revenueMap.get(`${project.project_id}__${date}`) ?? 0
      const profit = revenue - spend
      const roi = spend > 0 ? (profit / spend) * 100 : 0
      rows.push({
        project_id: project.project_id,
        cid: project.cid,
        name: project.name,
        date,
        spend,
        revenue,
        profit,
        roi,
      })
    })
  })

  return rows
}

export const MOCK_PNL_DAILY = buildPnlDaily()
