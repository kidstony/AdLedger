import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile, getOrgTeamIds } from '@/lib/require-role'
import { optimizeCampaign } from '@/lib/campaign-optimizer'
import { computeScreenRevenue, PendingRow } from '@/lib/screen-revenue'
import { CampaignMetric } from '@/lib/types'

// GET /api/optimize/overview?from&to
// Bảng tổng quan: tính health + gợi ý (rút gọn) cho MỌI camp caller thấy, xếp theo
// mức cấp thiết. Rút gọn để nhẹ: cost ≈ ad spend (bỏ rental/other), không keyword/
// segment/prev/settings — đủ cho triage; xem 1 camp chi tiết ở /api/optimize.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? '2000-01-01'
  const to = url.searchParams.get('to') ?? new Date().toISOString().split('T')[0]

  // Các project caller được xem (theo role).
  let projQuery = supabaseAdmin
    .from('projects')
    .select('project_id, name, cid, google_campaign_id, screen_revenue_type')
    .not('google_campaign_id', 'is', null)

  if (caller.role === 'super_admin') {
    if (caller.organization_id) {
      const teamIds = await getOrgTeamIds(caller.organization_id)
      projQuery = teamIds.length ? projQuery.in('team_id', teamIds) : projQuery.eq('project_id', '__none__')
    }
  } else if (caller.role === 'manager') {
    projQuery = caller.team_id ? projQuery.eq('team_id', caller.team_id) : projQuery.eq('project_id', '__none__')
  } else {
    const { data: shares } = await supabaseAdmin
      .from('project_shares').select('project_id').eq('user_id', caller.user_id)
    const ids = (shares ?? []).map(s => s.project_id)
    projQuery = ids.length ? projQuery.in('project_id', ids) : projQuery.eq('project_id', '__none__')
  }

  const { data: projects } = await projQuery
  if (!projects?.length) return NextResponse.json({ range: { from, to }, rows: [] })

  const campaignIds = [...new Set(projects.map(p => p.google_campaign_id).filter(Boolean))] as string[]
  const projectIds = projects.map(p => p.project_id)

  const [metricsRes, spendRes, pendingRes] = await Promise.all([
    supabaseAdmin.from('campaign_metrics')
      .select('campaign_id, date, impressions, clicks, cost, conversions, conversions_value, search_impression_share, search_budget_lost_is, search_rank_lost_is')
      .in('campaign_id', campaignIds).gte('date', from).lte('date', to),
    supabaseAdmin.from('ad_spend').select('campaign_id, spend').in('campaign_id', campaignIds).gte('date', from).lte('date', to),
    supabaseAdmin.from('affiliate_revenue').select('project_id, date, amount, cycle_end')
      .in('project_id', projectIds).eq('type', 'pending').gte('date', from).lte('date', to),
  ])

  const metricsByCampaign = new Map<string, CampaignMetric[]>()
  for (const m of (metricsRes.data ?? []) as CampaignMetric[]) {
    const arr = metricsByCampaign.get(m.campaign_id) ?? []
    arr.push(m); metricsByCampaign.set(m.campaign_id, arr)
  }
  const spendByCampaign = new Map<string, number>()
  for (const s of spendRes.data ?? []) spendByCampaign.set(s.campaign_id, (spendByCampaign.get(s.campaign_id) ?? 0) + (s.spend ?? 0))
  const pendingByProject = new Map<string, PendingRow[]>()
  for (const r of pendingRes.data ?? []) {
    const arr = pendingByProject.get(r.project_id) ?? []
    arr.push({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }); pendingByProject.set(r.project_id, arr)
  }

  const rows = projects.map(p => {
    const campaign_id = p.google_campaign_id as string
    const metrics = metricsByCampaign.get(campaign_id) ?? []
    const spend = spendByCampaign.get(campaign_id) ?? 0
    const { total: revenue } = computeScreenRevenue(pendingByProject.get(p.project_id) ?? [], p.screen_revenue_type === 'cumulative', 0)
    const res = optimizeCampaign({
      campaign_id, campaignLabel: p.name, project_id: p.project_id,
      metrics, revenueByDate: {}, spendByDate: {},
      totalRevenue: revenue, totalCost: spend, totalSpend: spend,
    })
    const highCount = res.suggestions.filter(s => s.severity === 'high').length
    const top = res.suggestions[0]
    return {
      project_id: p.project_id, name: p.name, cid: p.cid, campaign_id,
      spend, revenue, roi: res.health.roi, score: res.health.score,
      highCount, actionCount: res.suggestions.length,
      topAction: top?.title ?? null, topType: top?.type ?? null,
      hasMetrics: metrics.length > 0,
    }
  })

  // Xếp theo cấp thiết: camp LỖ (roi<0) trước — trong nhóm lỗ, chi phí cao lên trước
  // (chảy máu nhiều); còn lại theo điểm sức khỏe tăng dần (tệ trước).
  rows.sort((a, b) => {
    const aLose = a.roi != null && a.roi < 0 ? 1 : 0
    const bLose = b.roi != null && b.roi < 0 ? 1 : 0
    if (aLose !== bLose) return bLose - aLose
    if (aLose) return b.spend - a.spend
    return a.score - b.score
  })

  return NextResponse.json({ range: { from, to }, rows })
}
