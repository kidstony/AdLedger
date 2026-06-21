import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function PATCH(req: Request) {
  const { user_id, role } = await req.json()

  const { error } = await supabaseAdmin
    .from('user_profiles')
    .update({ role })
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
