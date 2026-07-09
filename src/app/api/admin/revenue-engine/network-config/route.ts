import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Config network engine lưu ở DB (engine_network_configs.config = JSONB cùng cấu
// trúc file configs/<slug>.json). Engine đọc DB trước, fallback file.
const ALLOWED = ['super_admin', 'manager']

async function guard(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return null
  return caller
}

export async function GET(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const network_id = new URL(req.url).searchParams.get('network_id')
  if (!network_id) return NextResponse.json({ error: 'Thiếu network_id' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('engine_network_configs')
    .select('network_id, config, enabled, updated_at')
    .eq('network_id', network_id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config: data ?? null })
}

export async function PUT(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const network_id = String(body?.network_id ?? '').trim()
  const config = body?.config
  if (!network_id) return NextResponse.json({ error: 'Thiếu network_id' }, { status: 400 })
  if (!config || typeof config !== 'object') return NextResponse.json({ error: 'config không hợp lệ' }, { status: 400 })

  // Đảm bảo config.network_id khớp (engine dùng làm khóa/slug profile).
  const cfg = { ...config, network_id }

  const { data, error } = await supabaseAdmin
    .from('engine_network_configs')
    .upsert({ network_id, config: cfg, enabled: body?.enabled !== false, updated_by: caller.user_id, updated_at: new Date().toISOString() }, { onConflict: 'network_id' })
    .select('network_id, config, enabled, updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ config: data })
}
