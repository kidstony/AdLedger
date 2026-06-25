import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

const ROLE_ORDER: Record<string, number> = { super_admin: 0, manager: 1, member: 2 }

export async function GET(req: Request) {
  const authErr = await requireRole(req, ['super_admin', 'manager'])
  if (authErr) return authErr

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers()
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, role, team_id, teams(id, name, color)')

  const profileMap = new Map(
    (profiles ?? []).map((p: { user_id: string; full_name: string; role: string; team_id: string | null; teams: unknown }) => [p.user_id, p])
  )

  const { data: memberRows } = await supabaseAdmin.from('project_members').select('user_id')
  const assignCountMap = new Map<string, number>()
  memberRows?.forEach((a: { user_id: string }) => {
    assignCountMap.set(a.user_id, (assignCountMap.get(a.user_id) ?? 0) + 1)
  })

  const users = authData.users
    .map(u => {
      const profile = profileMap.get(u.id) as { user_id: string; full_name: string; role: string; team_id: string | null; teams: Record<string, string> | null } | undefined
      return {
        user_id:         u.id,
        email:           u.email ?? '',
        full_name:       profile?.full_name ?? '',
        role:            profile?.role ?? 'member',
        team_id:         profile?.team_id ?? null,
        team:            profile?.teams ?? null,
        email_confirmed: !!u.email_confirmed_at,
        project_count:   assignCountMap.get(u.id) ?? 0,
      }
    })
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3))

  return NextResponse.json(users)
}
