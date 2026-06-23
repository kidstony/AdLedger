import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if ((body as { secret?: string }).secret !== process.env.ADS_SCRIPT_SECRET) {
    await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: 'Invalid secret' })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Discovery: receive campaign list, upsert into campaign_discoveries
  if ('type' in body && body.type === 'discover') {
    const campaigns = (body as { campaigns?: CampaignRecord[] }).campaigns ?? []
    if (campaigns.length > 0) {
      const rows = campaigns.map(c => ({
        campaign_id:   c.campaign_id,
        campaign_name: c.campaign_name,
        customer_id:   c.customer_id,
        mcc_id:        c.mcc_id ?? null,
        mcc_name:      c.mcc_name ?? null,
        last_seen:     new Date().toISOString(),
      }))
      const { error } = await supabaseAdmin
        .from('campaign_discoveries')
        .upsert(rows, { onConflict: 'campaign_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await backfillProjectCidMcc(campaigns.map(c => c.campaign_id))
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

  // Upsert campaign discoveries (keep last_seen fresh)
  const discoveryRows = records.map(r => ({
    campaign_id:   r.campaign_id,
    campaign_name: r.campaign_name,
    customer_id:   r.customer_id,
    mcc_id:        r.mcc_id ?? null,
    mcc_name:      r.mcc_name ?? null,
    last_seen:     new Date().toISOString(),
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
    await supabaseAdmin.from('sync_log').insert({ records: 0, status: 'error', message: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabaseAdmin.from('sync_log').insert({ records: spendRows.length, status: 'success', message: null })
  return NextResponse.json({ success: true, count: spendRows.length })
}
