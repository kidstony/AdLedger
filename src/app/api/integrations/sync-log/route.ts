import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') ?? '0'))
  const limit = 10

  let query = supabaseAdmin
    .from('sync_log')
    .select('id, synced_at, records, status, message')
    .order('synced_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1)

  if (caller.organization_id) {
    query = query.eq('organization_id', caller.organization_id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
