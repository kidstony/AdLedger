import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { memberCanDo } from '@/lib/check-member-permission'

interface Item { project_id: string; date: string; amount: number }

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { items } = await req.json()

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  if (caller.role === 'member') {
    const uniqueProjectIds = [...new Set((items as Item[]).map(i => i.project_id))]
    for (const projectId of uniqueProjectIds) {
      const allowed = await memberCanDo(caller.user_id, projectId, 'confirm_payment')
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const confirmedAt = new Date().toISOString()
  const rows = (items as Item[]).map(({ project_id, date, amount }) => ({
    project_id,
    date,
    type: 'confirmed' as const,
    amount: amount ?? 0,
    confirmed_at: confirmedAt,
  }))

  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .upsert(rows, { onConflict: 'project_id,date,type' })

  if (error) {
    console.error('[confirm-batch] Supabase error:', error)
    return NextResponse.json({ error: 'Some updates failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: items.length, confirmed_at: confirmedAt })
}
