import { supabaseAdmin } from '@/lib/supabase-admin'
import { computeCidCost } from '@/lib/costs'
import { computeScreenRevenue, PendingRow } from '@/lib/screen-revenue'
import { splitSpend, allocateSpendRow, AttrProject } from '@/lib/attribution'
import { BreakdownRow, breakdownMeta, filterForAttribution, toSegmentRevenue, dedupeSnapshotRows, snapshotKeysFromConfigs } from '@/lib/breakdown-revenue'
import { OptimizerInput } from '@/lib/campaign-optimizer'
import { AdDevice, BreakdownMeta, CampaignMetric, CampaignSettings, KeywordMetric, RentalGroup, SearchTermMetric, SegmentMetric } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// stats-loader — lắp ráp TOÀN BỘ dữ liệu 1 camp (theo project) cho optimizer.
//
// TÁCH NGUYÊN VẸN từ GET /api/optimize (pure move, giữ đúng hành vi) để dùng
// chung 2 nơi:
//   • API /api/optimize (tính health/breakdown live khi user mở trang)
//   • Engine chạy nền (runAnalysis — rebuild optimizer_daily_stats + đánh giá rule)
// Cơ sở phân tích = DT Màn hình (affiliate_revenue type='pending') vì có sớm;
// DT Thực (confirmed) chỉ để tham chiếu.
// ─────────────────────────────────────────────────────────────────────────────

export interface BundleProject {
  project_id: string
  name: string
  cid: string
  google_campaign_id: string | null
  screen_revenue_type: 'daily' | 'cumulative' | null
  camp_start_date: string | null
  test_budget: number | null
}

export interface CampaignBundle {
  project: BundleProject
  campaign_id: string
  input: OptimizerInput            // sẵn sàng đưa vào optimizeCampaign()
  cost: { spend: number; rental: number; other: number; total: number }
  revenue: { screen: number; confirmed: number }
  settings: CampaignSettings | null
  hasMetrics: boolean
  bdMeta: BreakdownMeta | null
}

export type LoadBundleResult =
  | { ok: true; bundle: CampaignBundle }
  | { ok: false; code: 'NO_PROJECT' | 'NO_CAMPAIGN' }

export async function loadCampaignBundle(opts: {
  project_id: string
  from: string
  to: string
  organizationId: string | null   // caller.organization_id — lọc rental group theo org
}): Promise<LoadBundleResult> {
  const { project_id, from, to, organizationId } = opts

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, cid, google_campaign_id, screen_revenue_type, camp_start_date, test_budget')
    .eq('project_id', project_id)
    .single()
  if (!project) return { ok: false, code: 'NO_PROJECT' }
  const isCumulative = project.screen_revenue_type === 'cumulative'

  if (!project.google_campaign_id) return { ok: false, code: 'NO_CAMPAIGN' }
  const campaign_id = project.google_campaign_id

  const [metricsRes, revenueRes, adSpendRes, otherRes, keywordRes, searchTermRes, segmentRes, settingsRes, breakdownRes] = await Promise.all([
    supabaseAdmin
      .from('campaign_metrics')
      .select('campaign_id, date, impressions, clicks, cost, conversions, conversions_value, search_impression_share, search_budget_lost_is, search_rank_lost_is, top_is, abs_top_is')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('affiliate_revenue')
      .select('date, type, amount, cycle_end')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('ad_spend')
      .select('date, spend, device, ad_group_id')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('other_costs')
      .select('amount')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('keyword_metrics')
      .select('campaign_id, ad_group_id, criterion_id, date, keyword_text, match_type, impressions, clicks, cost, conversions, quality_score, qs_expected_ctr, qs_ad_relevance, qs_landing_page')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('search_term_metrics')
      .select('campaign_id, ad_group_id, search_term, date, impressions, clicks, cost, conversions')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('segment_metrics')
      .select('campaign_id, date, segment_type, segment_value, impressions, clicks, cost, conversions')
      .eq('campaign_id', campaign_id)
      .gte('date', from).lte('date', to),

    supabaseAdmin
      .from('campaign_settings')
      .select('campaign_id, daily_budget, bidding_strategy, target_cpa, target_roas, currency_code, geo_target_type')
      .eq('campaign_id', campaign_id)
      .maybeSingle(),

    // Doanh thu breakdown từ network affiliate (Engine thu) — quốc gia/thiết bị/giờ/sub-id.
    // Bảng chưa migrate / chưa có dữ liệu → error/rỗng → degrade về hành vi cũ (engagement).
    supabaseAdmin
      .from('revenue_breakdown')
      .select('date, country, device, hour, sub_id, campaign_id, revenue, currency, revenue_usd, conversions, revenue_type, network_id, report')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to),
  ])

  const metrics = (metricsRes.data ?? []) as CampaignMetric[]
  const revenues = revenueRes.data ?? []
  const adSpends = adSpendRes.data ?? []
  const others = otherRes.data ?? []
  const keywords = (keywordRes.data ?? []) as KeywordMetric[]
  const searchTerms = (searchTermRes.data ?? []) as SearchTermMetric[]
  const segments = (segmentRes.data ?? []) as SegmentMetric[]
  const settings = (settingsRes.data as CampaignSettings | null) ?? undefined

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

  // ── Doanh thu breakdown theo segment (join với chi phí Google Ads) ────────
  // Đủ sub-id (≥80% DT) → lọc đúng dòng của campaign này (attribution 'campaign');
  // chưa → dùng toàn bộ dòng của project. KHÔNG cộng vào totalRevenue (tránh double-count).
  const rawBdRows = (breakdownRes.data ?? []) as BreakdownRow[]
  // Bỏ trùng report snapshot (date_mode='window_end' — mỗi sync ghi 1 dòng tổng-cả-kỳ) trước khi
  // gộp segment/coverage, tránh cộng chồng kỳ làm doanh thu nguồn phình.
  let snapshotKeys = new Set<string>()
  if (rawBdRows.length) {
    const nets = [...new Set(rawBdRows.map(r => r.network_id))]
    const { data: cfgs } = await supabaseAdmin.from('engine_network_configs').select('network_id, config').in('network_id', nets)
    snapshotKeys = snapshotKeysFromConfigs(cfgs ?? [])
  }
  const allBdRows = dedupeSnapshotRows(rawBdRows, snapshotKeys)
  const { rows: bdRows, attribution } = filterForAttribution(allBdRows, campaign_id)
  const segmentRevenue = toSegmentRevenue(bdRows)
  const bdMeta = allBdRows.length ? breakdownMeta(bdRows, totalRevenue, attribution) : null

  // Chi phí campaign THÔ (chưa attribute) — dùng làm mẫu số base rental (theo cid) + tỷ lệ segment.
  const fullSpend = adSpends.reduce((s, r) => s + (r.spend ?? 0), 0)

  const total_other = others.reduce((s, r) => s + (r.amount ?? 0), 0)

  // ── Chi phí Thuê TK (rental) ──────────────────────────────────────────────
  // Fetch TẤT CẢ rental group của org rồi match trong JS (mirror usePnlData) —
  // KHÔNG dùng .or trên cột embedded (không match được → trước đây bỏ sót rental).
  const [cidProjectsRes, rentalRes] = await Promise.all([
    supabaseAdmin
      .from('projects')
      .select('project_id, google_campaign_id, screen_revenue_type, attribution_type, attribution_device, attribution_ad_group_id, attribution_from, attribution_to, attribution_weight')
      .eq('cid', project.cid),
    (() => {
      let q = supabaseAdmin.from('rental_groups').select('*, rental_group_cids(*)')
      if (organizationId) q = q.eq('organization_id', organizationId)
      return q
    })(),
  ])
  const cidProjects = cidProjectsRes.data?.length
    ? cidProjectsRes.data
    : [{ project_id, google_campaign_id: campaign_id, screen_revenue_type: project.screen_revenue_type,
         attribution_type: null, attribution_device: null, attribution_ad_group_id: null, attribution_from: null, attribution_to: null, attribution_weight: null }]
  const rentalGroups = (rentalRes.data ?? []) as unknown as RentalGroup[]

  // Sibling THEO CAMPAIGN (nhiều ref-link project chung 1 google_campaign_id) → attribute chi phí QC.
  const campSiblings: AttrProject[] = cidProjects
    .filter(p => p.google_campaign_id === campaign_id)
    .map(p => ({
      project_id: p.project_id,
      attribution_type: p.attribution_type ?? null,
      attribution_device: p.attribution_device ?? null,
      attribution_ad_group_id: p.attribution_ad_group_id ?? null,
      attribution_from: p.attribution_from ?? null,
      attribution_to: p.attribution_to ?? null,
      attribution_weight: p.attribution_weight ?? null,
    }))

  // Base % rental = tổng ad spend theo CID (mọi campaign của các project chung cid).
  let cidSpend = fullSpend
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

  // Attribution chi phí QC về ĐÚNG project này theo cấu hình tách (device/ad_group/khoảng ngày/%/
  // doanh thu) — DÙNG LẠI allocateSpendRow như P&L. 1 ref-link/campaign → trả full (siblings=1).
  const attribSpend = (rows: { date: string; spend: number | null; device?: string | null; ad_group_id?: string | null }[]) => {
    const byDate: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      const portion = campSiblings.length > 1
        ? (allocateSpendRow({ campaign_id, date: r.date, spend: r.spend ?? 0, device: (r.device ?? '') as AdDevice, ad_group_id: r.ad_group_id ?? '' }, campSiblings, revenueBasis).get(project_id) ?? 0)
        : (r.spend ?? 0)
      byDate[r.date] = (byDate[r.date] ?? 0) + portion
      total += portion
    }
    return { byDate, total }
  }
  const { byDate: spendByDate, total: totalSpend } = attribSpend(adSpends)
  // Chi phí segment (geo/device/giờ): device-row khớp thiết bị (chính xác); giờ/geo chia theo DT.
  const segmentsAttr: SegmentMetric[] = campSiblings.length > 1
    ? segments.map(s => ({
        ...s,
        cost: allocateSpendRow(
          { campaign_id, date: s.date, spend: s.cost, device: (s.segment_type === 'device' ? s.segment_value : '') as AdDevice, ad_group_id: '' },
          campSiblings, revenueBasis,
        ).get(project_id) ?? 0,
      }))
    : segments

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

  // ── Kỳ trước cùng độ dài (WoW / D2) ───────────────────────────────────────
  const DAY = 86400000
  const isoDay = (d: Date) => d.toISOString().slice(0, 10)
  const fromMs = new Date(from + 'T00:00:00Z').getTime()
  const lenDays = Math.round((new Date(to + 'T00:00:00Z').getTime() - fromMs) / DAY) + 1
  const prevTo = isoDay(new Date(fromMs - DAY))
  const prevFrom = isoDay(new Date(fromMs - lenDays * DAY))

  const [prevMetricsRes, prevSpendRes, prevPendingRes] = await Promise.all([
    supabaseAdmin.from('campaign_metrics')
      .select('campaign_id, date, impressions, clicks, cost, conversions, conversions_value, search_impression_share, search_budget_lost_is, search_rank_lost_is, top_is, abs_top_is')
      .eq('campaign_id', campaign_id).gte('date', prevFrom).lte('date', prevTo),
    supabaseAdmin.from('ad_spend').select('date, spend, device, ad_group_id').eq('campaign_id', campaign_id).gte('date', prevFrom).lte('date', prevTo),
    supabaseAdmin.from('affiliate_revenue').select('date, amount, cycle_end')
      .eq('project_id', project_id).eq('type', 'pending').gte('date', prevFrom).lte('date', prevTo),
  ])
  const prevMetrics = (prevMetricsRes.data ?? []) as CampaignMetric[]
  const prevSpend = attribSpend(prevSpendRes.data ?? []).total
  let prevBaseline = 0
  if (isCumulative) {
    const { data: pb } = await supabaseAdmin.from('affiliate_revenue')
      .select('amount, cycle_end').eq('project_id', project_id).eq('type', 'pending')
      .lt('date', prevFrom).order('date', { ascending: false }).limit(1).maybeSingle()
    prevBaseline = pb ? (pb.cycle_end ? 0 : (pb.amount ?? 0)) : 0
  }
  const prevPendingRows: PendingRow[] = (prevPendingRes.data ?? []).map(r => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
  const { total: prevRevenue } = computeScreenRevenue(prevPendingRows, isCumulative, prevBaseline)
  const prevTotalCost = totalSpend > 0 ? prevSpend * (totalCost / totalSpend) : prevSpend
  const hasPrev = prevSpend > 0 || prevMetrics.length > 0 || prevRevenue > 0
  const prev = hasPrev ? { metrics: prevMetrics, totalRevenue: prevRevenue, totalCost: prevTotalCost, totalSpend: prevSpend } : undefined

  // ── Lũy kế từ khi start camp (cho stop-loss ở Lộ trình test camp mới) ─────
  const lifeFrom = project.camp_start_date ?? '2000-01-01'
  const [lifeSpendRes, lifePendingRes] = await Promise.all([
    supabaseAdmin.from('ad_spend').select('date, spend, device, ad_group_id').eq('campaign_id', campaign_id).gte('date', lifeFrom),
    supabaseAdmin.from('affiliate_revenue').select('date, amount, cycle_end')
      .eq('project_id', project_id).eq('type', 'pending').gte('date', lifeFrom),
  ])
  const lifetimeSpend = attribSpend(lifeSpendRes.data ?? []).total
  const lifePendingRows: PendingRow[] = (lifePendingRes.data ?? []).map(r => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
  const { total: lifetimeRevenue } = computeScreenRevenue(lifePendingRows, isCumulative, 0)

  // Độ phủ chi phí segment: segment_metrics thường chỉ có MỘT SỐ ngày (Google Ads sync thiếu/cũ)
  // → chi phí theo quốc gia/thiết bị/giờ HỤT → ROI segment không đáng tin. So chi phí segment THÔ
  // (theo type có nhiều chi phí nhất) với tổng chi phí campaign_metrics — dùng segments THÔ (không
  // attribute) để không nhiễu tỷ lệ. 0..1; thấp = thiếu ngày → optimizer sẽ khóa ROI theo segment.
  const metricCostTotal = metrics.reduce((s, m) => s + m.cost, 0)
  const segCostByType = new Map<string, number>()
  for (const s of segments) segCostByType.set(s.segment_type, (segCostByType.get(s.segment_type) ?? 0) + (s.cost ?? 0))
  const segmentCostCoverage = metricCostTotal > 0 ? Math.max(0, ...segCostByType.values()) / metricCostTotal : 0

  const input: OptimizerInput = {
    campaign_id,
    campaignLabel: project.name,
    project_id,
    metrics,
    revenueByDate,
    spendByDate,
    totalRevenue,
    totalCost,
    totalSpend,
    keywords,
    searchTerms,
    segments: segmentsAttr,
    prev,
    settings,
    campStartDate: project.camp_start_date ?? null,
    testBudget: project.test_budget ?? null,
    lifetime: { spend: lifetimeSpend, revenue: lifetimeRevenue },
    segmentRevenue,
    breakdownMeta: bdMeta ?? undefined,
    segmentCostCoverage,
  }

  return {
    ok: true,
    bundle: {
      project: project as BundleProject,
      campaign_id,
      input,
      cost: { spend: totalSpend, rental: total_rental, other: total_other, total: totalCost },
      revenue: { screen: totalRevenue, confirmed: confirmedRevenue },
      settings: settings ?? null,
      hasMetrics: metrics.length > 0,
      bdMeta,
    },
  }
}
