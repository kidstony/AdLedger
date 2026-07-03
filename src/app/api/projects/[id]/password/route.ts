import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { decrypt } from '@/lib/crypto'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: proj } = await supabaseAdmin
    .from('projects')
    .select('team_id, person_in_charge, affiliate_password')
    .eq('project_id', project_id)
    .single()

  if (!proj) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (caller.role === 'manager' && proj.team_id !== caller.team_id)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (caller.role === 'member') {
    const { data: share } = await supabaseAdmin
      .from('project_shares').select('id').eq('project_id', project_id).eq('user_id', caller.user_id).maybeSingle()
    const hasAccess =
      (proj.team_id && proj.team_id === caller.team_id) ||
      !!share ||
      proj.person_in_charge === caller.user_id
    if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!proj.affiliate_password) return NextResponse.json({ password: null })

  let password: string
  try {
    password = decrypt(proj.affiliate_password)
  } catch {
    return NextResponse.json({ error: 'Decrypt failed' }, { status: 500 })
  }
  return NextResponse.json({ password })
}
