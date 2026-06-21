import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function DELETE(req: Request) {
  const { user_id } = await req.json()

  await supabaseAdmin.from('project_assignments').delete().eq('user_id', user_id)
  await supabaseAdmin.from('user_profiles').delete().eq('user_id', user_id)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
