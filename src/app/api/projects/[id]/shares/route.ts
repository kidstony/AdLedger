import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { ACCESS_LEVEL_DEFAULTS, ShareAccessLevel, SharePermissionId } from '@/lib/types'

// GET /api/projects/[id]/shares — list tất cả shares của dự án
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params

  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role === 'member') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Manager chỉ xem dự án của team mình
  if (caller.role === 'manager') {
    const { data: project } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (project?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: shares, error } = await supabaseAdmin
    .from('project_shares')
    .select('id, project_id, user_id, shared_by, access_level, created_at')
    .eq('project_id', project_id)
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!shares?.length) return NextResponse.json([])

  // Enrich với user_profiles
  const userIds = shares.map(s => s.user_id)
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, email, role')
    .in('user_id', userIds)

  const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]))

  // Enrich với custom permissions
  const shareIds = shares.map(s => s.id)
  const { data: customPerms } = await supabaseAdmin
    .from('project_share_permissions')
    .select('share_id, permission_id, granted')
    .in('share_id', shareIds)

  const permsByShareId = new Map<string, Array<{ permission_id: string; granted: boolean }>>()
  for (const perm of customPerms ?? []) {
    if (!permsByShareId.has(perm.share_id)) permsByShareId.set(perm.share_id, [])
    permsByShareId.get(perm.share_id)!.push({ permission_id: perm.permission_id, granted: perm.granted })
  }

  const result = shares.map(s => ({
    ...s,
    user_profile: profileMap.get(s.user_id) ?? null,
    custom_permissions: permsByShareId.get(s.id) ?? [],
  }))

  return NextResponse.json(result)
}

// POST /api/projects/[id]/shares — thêm share mới
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params

  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role === 'member') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Manager chỉ chia sẻ dự án của team mình
  if (caller.role === 'manager') {
    const { data: project } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (project?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body: {
    user_ids: string[]
    access_level: ShareAccessLevel
    custom_permissions?: Record<SharePermissionId, boolean>
  } = await req.json()

  const { user_ids, access_level, custom_permissions } = body
  if (!user_ids?.length || !access_level)
    return NextResponse.json({ error: 'user_ids và access_level là bắt buộc' }, { status: 400 })

  const validLevels: ShareAccessLevel[] = ['viewer', 'reporter', 'editor']
  if (!validLevels.includes(access_level))
    return NextResponse.json({ error: 'access_level không hợp lệ' }, { status: 400 })

  // Upsert shares
  const rows = user_ids.map(uid => ({
    project_id,
    user_id: uid,
    shared_by: caller.user_id,
    access_level,
  }))

  const { data: inserted, error } = await supabaseAdmin
    .from('project_shares')
    .upsert(rows, { onConflict: 'project_id,user_id' })
    .select('id, user_id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Nếu có custom_permissions, upsert chúng
  if (custom_permissions && inserted?.length) {
    const defaults = ACCESS_LEVEL_DEFAULTS[access_level]
    const permRows = inserted.flatMap(share =>
      (Object.keys(custom_permissions) as SharePermissionId[])
        .filter(pid => custom_permissions[pid] !== defaults[pid])
        .map(pid => ({
          share_id:      share.id,
          permission_id: pid,
          granted:       custom_permissions[pid],
        }))
    )
    if (permRows.length) {
      const { error: permErr } = await supabaseAdmin
        .from('project_share_permissions')
        .upsert(permRows, { onConflict: 'share_id,permission_id' })
      if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, count: inserted?.length ?? 0 })
}
