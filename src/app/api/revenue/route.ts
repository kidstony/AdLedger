import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('affiliate_revenue')
    .select('project_id, date, revenue, screen_revenue')
    .gte('date', from)
    .lte('date', to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const rows: { project_id: string; date: string; revenue: number }[] = body.rows ?? []

  if (rows.length === 0) return NextResponse.json({ success: true, count: 0 })

  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .upsert(rows, { onConflict: 'project_id,date' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, count: rows.length })
}
