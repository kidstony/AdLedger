import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

interface SpendRecord {
  cid: string
  date: string
  spend: number
}

export async function POST(req: NextRequest) {
  let body: { secret?: string; records?: SpendRecord[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.secret !== process.env.ADS_SCRIPT_SECRET) {
    await supabaseAdmin.from('sync_log').insert({
      records: 0,
      status: 'error',
      message: 'Invalid secret',
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const records: SpendRecord[] = body.records ?? []

  // Ping/health-check — empty records is valid
  if (records.length === 0) {
    return NextResponse.json({ success: true, count: 0, ping: true })
  }

  const rows = records.map(r => ({
    cid: r.cid,
    date: r.date,
    spend: Number(r.spend),
  }))

  const { error } = await supabaseAdmin
    .from('ad_spend')
    .upsert(rows, { onConflict: 'cid,date' })

  if (error) {
    await supabaseAdmin.from('sync_log').insert({
      records: 0,
      status: 'error',
      message: error.message,
    })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabaseAdmin.from('sync_log').insert({
    records: rows.length,
    status: 'success',
    message: null,
  })

  return NextResponse.json({ success: true, count: rows.length })
}
