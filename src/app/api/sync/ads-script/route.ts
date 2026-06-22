import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface CampaignRecord {
  campaign_id: string
  campaign_name: string
  customer_id: string
}

interface SpendRecord extends CampaignRecord {
  date: string
  spend: number
}

type Body =
  | { secret?: string; type?: 'discover'; campaigns?: CampaignRecord[] }
  | { secret?: string; type: 'spend'; records?: SpendRecord[] }
  | { secret?: string; records?: []; type?: undefined }

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
        last_seen:     new Date().toISOString(),
      }))
      const { error } = await supabaseAdmin
        .from('campaign_discoveries')
        .upsert(rows, { onConflict: 'campaign_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
    last_seen:     new Date().toISOString(),
  }))
  await supabaseAdmin
    .from('campaign_discoveries')
    .upsert(discoveryRows, { onConflict: 'campaign_id' })

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
