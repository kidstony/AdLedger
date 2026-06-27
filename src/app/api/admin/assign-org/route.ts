import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin' || caller.organization_id !== null)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { type, id, organization_id } = await req.json()

  if (type === 'user') {
    const { error } = await supabaseAdmin
      .from('user_profiles').update({ organization_id }).eq('user_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (type === 'team') {
    const { error } = await supabaseAdmin
      .from('teams').update({ organization_id }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
