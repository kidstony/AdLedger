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
}

type Body =
  | { secret?: string; type?: 'discover'; campaigns?: CampaignRecord[] }
  | { secret?: string; type: 'spend'; records?: SpendRecord[] }
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
  if (!checkRateLimit(`ads-script:${ip}`, 30, 60_000)) {
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

  // Upsert spend
  const spendRows = records.map(r => ({
    campaign_id: r.campaign_id,
    date:        r.date,
    spend:       Number(r.spend),
  }))
  const { error } = await supabaseAdmin
    .from('ad_spend')
    .upsert(spendRows, { onConflict: 'campaign_id,date' })

  if (error) {
    await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: error.message, organization_id: organizationId })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabaseAdmin.from('sync_log').insert({ records: spendRows.length, status: 'success', message: null, organization_id: organizationId })
  return NextResponse.json({ success: true, count: spendRows.length })
}
