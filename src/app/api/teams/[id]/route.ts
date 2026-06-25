import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole, getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'super_admin' && caller.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (caller.role === 'manager' && caller.team_id !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: team, error } = await supabaseAdmin.from('teams').select('*').eq('id', id).single()
  if (error || !team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const { data: members } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, role, team_id')
    .eq('team_id', id)

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, team_id')
    .eq('team_id', id)
    .order('project_id')

  return NextResponse.json({ ...team, members: members ?? [], projects: projects ?? [] })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { name, color } = await req.json()

  const { data, error } = await supabaseAdmin
    .from('teams')
    .update({ name, color })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { data: members } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('team_id', id)

  const { data: projects } = await supabaseAdmin
    .from('projects')
    .select('project_id')
    .eq('team_id', id)

  if ((members ?? []).length > 0 || (projects ?? []).length > 0) {
    return NextResponse.json(
      { error: 'Vui lòng xóa hết thành viên và dự án trước khi xóa team' },
      { status: 400 }
    )
  }

  const { error } = await supabaseAdmin.from('teams').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
