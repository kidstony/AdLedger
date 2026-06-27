import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { ACCESS_LEVEL_DEFAULTS, ShareAccessLevel, SharePermissionId, SharePermissions } from '@/lib/types'

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

  const [{ data: memberRows }, { data: projectRows }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, full_name, role').eq('team_id', id).order('full_name'),
    supabaseAdmin.from('projects').select('project_id, name').eq('team_id', id).order('project_id'),
  ])

  const members = memberRows ?? []
  const projects = projectRows ?? []

  if (!members.length || !projects.length) {
    return NextResponse.json({ members, projects, shares: [] })
  }

  const memberIds = members.map(m => m.user_id)
  const projectIds = projects.map(p => p.project_id)

  // Get emails from auth
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers()
  const emailMap = new Map(
    (authData?.users ?? [])
      .filter(u => memberIds.includes(u.id))
      .map(u => [u.id, u.email ?? ''])
  )

  const membersWithEmail = members.map(m => ({
    ...m,
    email: emailMap.get(m.user_id) ?? '',
  }))

  // Get shares for team members × team projects
  const { data: shareRows } = await supabaseAdmin
    .from('project_shares')
    .select('id, user_id, project_id, access_level')
    .in('user_id', memberIds)
    .in('project_id', projectIds)

  const shares = shareRows ?? []

  if (!shares.length) {
    return NextResponse.json({ members: membersWithEmail, projects, shares: [] })
  }

  const shareIds = shares.map(s => s.id)
  const { data: customPerms } = await supabaseAdmin
    .from('project_share_permissions')
    .select('share_id, permission_id, granted')
    .in('share_id', shareIds)

  const permsByShareId = new Map<string, Map<string, boolean>>()
  for (const p of customPerms ?? []) {
    if (!permsByShareId.has(p.share_id)) permsByShareId.set(p.share_id, new Map())
    permsByShareId.get(p.share_id)!.set(p.permission_id, p.granted)
  }

  const result = shares.map(s => {
    const defaults = ACCESS_LEVEL_DEFAULTS[s.access_level as ShareAccessLevel]
    const overrides = permsByShareId.get(s.id) ?? new Map<string, boolean>()
    const effective: SharePermissions = { ...defaults }
    for (const pid of Object.keys(defaults) as SharePermissionId[]) {
      if (overrides.has(pid)) effective[pid] = overrides.get(pid)!
    }
    return {
      user_id: s.user_id,
      project_id: s.project_id,
      share_id: s.id,
      access_level: s.access_level as ShareAccessLevel,
      effective_permissions: effective,
    }
  })

  return NextResponse.json({ members: membersWithEmail, projects, shares: result })
}
