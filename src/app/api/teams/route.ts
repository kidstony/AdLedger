import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function GET(req: Request) {
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { data: teams, error } = await supabaseAdmin
    .from('teams')
    .select('*')
    .order('created_at')

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
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { name, color, manager_id } = await req.json()

  const { data, error } = await supabaseAdmin
    .from('teams')
    .insert({ name, color: color ?? '#6b7280' })
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
