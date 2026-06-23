import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { project_id, date } = await req.json()

  if (!project_id || !date) {
    return NextResponse.json({ error: 'project_id and date required' }, { status: 400 })
  }

  // Fetch current values to copy screen_revenue → revenue when revenue not yet set
  const { data: row } = await supabaseAdmin
    .from('affiliate_revenue')
    .select('revenue, screen_revenue')
    .eq('project_id', project_id)
    .eq('date', date)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'Row not found' }, { status: 404 })
  }

  const confirmedAt = new Date().toISOString()
  // Use existing revenue if already set, otherwise copy from screen_revenue
  const revenue = (row.revenue ?? 0) > 0 ? row.revenue : (row.screen_revenue ?? 0)

  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .update({ status: 'confirmed', confirmed_at: confirmedAt, revenue })
    .eq('project_id', project_id)
    .eq('date', date)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, confirmed_at: confirmedAt, revenue })
}
