import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let query = supabaseAdmin.from('teams').select('*').order('created_at')
  if (caller.organization_id) {
    query = query.eq('organization_id', caller.organization_id)
  }

  const { data: teams, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, role, team_id')

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('project_id, team_id')

  const teamsWithCounts = (teams ?? []).map((t: { id: string; name: string; color: string; created_at: string }) => {
    const members = (profiles ?? []).filter((p: { team_id: string | null }) => p.team_id === t.id)
    const manager = members.find((p: { role: string }) => p.role === 'manager')
    const projectCount = (projects ?? []).filter((p: { team_id: string | null }) => p.team_id === t.id).length
    return {
      ...t,
      member_count: members.length,
      project_count: projectCount,
      manager_name: (manager as { full_name?: string } | undefined)?.full_name ?? null,
    }
  })

  return NextResponse.json(teamsWithCounts)
}

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, color, manager_id, organization_id } = await req.json()
  const orgId = caller.organization_id ?? organization_id ?? null

  const { data, error } = await supabaseAdmin
    .from('teams')
    .insert({ name, color: color ?? '#6b7280', organization_id: orgId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (manager_id) {
    await supabaseAdmin
      .from('user_profiles')
      .update({ team_id: data.id, role: 'manager' })
      .eq('user_id', manager_id)
  }

  return NextResponse.json({ ...data, member_count: manager_id ? 1 : 0, project_count: 0, manager_name: null })
}
