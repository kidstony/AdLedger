import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { computeCidCost } from '@/lib/costs'
import { optimizeCampaign } from '@/lib/campaign-optimizer'
import { CampaignMetric, RentalGroup } from '@/lib/types'

// GET /api/optimize?project_id=...&from=...&to=...
// Phân tích 1 camp (theo project) và trả gợi ý tối ưu. Dùng service_role +
// kiểm quyền trong code (giống pnl-summary). Doanh thu = affiliate_revenue thật.
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
    .select('project_id, name, cid, google_campaign_id')
    .eq('project_id', project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!project.google_campaign_id) {
    return NextResponse.json({ error: 'Project chưa gắn Google campaign', code: 'NO_CAMPAIGN' }, { status: 400 })
  }
  const campaign_id = project.google_campaign_id

  const [metricsRes, revenueRes, adSpendRes, otherRes, rentalRes] = await Promise.all([
    supabaseAdmin
      .from('campaign_metrics')
      .select('campaign_id, date, impressions, clicks, cost, conversions, conversions_value, search_impression_share, search_budget_lost_is, search_rank_lost_is')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('affiliate_revenue')
      .select('date, type, amount')
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
      .eq('project_id', project_id),

    supabaseAdmin
      .from('rental_groups')
      .select('*, rental_group_cids!inner(cid, project_id)')
      .or(`rental_group_cids.cid.eq.${project.cid},rental_group_cids.project_id.eq.${project_id}`),
  ])

  const metrics = (metricsRes.data ?? []) as CampaignMetric[]
  const revenues = revenueRes.data ?? []
  const adSpends = adSpendRes.data ?? []
  const others = otherRes.data ?? []

  const revenueByDate: Record<string, number> = {}
  let totalRevenue = 0
  for (const r of revenues) {
    if (r.type !== 'confirmed') continue
    const amt = r.amount ?? 0
    revenueByDate[r.date] = (revenueByDate[r.date] ?? 0) + amt
    totalRevenue += amt
  }

  const spendByDate: Record<string, number> = {}
  let totalSpend = 0
  for (const s of adSpends) {
    const amt = s.spend ?? 0
    spendByDate[s.date] = (spendByDate[s.date] ?? 0) + amt
    totalSpend += amt
  }

  const total_other = others.reduce((s, r) => s + (r.amount ?? 0), 0)
  const adSpendByCid = new Map([[project.cid, totalSpend]])
  const rentalGroups = (rentalRes.data ?? []) as unknown as RentalGroup[]
  const total_rental = rentalGroups.reduce(
    (sum, rg) => sum + computeCidCost(project.cid, rg, from, to, adSpendByCid), 0,
  )
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
    hasMetrics: metrics.length > 0,
    ...result,
  })
}
