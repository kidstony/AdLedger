import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0'))
  const limit = 10
  const { data, error } = await supabaseAdmin
    .from('sync_log')
    .select('id, synced_at, records, status, message')
    .order('synced_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
