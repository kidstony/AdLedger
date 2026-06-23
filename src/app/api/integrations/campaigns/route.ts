import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// GET — list all discovered campaigns with current project mapping
export async function GET() {
  // campaign_discoveries LEFT JOIN projects ON projects.google_campaign_id = campaign_discoveries.campaign_id
  const { data: campaigns, error } = await supabaseAdmin
    .from('campaign_discoveries')
    .select('campaign_id, campaign_name, customer_id, mcc_id, mcc_name, last_seen')
    .order('campaign_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch projects that have google_campaign_id set
  const { data: mappedProjects } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, google_campaign_id')
    .not('google_campaign_id', 'is', null)

  const mappingByCampaignId = new Map(
    (mappedProjects ?? []).map(p => [p.google_campaign_id, { project_id: p.project_id, project_name: p.name }])
  )

  const result = (campaigns ?? []).map(c => ({
    ...c,
    project_id:   mappingByCampaignId.get(c.campaign_id)?.project_id ?? null,
    project_name: mappingByCampaignId.get(c.campaign_id)?.project_name ?? null,
  }))

  // Sort: unmapped first
  result.sort((a, b) => {
    if (!a.project_id && b.project_id) return -1
    if (a.project_id && !b.project_id) return 1
    return a.campaign_name.localeCompare(b.campaign_name)
  })

  return NextResponse.json(result)
}

// PATCH — assign or unassign a campaign to a project
export async function PATCH(req: NextRequest) {
  const { campaign_id, project_id }: { campaign_id: string; project_id: string | null } = await req.json()

  if (!campaign_id) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  // Clear any previous project that had this campaign assigned
  if (project_id !== null) {
    await supabaseAdmin
      .from('projects')
      .update({ google_campaign_id: null })
      .eq('google_campaign_id', campaign_id)
      .neq('project_id', project_id)
  }

  if (project_id === null) {
    // Unassign
    await supabaseAdmin
      .from('projects')
      .update({ google_campaign_id: null })
      .eq('google_campaign_id', campaign_id)
  } else {
    // Fetch discovery info to auto-fill cid + mcc_id on the project
    const { data: discovery } = await supabaseAdmin
      .from('campaign_discoveries')
      .select('customer_id, mcc_id, mcc_name')
      .eq('campaign_id', campaign_id)
      .single()

    const patch: Record<string, string | null> = { google_campaign_id: campaign_id }
    if (discovery?.customer_id) patch.cid = discovery.customer_id
    if (discovery?.mcc_id)      patch.mcc_id = discovery.mcc_id

    const { error } = await supabaseAdmin
      .from('projects')
      .update(patch)
      .eq('project_id', project_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// POST — backfill cid/mcc_id on all already-mapped projects from campaign_discoveries
export async function POST() {
  const { data: mappedProjects, error: e1 } = await supabaseAdmin
    .from('projects')
    .select('project_id, google_campaign_id')
    .not('google_campaign_id', 'is', null)
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  const campaignIds = (mappedProjects ?? []).map(p => p.google_campaign_id as string)
  if (!campaignIds.length) return NextResponse.json({ updated: 0 })

  const { data: discoveries } = await supabaseAdmin
    .from('campaign_discoveries')
    .select('campaign_id, customer_id, mcc_id')
    .in('campaign_id', campaignIds)

  const discoveryMap = new Map((discoveries ?? []).map(d => [d.campaign_id, d]))

  let updated = 0
  for (const p of mappedProjects ?? []) {
    const d = discoveryMap.get(p.google_campaign_id as string)
    if (!d) continue
    const patch: Record<string, string | null> = {}
    if (d.customer_id) patch.cid = d.customer_id
    if (d.mcc_id)      patch.mcc_id = d.mcc_id
    if (!Object.keys(patch).length) continue
    await supabaseAdmin.from('projects').update(patch).eq('project_id', p.project_id)
    updated++
  }

  return NextResponse.json({ updated })
}
