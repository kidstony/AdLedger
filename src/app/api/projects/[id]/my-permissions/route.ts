import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { ACCESS_LEVEL_DEFAULTS, SharePermissionId, SharePermissions } from '@/lib/types'

const ALL_PERMISSIONS: SharePermissionId[] = [
  'view_revenue', 'view_profit', 'view_adspend',
  'input_revenue', 'input_expense', 'confirm_payment',
]

// GET /api/projects/[id]/my-permissions — quyền của user hiện tại với dự án này
// Super admin/manager: trả về tất cả true
// Member: tính từ project_shares + project_share_permissions
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: project_id } = await params

  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Super admin — full quyền
  if (caller.role === 'super_admin') {
    return NextResponse.json(ACCESS_LEVEL_DEFAULTS.editor)
  }

  // Manager của team sở hữu dự án — full quyền
  if (caller.role === 'manager') {
    const { data: project } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (project?.team_id === caller.team_id)
      return NextResponse.json(ACCESS_LEVEL_DEFAULTS.editor)
    // Manager của team khác → không có quyền
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Member — tính từ project_shares
  const { data: share } = await supabaseAdmin
    .from('project_shares')
    .select('id, access_level')
    .eq('project_id', project_id)
    .eq('user_id', caller.user_id)
    .single()

  if (!share) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const defaults = ACCESS_LEVEL_DEFAULTS[share.access_level as keyof typeof ACCESS_LEVEL_DEFAULTS]

  // Lấy custom overrides
  const { data: customPerms } = await supabaseAdmin
    .from('project_share_permissions')
    .select('permission_id, granted')
    .eq('share_id', share.id)

  const overrideMap = new Map((customPerms ?? []).map(p => [p.permission_id, p.granted]))

  const permissions = ALL_PERMISSIONS.reduce((acc, pid) => {
    acc[pid] = overrideMap.has(pid) ? (overrideMap.get(pid) as boolean) : defaults[pid]
    return acc
  }, {} as SharePermissions)

  return NextResponse.json(permissions)
}
