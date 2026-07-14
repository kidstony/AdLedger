import { supabaseAdmin } from '@/lib/supabase-admin'

// Kiểm quyền truy cập project cho các route Optimizer v2 — mirror /api/optimize:
// super_admin: theo org (RLS lo); manager: project thuộc team mình; member: có share.
export interface CallerLike {
  user_id: string
  role: string
  team_id?: string | null
  organization_id?: string | null
}

export async function canReadProject(caller: CallerLike, projectId: string): Promise<boolean> {
  if (caller.role === 'super_admin') return true
  if (caller.role === 'manager') {
    const { data: proj } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', projectId).single()
    return proj?.team_id === caller.team_id
  }
  const { data: share } = await supabaseAdmin
    .from('project_shares').select('id')
    .eq('project_id', projectId).eq('user_id', caller.user_id).maybeSingle()
  return !!share
}

// Ghi (đánh dấu áp dụng, sửa phiếu test, đổi ngưỡng): chỉ super_admin/manager.
export async function canWriteProject(caller: CallerLike, projectId: string): Promise<boolean> {
  if (caller.role === 'super_admin') return true
  if (caller.role === 'manager') return canReadProject(caller, projectId)
  return false
}
