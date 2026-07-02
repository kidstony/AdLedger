import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile, getOrgTeamIds } from '@/lib/require-role'

// GET — list all discovered campaigns with current project mapping
export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let campaignsQuery = supabaseAdmin
    .from('campaign_discoveries')
    .select('campaign_id, campaign_name, customer_id, mcc_id, mcc_name, last_seen')
    .order('campaign_name')

  // Org-scoped SA: only see campaigns tagged to their org
  if (caller?.role === 'super_admin' && caller.organization_id) {
    campaignsQuery = campaignsQuery.eq('organization_id', caller.organization_id)
  }

  const { data: campaigns, error } = await campaignsQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fetch org-scoped mapped projects for the caller
  let projectQuery = supabaseAdmin
    .from('projects')
    .select('project_id, name, google_campaign_id')
    .not('google_campaign_id', 'is', null)

  if (caller?.role === 'super_admin' && caller.organization_id) {
    const teamIds = await getOrgTeamIds(caller.organization_id)
    projectQuery = projectQuery.in('team_id', teamIds)
  }

  const { data: mappedProjects } = await projectQuery

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
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { campaign_id, project_id }: { campaign_id: string; project_id: string | null } = await req.json()

  if (!campaign_id) return NextResponse.json({ error: 'campaign_id required' }, { status: 400 })

  // Org-scoped SA: validate target project belongs to their org
  if (project_id !== null && caller.organization_id) {
    const teamIds = await getOrgTeamIds(caller.organization_id)
    const { data: targetProject } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (!targetProject || !teamIds.includes(targetProject.team_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

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
export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
