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

// "Org chính" (adoptive org) — org đứng tên phân tích cho các project CHƯA gán team,
// để việc đề xuất tối ưu KHÔNG phụ thuộc gán team. Chọn deterministic: org sở hữu
// nhiều dự-án-có-camp nhất (tie → id nhỏ nhất); không org nào có dự án → org đầu tiên.
// (optimizer_state/Telegram/ngưỡng đều key theo org nên project mồ côi cần 1 org đứng tên.)
export async function resolveAdoptiveOrg(): Promise<string | null> {
  const [projRes, teamRes, orgRes] = await Promise.all([
    supabaseAdmin.from('projects').select('team_id').not('google_campaign_id', 'is', null).not('team_id', 'is', null),
    supabaseAdmin.from('teams').select('id, organization_id'),
    supabaseAdmin.from('organizations').select('id').order('id').limit(1),
  ])
  const orgByTeam = new Map((teamRes.data ?? []).map(t => [t.id, t.organization_id as string | null]))
  const counts = new Map<string, number>()
  for (const p of projRes.data ?? []) {
    const org = orgByTeam.get(p.team_id)
    if (org) counts.set(org, (counts.get(org) ?? 0) + 1)
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return best?.[0] ?? orgRes.data?.[0]?.id ?? null
}

// Org SỞ HỮU project (project → team → organization) — dùng thay caller.organization_id
// khi đọc trạng thái optimizer (lastRunAt, rule_stats): Global Admin (org NULL) vẫn thấy
// đúng org của project. Project chưa gán team (orphan) → trả org chính (org nhận phân
// tích hộ) để UI hiển thị đúng trạng thái; orphan=true để UI hiện ghi chú nên gán team.
export async function resolveProjectOrg(projectId: string): Promise<{ organizationId: string | null; orphan: boolean }> {
  const { data: proj } = await supabaseAdmin
    .from('projects').select('team_id').eq('project_id', projectId).maybeSingle()
  if (!proj?.team_id) return { organizationId: await resolveAdoptiveOrg(), orphan: true }
  const { data: team } = await supabaseAdmin
    .from('teams').select('organization_id').eq('id', proj.team_id).maybeSingle()
  return { organizationId: team?.organization_id ?? null, orphan: false }
}
