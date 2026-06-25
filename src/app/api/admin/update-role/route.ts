import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function PATCH(req: Request) {
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { user_id, role, team_id } = await req.json()

  const update: Record<string, unknown> = { role }
  if (team_id !== undefined) update.team_id = team_id ?? null

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update(update)
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
