import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function DELETE(req: Request) {
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { user_id } = await req.json()

  await supabaseAdmin.from('project_members').delete().eq('user_id', user_id)
  await supabaseAdmin.from('project_assignments').delete().eq('user_id', user_id)
  await supabaseAdmin.from('user_profiles').delete().eq('user_id', user_id)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
