import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { memberCanDo } from '@/lib/check-member-permission'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) return NextResponse.json({ error: 'from and to required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('affiliate_revenue')
    .select('project_id, date, type, amount, note, payout_start_date, payout_end_date, confirmed_at')
    .gte('date', from)
    .lte('date', to)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const rows: { project_id: string; date: string; type: 'confirmed' | 'pending'; amount: number }[] = body.rows ?? []

  if (rows.length === 0) return NextResponse.json({ success: true, count: 0 })

  if (caller.role === 'member') {
    const uniqueProjectIds = [...new Set(rows.map(r => r.project_id))]
    for (const projectId of uniqueProjectIds) {
      const allowed = await memberCanDo(caller.user_id, projectId, 'input_revenue')
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const toDelete = rows.filter(r => r.amount === 0)
  const toUpsert = rows.filter(r => r.amount > 0)

  if (toDelete.length > 0) {
    const deleteResults = await Promise.all(
      toDelete.map(r =>
        supabaseAdmin
          .from('affiliate_revenue')
          .delete()
          .eq('project_id', r.project_id)
          .eq('date', r.date)
          .eq('type', r.type)
      )
    )
    const deleteFailed = deleteResults.filter(r => r.error)
    if (deleteFailed.length > 0) {
      console.error('[POST /api/revenue] delete errors:', deleteFailed.map(r => r.error))
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await supabaseAdmin
      .from('affiliate_revenue')
      .upsert(toUpsert, { onConflict: 'project_id,date,type' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, count: rows.length })
}

export async function PATCH(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { project_id, date, type = 'pending', note, payout_start_date, payout_end_date } = await req.json()

  if (!project_id || !date) return NextResponse.json({ error: 'project_id and date required' }, { status: 400 })

  if (caller.role === 'member') {
    const allowed = await memberCanDo(caller.user_id, project_id, 'input_revenue')
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const fields: Record<string, string | null> = {}
  if (note !== undefined) fields.note = note ?? null
  if (payout_start_date !== undefined) fields.payout_start_date = payout_start_date ?? null
  if (payout_end_date !== undefined) fields.payout_end_date = payout_end_date ?? null

  if (Object.keys(fields).length === 0) return NextResponse.json({ success: true })

  const { error } = await supabaseAdmin
    .from('affiliate_revenue')
    .update(fields)
    .eq('project_id', project_id)
    .eq('date', date)
    .eq('type', type)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
