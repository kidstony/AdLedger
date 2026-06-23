import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface Item { project_id: string; date: string; amount: number }

export async function POST(req: NextRequest) {
  const { items } = await req.json()

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 })
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
