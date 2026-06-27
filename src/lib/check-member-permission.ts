import { supabaseAdmin } from './supabase-admin'
import { ACCESS_LEVEL_DEFAULTS, ShareAccessLevel, SharePermissionId } from './types'

export async function memberCanDo(
  userId: string,
  projectId: string,
  permission: SharePermissionId
): Promise<boolean> {
  const { data: share } = await supabaseAdmin
    .from('project_shares')
    .select('id, access_level')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!share) return false

  const { data: custom } = await supabaseAdmin
    .from('project_share_permissions')
    .select('granted')
    .eq('share_id', share.id)
    .eq('permission_id', permission)
    .maybeSingle()

  if (custom !== null) return custom.granted

  const defaults = ACCESS_LEVEL_DEFAULTS[share.access_level as ShareAccessLevel]
  return defaults[permission] ?? false
}
