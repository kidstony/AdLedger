import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers()
  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  const { data: profiles } = await supabaseAdmin.from('user_profiles').select('*')
  const profileMap = new Map((profiles ?? []).map((p: { user_id: string; full_name: string; role: string }) => [p.user_id, p]))

  const users = authData.users.map(u => ({
    user_id: u.id,
    email: u.email ?? '',
    full_name: profileMap.get(u.id)?.full_name ?? '',
    role: profileMap.get(u.id)?.role ?? 'employee',
  }))

  return NextResponse.json(users)
}
