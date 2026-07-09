import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Cài đặt auto-sync (worker tự fetch định kỳ). Singleton row id=1.
const ALLOWED = ['super_admin', 'manager']

async function guard(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return null
  return caller
}

export async function GET(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await supabaseAdmin
    .from('engine_settings')
    .select('auto_sync_enabled, interval_hours, last_auto_sync_at')
    .eq('id', 1).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data ?? { auto_sync_enabled: false, interval_hours: 6, last_auto_sync_at: null } })
}

export async function PUT(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body?.auto_sync_enabled !== undefined) patch.auto_sync_enabled = !!body.auto_sync_enabled
  if (body?.interval_hours !== undefined) {
    const h = Number(body.interval_hours)
    if (!Number.isFinite(h) || h < 0.5 || h > 168) return NextResponse.json({ error: 'interval_hours phải trong khoảng 0.5–168' }, { status: 400 })
    patch.interval_hours = h
  }

  const { data, error } = await supabaseAdmin
    .from('engine_settings')
    .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    .select('auto_sync_enabled, interval_hours, last_auto_sync_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ settings: data })
}
