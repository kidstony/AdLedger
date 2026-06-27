import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { memberCanDo } from '@/lib/check-member-permission'

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project_id, date, amount } = await req.json()

  if (!project_id || !date) {
    return NextResponse.json({ error: 'project_id and date required' }, { status: 400 })
  }

  if (caller.role === 'member') {
    const allowed = await memberCanDo(caller.user_id, project_id, 'confirm_payment')
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const confirmedAt = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .upsert(
      { project_id, date, type: 'confirmed', amount: amount ?? 0, confirmed_at: confirmedAt },
      { onConflict: 'project_id,date,type' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, confirmed_at: confirmedAt })
}
