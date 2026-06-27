import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function PATCH(req: Request) {
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { user_id, role, team_id, full_name, password } = await req.json()

  const profileUpdate: Record<string, unknown> = {}
  if (role !== undefined) profileUpdate.role = role
  if (team_id !== undefined) profileUpdate.team_id = team_id ?? null
  if (full_name !== undefined) profileUpdate.full_name = full_name

  if (Object.keys(profileUpdate).length > 0) {
    const { error } = await supabaseAdmin
      .from('user_profiles')
      .update(profileUpdate)
      .eq('user_id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  if (password) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
