import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface Item { project_id: string; date: string }

export async function POST(req: NextRequest) {
  const { items } = await req.json()

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
  }

  const confirmedAt = new Date().toISOString()
  const projectIds = [...new Set((items as Item[]).map(i => i.project_id))]

  // Fetch current values to copy screen_revenue → revenue when revenue not yet set
  const { data: existing } = await supabaseAdmin
    .from('affiliate_revenue')
    .select('project_id, date, revenue, screen_revenue')
    .in('project_id', projectIds)

  const results = await Promise.all(
    (items as Item[]).map(({ project_id, date }) => {
      const ex = existing?.find(r => r.project_id === project_id && r.date === date)
      const revenue = (ex?.revenue ?? 0) > 0 ? ex!.revenue : (ex?.screen_revenue ?? 0)
      return supabaseAdmin
        .from('affiliate_revenue')
        .update({ status: 'confirmed', confirmed_at: confirmedAt, revenue })
        .eq('project_id', project_id)
        .eq('date', date)
    })
  )

  const failed = results.filter(r => r.error)
  if (failed.length > 0) {
    return NextResponse.json({ error: 'Some updates failed', failed: failed.length }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: items.length, confirmed_at: confirmedAt })
}
