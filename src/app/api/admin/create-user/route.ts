import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, password, full_name, role: requestedRole, team_id: requestedTeamId, project_ids, organization_id: requestedOrgId } = await req.json()

  let role = requestedRole
  let team_id = requestedTeamId
  let organization_id: string | null = null

  if (caller.role === 'manager') {
    if (requestedRole !== 'member') {
      return NextResponse.json({ error: 'Manager chỉ có thể tạo tài khoản Member' }, { status: 403 })
    }
    team_id = caller.team_id
    role = 'member'
  } else {
    if (role === 'super_admin') {
      organization_id = caller.organization_id ?? requestedOrgId ?? null
      if (!organization_id) {
        return NextResponse.json(
          { error: 'Global Admin chỉ được tạo qua seed script, không thể tạo qua UI' },
          { status: 403 }
        )
      }
    } else {
      organization_id = caller.organization_id ?? null
    }
  }

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
    organization_id,
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
