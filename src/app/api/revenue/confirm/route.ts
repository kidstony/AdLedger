import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const { project_id, date, amount } = await req.json()

  if (!project_id || !date) {
    return NextResponse.json({ error: 'project_id and date required' }, { status: 400 })
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
