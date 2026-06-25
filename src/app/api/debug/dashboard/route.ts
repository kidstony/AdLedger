import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Temporary debug endpoint — DELETE after diagnosis is complete
export async function GET() {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const fromDate = thirtyDaysAgo.toISOString().split('T')[0]
  const toDate = new Date().toISOString().split('T')[0]

  const [spendAll, spendInRange, projects] = await Promise.all([
    supabaseAdmin.from('ad_spend').select('campaign_id', { count: 'exact', head: true }),
    supabaseAdmin.from('ad_spend').select('campaign_id').gte('date', fromDate).lte('date', toDate),
    supabaseAdmin.from('projects').select('project_id, name, google_campaign_id').order('project_id'),
  ])

  const uniqueCampaignIds = [...new Set((spendInRange.data ?? []).map(r => r.campaign_id))].sort()
  const projectsWithCampaignId = (projects.data ?? []).filter(p => p.google_campaign_id)
  const mappedCampaignIds = new Set(projectsWithCampaignId.map(p => p.google_campaign_id))
  const matchingPairs = uniqueCampaignIds.filter(id => mappedCampaignIds.has(id))

  return NextResponse.json({
    date_range: { from: fromDate, to: toDate },
    ad_spend_total_rows: spendAll.count ?? 0,
    ad_spend_rows_in_range: (spendInRange.data ?? []).length,
    ad_spend_unique_campaign_ids: uniqueCampaignIds,
    projects_total: (projects.data ?? []).length,
    projects_with_campaign_id: projectsWithCampaignId,
    matching_campaign_ids: matchingPairs,
    matching_pairs_count: matchingPairs.length,
    verdict:
      projectsWithCampaignId.length === 0
        ? 'ISSUE: No projects have google_campaign_id set — go to /admin/integrations to map campaigns'
        : matchingPairs.length === 0
          ? 'ISSUE: Projects have google_campaign_id but none match ad_spend campaign IDs in this range'
          : 'OK: Matches found — check client-side auth/RLS if dashboard still empty',
  })
}
