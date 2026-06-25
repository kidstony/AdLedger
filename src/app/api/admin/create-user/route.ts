import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function POST(req: Request) {
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { email, password, full_name, role, team_id, project_ids } = await req.json()

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) {
    const msg = (!error.message || error.message === '{}')
      ? 'Không thể tạo user. Kiểm tra email hợp lệ và mật khẩu đủ mạnh.'
      : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  await supabaseAdmin.from('user_profiles').upsert({
    user_id: data.user.id,
    full_name,
    role,
    team_id: team_id ?? null,
  })

  if (role === 'member' && Array.isArray(project_ids) && project_ids.length > 0) {
    await supabaseAdmin.from('project_members').insert(
      project_ids.map((pid: string) => ({ project_id: pid, user_id: data.user.id }))
    )
  }

  let team = null
  if (team_id) {
    const { data: teamData } = await supabaseAdmin
      .from('teams').select('id, name, color').eq('id', team_id).single()
    team = teamData ?? null
  }

  return NextResponse.json({
    user_id: data.user.id,
    email,
    full_name,
    role,
    team_id: team_id ?? null,
    team,
    email_confirmed: true,
    project_count: project_ids?.length ?? 0,
  })
}
