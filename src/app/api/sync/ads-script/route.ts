import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

function secretMatches(received: string, expected: string): boolean {
  try {
    const a = Buffer.from(received)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

interface CampaignRecord {
  campaign_id: string
  campaign_name: string
  customer_id: string
  mcc_id?: string
  mcc_name?: string
}

interface SpendRecord extends CampaignRecord {
  date: string
  spend: number
  device?: string       // MOBILE | DESKTOP | TABLET (mặc định 'ALL' nếu script chưa segment)
  ad_group_id?: string  // id ad group (mặc định 'ALL' nếu script chưa segment)
}

// Số liệu hiệu suất cấp campaign (feature "Tối Ưu Camp"). Tách khỏi ad_spend.
interface CampaignMetricRecord {
  campaign_id: string
  date: string
  impressions?: number
  clicks?: number
  cost?: number
  conversions?: number | null
  conversions_value?: number | null
  search_impression_share?: number | null
  search_budget_lost_is?: number | null
  search_rank_lost_is?: number | null
}

// Số liệu cấp keyword & search term (feature "Tối Ưu Camp" P2).
interface KeywordMetricRecord {
  campaign_id: string
  ad_group_id: string
  criterion_id: string
  date: string
  keyword_text?: string
  match_type?: string
  impressions?: number
  clicks?: number
  cost?: number
  conversions?: number | null
  quality_score?: number | null
}
interface SearchTermRecord {
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions?: number
  clicks?: number
  cost?: number
  conversions?: number | null
}
// Phân khúc device/hour/geo (Tối Ưu Camp P3).
interface SegmentMetricRecord {
  campaign_id: string
  date: string
  segment_type: string   // 'device' | 'hour' | 'geo'
  segment_value: string
  impressions?: number
  clicks?: number
  cost?: number
  conversions?: number | null
}

type Body =
  | { secret?: string; type?: 'discover'; campaigns?: CampaignRecord[] }
  | { secret?: string; type: 'spend'; records?: SpendRecord[] }
  | { secret?: string; type: 'campaign_metrics'; records?: CampaignMetricRecord[] }
  | { secret?: string; type: 'keyword_metrics'; records?: KeywordMetricRecord[] }
  | { secret?: string; type: 'search_terms'; records?: SearchTermRecord[] }
  | { secret?: string; type: 'segment_metrics'; records?: SegmentMetricRecord[] }
  | { secret?: string; records?: []; type?: undefined }

async function backfillProjectCidMcc(campaignIds: string[]) {
  if (!campaignIds.length) return
  const { data: mappedProjects } = await supabaseAdmin
    .from('projects')
    .select('project_id, google_campaign_id, cid, mcc_id')
    .in('google_campaign_id', campaignIds)
  if (!mappedProjects?.length) return

  const { data: discoveries } = await supabaseAdmin
    .from('campaign_discoveries')
    .select('campaign_id, customer_id, mcc_id')
    .in('campaign_id', campaignIds)
  if (!discoveries?.length) return

  const discoveryMap = new Map(discoveries.map(d => [d.campaign_id, d]))
  await Promise.all(
    mappedProjects
      .map(p => {
        const d = discoveryMap.get(p.google_campaign_id!)
        if (!d) return null
        const newCid = d.customer_id ?? p.cid
        const newMcc = d.mcc_id ?? p.mcc_id
        if (newCid === p.cid && newMcc === p.mcc_id) return null
        return supabaseAdmin.from('projects').update({ cid: newCid, mcc_id: newMcc }).eq('project_id', p.project_id)
      })
      .filter(Boolean)
  )
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await checkRateLimit(`ads-script:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const incomingSecret = (body as { secret?: string }).secret ?? ''
  let organizationId: string | null = null

  // Try to match against per-org secrets first
  const { data: matchedOrg } = await supabaseAdmin
    .from('organizations').select('id').eq('ads_secret', incomingSecret).maybeSingle()

  if (matchedOrg) {
    organizationId = matchedOrg.id
  } else if (!secretMatches(incomingSecret, process.env.ADS_SCRIPT_SECRET ?? '')) {
    await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: 'Invalid secret', organization_id: null })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Discovery: receive campaign list, upsert into campaign_discoveries
  if ('type' in body && body.type === 'discover') {
    const campaigns = (body as { campaigns?: CampaignRecord[] }).campaigns ?? []
    if (campaigns.length > 0) {
      const ids = campaigns.map(c => c.campaign_id)
      const { data: existing } = await supabaseAdmin
        .from('campaign_discoveries').select('campaign_id, mcc_id, mcc_name').in('campaign_id', ids)
      const existingMap = new Map((existing ?? []).map(d => [d.campaign_id, d]))

      const rows = campaigns.map(c => ({
        campaign_id:     c.campaign_id,
        campaign_name:   c.campaign_name,
        customer_id:     c.customer_id,
        mcc_id:          c.mcc_id ?? existingMap.get(c.campaign_id)?.mcc_id ?? null,
        mcc_name:        c.mcc_name ?? existingMap.get(c.campaign_id)?.mcc_name ?? null,
        last_seen:       new Date().toISOString(),
        organization_id: organizationId,
      }))
      const { error } = await supabaseAdmin
        .from('campaign_discoveries')
        .upsert(rows, { onConflict: 'campaign_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await backfillProjectCidMcc(ids)
    }
    return NextResponse.json({ success: true, type: 'discover', count: campaigns.length })
  }

  // Campaign metrics sync: số liệu hiệu suất cấp campaign × ngày (Tối Ưu Camp).
  // KHÔNG đụng ad_spend — bảng riêng campaign_metrics.
  if ('type' in body && body.type === 'campaign_metrics') {
    const mRecords = (body as { records?: CampaignMetricRecord[] }).records ?? []
    if (mRecords.length === 0) {
      return NextResponse.json({ success: true, type: 'campaign_metrics', count: 0, ping: true })
    }
    const num = (v: unknown) => (v == null ? null : Number(v))
    const rows = mRecords.map(r => ({
      campaign_id:             r.campaign_id,
      date:                    r.date,
      impressions:             Number(r.impressions ?? 0),
      clicks:                  Number(r.clicks ?? 0),
      cost:                    Number(r.cost ?? 0),
      conversions:             num(r.conversions),
      conversions_value:       num(r.conversions_value),
      search_impression_share: num(r.search_impression_share),
      search_budget_lost_is:   num(r.search_budget_lost_is),
      search_rank_lost_is:     num(r.search_rank_lost_is),
      organization_id:         organizationId,
      updated_at:              new Date().toISOString(),
    }))
    const { error } = await supabaseAdmin
      .from('campaign_metrics')
      .upsert(rows, { onConflict: 'campaign_id,date' })
    if (error) {
      await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: `campaign_metrics: ${error.message}`, organization_id: organizationId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await supabaseAdmin.from('sync_log').insert({ records: rows.length, status: 'success', message: 'campaign_metrics', organization_id: organizationId })
    return NextResponse.json({ success: true, type: 'campaign_metrics', count: rows.length })
  }

  // Keyword metrics sync (P2) — keyword × ngày. Bảng riêng keyword_metrics.
  if ('type' in body && body.type === 'keyword_metrics') {
    const kRecords = (body as { records?: KeywordMetricRecord[] }).records ?? []
    if (kRecords.length === 0) return NextResponse.json({ success: true, type: 'keyword_metrics', count: 0, ping: true })
    const rows = kRecords.map(r => ({
      campaign_id:     r.campaign_id,
      ad_group_id:     r.ad_group_id,
      criterion_id:    r.criterion_id,
      date:            r.date,
      keyword_text:    r.keyword_text ?? '',
      match_type:      r.match_type ?? '',
      impressions:     Number(r.impressions ?? 0),
      clicks:          Number(r.clicks ?? 0),
      cost:            Number(r.cost ?? 0),
      conversions:     r.conversions == null ? null : Number(r.conversions),
      quality_score:   r.quality_score == null ? null : Number(r.quality_score),
      organization_id: organizationId,
      updated_at:      new Date().toISOString(),
    }))
    const { error } = await supabaseAdmin
      .from('keyword_metrics')
      .upsert(rows, { onConflict: 'campaign_id,ad_group_id,criterion_id,date' })
    if (error) {
      await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: `keyword_metrics: ${error.message}`, organization_id: organizationId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await supabaseAdmin.from('sync_log').insert({ records: rows.length, status: 'success', message: 'keyword_metrics', organization_id: organizationId })
    return NextResponse.json({ success: true, type: 'keyword_metrics', count: rows.length })
  }

  // Search term sync (P2) — search term × ngày. Bảng riêng search_term_metrics.
  if ('type' in body && body.type === 'search_terms') {
    const sRecords = (body as { records?: SearchTermRecord[] }).records ?? []
    if (sRecords.length === 0) return NextResponse.json({ success: true, type: 'search_terms', count: 0, ping: true })
    const rows = sRecords.map(r => ({
      campaign_id:     r.campaign_id,
      ad_group_id:     r.ad_group_id,
      search_term:     r.search_term,
      date:            r.date,
      impressions:     Number(r.impressions ?? 0),
      clicks:          Number(r.clicks ?? 0),
      cost:            Number(r.cost ?? 0),
      conversions:     r.conversions == null ? null : Number(r.conversions),
      organization_id: organizationId,
      updated_at:      new Date().toISOString(),
    }))
    const { error } = await supabaseAdmin
      .from('search_term_metrics')
      .upsert(rows, { onConflict: 'campaign_id,ad_group_id,search_term,date' })
    if (error) {
      await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: `search_terms: ${error.message}`, organization_id: organizationId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await supabaseAdmin.from('sync_log').insert({ records: rows.length, status: 'success', message: 'search_terms', organization_id: organizationId })
    return NextResponse.json({ success: true, type: 'search_terms', count: rows.length })
  }

  // Segment sync (P3) — device/hour/geo × ngày. Bảng riêng segment_metrics.
  if ('type' in body && body.type === 'segment_metrics') {
    const gRecords = (body as { records?: SegmentMetricRecord[] }).records ?? []
    if (gRecords.length === 0) return NextResponse.json({ success: true, type: 'segment_metrics', count: 0, ping: true })
    const validType = (t: string) => (t === 'device' || t === 'hour' || t === 'geo' ? t : null)
    const rows = gRecords
      .filter(r => validType(r.segment_type))
      .map(r => ({
        campaign_id:     r.campaign_id,
        date:            r.date,
        segment_type:    r.segment_type,
        segment_value:   String(r.segment_value),
        impressions:     Number(r.impressions ?? 0),
        clicks:          Number(r.clicks ?? 0),
        cost:            Number(r.cost ?? 0),
        conversions:     r.conversions == null ? null : Number(r.conversions),
        organization_id: organizationId,
        updated_at:      new Date().toISOString(),
      }))
    if (rows.length === 0) return NextResponse.json({ success: true, type: 'segment_metrics', count: 0 })
    const { error } = await supabaseAdmin
      .from('segment_metrics')
      .upsert(rows, { onConflict: 'campaign_id,date,segment_type,segment_value' })
    if (error) {
      await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: `segment_metrics: ${error.message}`, organization_id: organizationId })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    await supabaseAdmin.from('sync_log').insert({ records: rows.length, status: 'success', message: 'segment_metrics', organization_id: organizationId })
    return NextResponse.json({ success: true, type: 'segment_metrics', count: rows.length })
  }

  // Spend sync: receive daily spend per campaign
  const spendBody = body as { records?: SpendRecord[] }
  const records: SpendRecord[] = spendBody.records ?? []

  // Ping / health-check
  if (records.length === 0) {
    return NextResponse.json({ success: true, count: 0, ping: true })
  }

  // Upsert campaign discoveries — fetch existing MCC data first so we don't overwrite
  // mcc_id/mcc_name that was set by the discover phase if this spend record lacks MCC info.
  const spendCampaignIds = records.map(r => r.campaign_id)
  const { data: existingSpend } = await supabaseAdmin
    .from('campaign_discoveries').select('campaign_id, mcc_id, mcc_name').in('campaign_id', spendCampaignIds)
  const existingSpendMap = new Map((existingSpend ?? []).map(d => [d.campaign_id, d]))

  const discoveryRows = records.map(r => ({
    campaign_id:     r.campaign_id,
    campaign_name:   r.campaign_name,
    customer_id:     r.customer_id,
    mcc_id:          r.mcc_id ?? existingSpendMap.get(r.campaign_id)?.mcc_id ?? null,
    mcc_name:        r.mcc_name ?? existingSpendMap.get(r.campaign_id)?.mcc_name ?? null,
    last_seen:       new Date().toISOString(),
    organization_id: organizationId,
  }))
  await supabaseAdmin
    .from('campaign_discoveries')
    .upsert(discoveryRows, { onConflict: 'campaign_id' })
  await backfillProjectCidMcc(records.map(r => r.campaign_id))

  // Upsert spend. Granularity mịn: (campaign_id, date, device, ad_group_id).
  // Script cũ chưa gửi device/ad_group_id → mặc định 'ALL' (giữ nguyên hành vi).
  const normDevice = (d?: string) => {
    if (!d) return 'ALL' // script cũ không gửi device → 'ALL' (tổng legacy)
    const u = d.toUpperCase()
    return u === 'MOBILE' || u === 'DESKTOP' || u === 'TABLET' ? u : 'OTHER'
  }
  const spendRows = records.map(r => ({
    campaign_id: r.campaign_id,
    date:        r.date,
    device:      normDevice(r.device),
    ad_group_id: r.ad_group_id?.trim() ? r.ad_group_id.trim() : 'ALL',
    spend:       Number(r.spend),
  }))
  const { error } = await supabaseAdmin
    .from('ad_spend')
    .upsert(spendRows, { onConflict: 'campaign_id,date,device,ad_group_id' })

  if (error) {
    await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: error.message, organization_id: organizationId })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Supersede dữ liệu legacy: khi đã có dòng chi tiết theo device/ad_group cho một
  // (campaign, ngày), xoá dòng tổng cũ device='ALL' & ad_group_id='ALL' của chính
  // ngày đó để không cộng chồng (đếm gấp đôi) khi backfill/re-sync.
  const segmentedDatesByCampaign = new Map<string, Set<string>>()
  spendRows.forEach(r => {
    if (r.device === 'ALL' && r.ad_group_id === 'ALL') return
    const set = segmentedDatesByCampaign.get(r.campaign_id) ?? new Set<string>()
    set.add(r.date)
    segmentedDatesByCampaign.set(r.campaign_id, set)
  })
  for (const [campaignId, dates] of segmentedDatesByCampaign) {
    await supabaseAdmin
      .from('ad_spend')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('device', 'ALL')
      .eq('ad_group_id', 'ALL')
      .in('date', [...dates])
  }

  await supabaseAdmin.from('sync_log').insert({ records: spendRows.length, status: 'success', message: null, organization_id: organizationId })
  return NextResponse.json({ success: true, count: spendRows.length })
}
