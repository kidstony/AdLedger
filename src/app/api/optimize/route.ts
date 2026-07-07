import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { computeCidCost } from '@/lib/costs'
import { optimizeCampaign } from '@/lib/campaign-optimizer'
import { computeScreenRevenue, PendingRow } from '@/lib/screen-revenue'
import { splitSpend, AttrProject } from '@/lib/attribution'
import { CampaignMetric, RentalGroup } from '@/lib/types'

// GET /api/optimize?project_id=...&from=...&to=...
// Phân tích 1 camp (theo project) và trả gợi ý tối ưu. Dùng service_role +
// kiểm quyền trong code (giống pnl-summary). Cơ sở phân tích = DT Màn hình
// (affiliate_revenue type='pending') vì có sớm; DT Thực (confirmed) chỉ để tham chiếu.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  const from = url.searchParams.get('from') ?? '2000-01-01'
  const to   = url.searchParams.get('to')   ?? new Date().toISOString().split('T')[0]

  // Kiểm quyền theo role (mirror pnl-summary).
  if (caller.role === 'member') {
    const { data: share } = await supabaseAdmin
      .from('project_shares').select('id')
      .eq('project_id', project_id).eq('user_id', caller.user_id).maybeSingle()
    if (!share) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (caller.role === 'manager') {
    const { data: proj } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (proj?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, cid, google_campaign_id, screen_revenue_type')
    .eq('project_id', project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const isCumulative = project.screen_revenue_type === 'cumulative'

  if (!project.google_campaign_id) {
    return NextResponse.json({ error: 'Project chưa gắn Google campaign', code: 'NO_CAMPAIGN' }, { status: 400 })
  }
  const campaign_id = project.google_campaign_id

  const [metricsRes, revenueRes, adSpendRes, otherRes] = await Promise.all([
    supabaseAdmin
      .from('campaign_metrics')
      .select('campaign_id, date, impressions, clicks, cost, conversions, conversions_value, search_impression_share, search_budget_lost_is, search_rank_lost_is')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('affiliate_revenue')
      .select('date, type, amount, cycle_end')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('ad_spend')
      .select('date, spend')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('other_costs')
      .select('amount')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to),
  ])

  const metrics = (metricsRes.data ?? []) as CampaignMetric[]
  const revenues = revenueRes.data ?? []
  const adSpends = adSpendRes.data ?? []
  const others = otherRes.data ?? []

  // Cơ sở phân tích = DT Màn hình (pending). Với project cumulative, cần baseline
  // = dòng pending cuối trước khoảng ngày (mirror usePnlData).
  let baselinePrev = 0
  if (isCumulative) {
    const { data: prev } = await supabaseAdmin
      .from('affiliate_revenue')
      .select('amount, cycle_end')
      .eq('project_id', project_id).eq('type', 'pending')
      .lt('date', from)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    baselinePrev = prev ? (prev.cycle_end ? 0 : (prev.amount ?? 0)) : 0
  }

  const pendingRows: PendingRow[] = revenues
    .filter(r => r.type === 'pending')
    .map(r => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
  const { byDate: revenueByDate, total: totalRevenue } =
    computeScreenRevenue(pendingRows, isCumulative, baselinePrev)

  // DT Thực (confirmed) — chỉ để tham chiếu ở UI, không dùng để ra quyết định.
  const confirmedRevenue = revenues
    .filter(r => r.type === 'confirmed')
    .reduce((s, r) => s + (r.amount ?? 0), 0)

  const spendByDate: Record<string, number> = {}
  let totalSpend = 0
  for (const s of adSpends) {
    const amt = s.spend ?? 0
    spendByDate[s.date] = (spendByDate[s.date] ?? 0) + amt
    totalSpend += amt
  }

  const total_other = others.reduce((s, r) => s + (r.amount ?? 0), 0)

  // ── Chi phí Thuê TK (rental) ──────────────────────────────────────────────
  // Fetch TẤT CẢ rental group của org rồi match trong JS (mirror usePnlData) —
  // KHÔNG dùng .or trên cột embedded (không match được → trước đây bỏ sót rental).
  const [cidProjectsRes, rentalRes] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('project_id, google_campaign_id, screen_revenue_type, attribution_weight')
      .eq('cid', project.cid),
    (() => {
      let q = supabaseAdmin.from('rental_groups').select('*, rental_group_cids(*)')
      if (caller.organization_id) q = q.eq('organization_id', caller.organization_id)
      return q
    })(),
  ])
  const cidProjects = cidProjectsRes.data?.length
    ? cidProjectsRes.data
    : [{ project_id, google_campaign_id: campaign_id, screen_revenue_type: project.screen_revenue_type, attribution_weight: null }]
  const rentalGroups = (rentalRes.data ?? []) as unknown as RentalGroup[]

  // Base % rental = tổng ad spend theo CID (mọi campaign của các project chung cid).
  let cidSpend = totalSpend
  const cidCampaignIds = [...new Set(cidProjects.map(p => p.google_campaign_id).filter(Boolean))] as string[]
  const needsCidSpend = !(cidCampaignIds.length <= 1 && cidCampaignIds[0] === campaign_id)
  if (needsCidSpend && cidCampaignIds.length) {
    const { data: cidSpendRows } = await supabaseAdmin
      .from('ad_spend').select('spend').in('campaign_id', cidCampaignIds).gte('date', from).lte('date', to)
    cidSpend = (cidSpendRows ?? []).reduce((s, r) => s + (r.spend ?? 0), 0)
  }
  const adSpendByCid = new Map([[project.cid, cidSpend]])

  // Cơ sở chia (DT Màn hình) cho các project chung cid — chỉ cần khi >1 project.
  const revenueBasis = new Map<string, number>([[project_id, totalRevenue]])
  if (cidProjects.length > 1) {
    const otherIds = cidProjects.map(p => p.project_id).filter(id => id !== project_id)
    const { data: sibPending } = await supabaseAdmin
      .from('affiliate_revenue').select('project_id, date, amount, cycle_end')
      .in('project_id', otherIds).eq('type', 'pending').gte('date', from).lte('date', to)
    const byPid = new Map<string, PendingRow[]>()
    for (const r of sibPending ?? []) {
      const arr = byPid.get(r.project_id) ?? []
      arr.push({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end })
      byPid.set(r.project_id, arr)
    }
    for (const p of cidProjects) {
      if (p.project_id === project_id) continue
      const { total } = computeScreenRevenue(byPid.get(p.project_id) ?? [], p.screen_revenue_type === 'cumulative', 0)
      revenueBasis.set(p.project_id, total)
    }
  }

  let total_rental = 0
  for (const rg of rentalGroups) {
    for (const ce of rg.rental_group_cids ?? []) {
      // Entry gán cứng cho 1 project: chỉ tính nếu là project này.
      if (ce.project_id) {
        if (ce.project_id === project_id) total_rental += computeCidCost(ce.cid, rg, from, to, adSpendByCid)
        continue
      }
      // Entry theo CID: áp cho cid này; chia giữa các project chung cid nếu >1.
      if (ce.cid !== project.cid) continue
      const cost = computeCidCost(ce.cid, rg, from, to, adSpendByCid)
      if (!cost) continue
      if (cidProjects.length > 1) {
        const sibs: AttrProject[] = cidProjects.map(p => ({ project_id: p.project_id, attribution_weight: p.attribution_weight ?? null }))
        total_rental += splitSpend(cost, sibs, revenueBasis).get(project_id) ?? 0
      } else {
        total_rental += cost
      }
    }
  }

  const totalCost = totalSpend + total_rental + total_other

  const result = optimizeCampaign({
    campaign_id,
    campaignLabel: project.name,
    project_id,
    metrics,
    revenueByDate,
    spendByDate,
    totalRevenue,
    totalCost,
    totalSpend,
  })

  return NextResponse.json({
    project: { project_id, name: project.name, cid: project.cid, campaign_id },
    range: { from, to },
    cost: { spend: totalSpend, rental: total_rental, other: total_other, total: totalCost },
    revenue: { screen: totalRevenue, confirmed: confirmedRevenue },
    hasMetrics: metrics.length > 0,
    ...result,
  })
}
