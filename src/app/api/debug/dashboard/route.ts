import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Temporary debug endpoint — DELETE after diagnosis is complete
export async function GET() {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const fromDate = thirtyDaysAgo.toISOString().split('T')[0]
  const toDate = new Date().toISOString().split('T')[0]

  const [spendAll, spendInRange, projects, rlsPolicies, userProfiles] = await Promise.all([
    supabaseAdmin.from('ad_spend').select('campaign_id', { count: 'exact', head: true }),
    supabaseAdmin.from('ad_spend').select('campaign_id').gte('date', fromDate).lte('date', toDate),
    supabaseAdmin.from('projects').select('project_id, name, google_campaign_id, team_id').order('project_id'),
    // Check which tables have RLS enabled and what policies exist
    supabaseAdmin.rpc('check_rls_status' as never).catch(() => ({ data: null, error: 'function not available' })),
    supabaseAdmin.from('user_profiles').select('user_id, role, team_id').order('role'),
  ])

  // Check pg_policies directly
  const { data: policies } = await supabaseAdmin
    .from('pg_policies' as never)
    .select('tablename, policyname, cmd, qual')
    .in('tablename' as never, ['projects', 'ad_spend', 'user_profiles'] as never)
    .catch(() => ({ data: null }))

  const uniqueCampaignIds = [...new Set((spendInRange.data ?? []).map((r: { campaign_id: string }) => r.campaign_id))].sort()
  const projectsWithCampaignId = (projects.data ?? []).filter((p: { google_campaign_id: string | null }) => p.google_campaign_id)
  const mappedCampaignIds = new Set(projectsWithCampaignId.map((p: { google_campaign_id: string }) => p.google_campaign_id))
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
    user_profiles: userProfiles.data ?? [],
    rls_policies_on_key_tables: policies ?? 'cannot read pg_policies via API',
    verdict:
      projectsWithCampaignId.length === 0
        ? 'ISSUE: No projects have google_campaign_id set'
        : matchingPairs.length === 0
          ? 'ISSUE: Projects have campaign IDs but none match ad_spend in this range'
          : 'OK: Server-side data matches. Issue is client-side RLS or role loading.',
    action:
      matchingPairs.length > 0
        ? 'Run this SQL in Supabase SQL editor to check RLS: SELECT get_user_role(); SELECT rolname FROM pg_roles; SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN (\'projects\',\'ad_spend\');'
        : 'Map campaigns to projects at /admin/integrations',
  })
}
