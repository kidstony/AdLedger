import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { memberCanDo } from '@/lib/check-member-permission'

interface Item { project_id: string; date: string }

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

  const results = await Promise.all(
    (items as Item[]).map(({ project_id, date }) =>
      supabaseAdmin
        .from('affiliate_revenue')
        .delete()
        .eq('project_id', project_id)
        .eq('date', date)
        .eq('type', 'confirmed')
    )
  )

  const failed = results.filter(r => r.error)
  if (failed.length > 0) {
    console.error('[revert-batch] Supabase errors:', failed.map(r => r.error))
    return NextResponse.json({ error: 'Some reverts failed', failed: failed.length }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: items.length })
}
