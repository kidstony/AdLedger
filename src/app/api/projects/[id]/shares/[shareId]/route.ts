import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { ACCESS_LEVEL_DEFAULTS, ShareAccessLevel, SharePermissionId } from '@/lib/types'

async function authorizeManagerForProject(caller: { role: string; team_id: string | null }, project_id: string): Promise<boolean> {
  if (caller.role === 'super_admin') return true
  if (caller.role !== 'manager') return false
  const { data } = await supabaseAdmin
    .from('projects').select('team_id').eq('project_id', project_id).single()
  return data?.team_id === caller.team_id
}

// PATCH /api/projects/[id]/shares/[shareId] — đổi access_level và/hoặc custom permissions
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const { id: project_id, shareId } = await params

  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await authorizeManagerForProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Kiểm tra share tồn tại
  const { data: share } = await supabaseAdmin
    .from('project_shares').select('id, access_level').eq('id', shareId).eq('project_id', project_id).single()
  if (!share) return NextResponse.json({ error: 'Share không tồn tại' }, { status: 404 })

  const body: {
    access_level?: ShareAccessLevel
    custom_permissions?: Record<SharePermissionId, boolean>
  } = await req.json()

  const { access_level, custom_permissions } = body

  // Cập nhật access_level nếu có
  if (access_level) {
    const validLevels: ShareAccessLevel[] = ['viewer', 'reporter', 'editor']
    if (!validLevels.includes(access_level))
      return NextResponse.json({ error: 'access_level không hợp lệ' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('project_shares')
      .update({ access_level })
      .eq('id', shareId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Cập nhật custom permissions nếu có
  if (custom_permissions !== undefined) {
    const effectiveLevel = access_level ?? share.access_level
    const defaults = ACCESS_LEVEL_DEFAULTS[effectiveLevel as ShareAccessLevel]

    // Xóa tất cả custom permissions cũ trước
    await supabaseAdmin.from('project_share_permissions').delete().eq('share_id', shareId)

    // Chỉ lưu những permissions khác với default
    const permRows = (Object.keys(custom_permissions) as SharePermissionId[])
      .filter(pid => custom_permissions[pid] !== defaults[pid])
      .map(pid => ({ share_id: shareId, permission_id: pid, granted: custom_permissions[pid] }))

    if (permRows.length) {
      const { error: permErr } = await supabaseAdmin
        .from('project_share_permissions')
        .insert(permRows)
      if (permErr) return NextResponse.json({ error: permErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}

// DELETE /api/projects/[id]/shares/[shareId] — thu hồi share
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const { id: project_id, shareId } = await params

  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await authorizeManagerForProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // project_share_permissions sẽ bị xóa cascade tự động
  const { error } = await supabaseAdmin
    .from('project_shares')
    .delete()
    .eq('id', shareId)
    .eq('project_id', project_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
