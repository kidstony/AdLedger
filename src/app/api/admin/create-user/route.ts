import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: Request) {
  const { email, password, full_name, role } = await req.json()

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabaseAdmin.from('user_profiles').upsert({
    user_id: data.user.id,
    full_name,
    role,
  })

  return NextResponse.json({ user_id: data.user.id, email, full_name, role })
}
