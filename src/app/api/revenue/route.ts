import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('affiliate_revenue')
    .select('project_id, date, revenue, screen_revenue, note, payout_start_date, payout_end_date')
    .gte('date', from)
    .lte('date', to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const rows: { project_id: string; date: string; revenue: number; screen_revenue?: number }[] = body.rows ?? []

  if (rows.length === 0) return NextResponse.json({ success: true, count: 0 })

  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .upsert(rows, { onConflict: 'project_id,date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, count: rows.length })
}

// Partial update: note and/or payout dates only (does not touch revenue/screen_revenue)
export async function PATCH(req: NextRequest) {
  const { project_id, date, note, payout_start_date, payout_end_date } = await req.json()

  if (!project_id || !date) return NextResponse.json({ error: 'project_id and date required' }, { status: 400 })

  const fields: Record<string, string | null> = {}
  if (note !== undefined) fields.note = note ?? null
  if (payout_start_date !== undefined) fields.payout_start_date = payout_start_date ?? null
  if (payout_end_date !== undefined) fields.payout_end_date = payout_end_date ?? null

  if (Object.keys(fields).length === 0) return NextResponse.json({ success: true })

  // Upsert with defaults so the row is created if it doesn't exist yet
  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .upsert({ project_id, date, revenue: 0, screen_revenue: 0, ...fields }, { onConflict: 'project_id,date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
