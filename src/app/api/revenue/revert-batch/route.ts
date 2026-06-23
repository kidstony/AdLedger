import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface Item { project_id: string; date: string }

export async function POST(req: NextRequest) {
  const { items } = await req.json()

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
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

  console.log(`[revert-batch] Deleted ${items.length} confirmed rows:`, items)
  return NextResponse.json({ success: true, count: items.length })
}
