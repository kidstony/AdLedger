import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Quản lý tài khoản Engine (engine_accounts): định nghĩa tài khoản/ref của mỗi
// network và gán về dự án. Login/profile vẫn chạy cục bộ trên máy engine.
const ALLOWED = ['super_admin', 'manager']
const SLUG = /^[a-z0-9_-]+$/i

async function guard(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return null
  return caller
}

export async function GET(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [accounts, networks, projects] = await Promise.all([
    supabaseAdmin.from('engine_accounts')
      .select('id, network_id, account_id, label, project_id, enabled, created_at')
      .order('network_id').order('account_id'),
    supabaseAdmin.from('engine_networks').select('network_id, network_name').order('network_id'),
    supabaseAdmin.from('projects').select('project_id, name').order('name'),
  ])
  if (accounts.error) return NextResponse.json({ error: accounts.error.message }, { status: 500 })

  return NextResponse.json({
    accounts: accounts.data ?? [],
    networks: networks.data ?? [],
    projects: projects.data ?? [],
  })
}

export async function POST(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const network_id = String(body?.network_id ?? '').trim()
  const account_id = String(body?.account_id ?? '').trim()
  const label = String(body?.label ?? '').trim()
  const project_id = body?.project_id ? String(body.project_id) : null

  if (!network_id) return NextResponse.json({ error: 'Thiếu network' }, { status: 400 })
  if (!SLUG.test(account_id)) {
    return NextResponse.json({ error: 'account_id chỉ gồm chữ/số/_/- (dùng làm tên thư mục profile)' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('engine_accounts')
    .insert({ network_id, account_id, label: label || account_id, project_id, created_by: caller.user_id })
    .select('id, network_id, account_id, label, project_id, enabled, created_at')
    .single()
  if (error) {
    const msg = error.code === '23505' ? 'Tài khoản này đã tồn tại trong network' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ account: data })
}

export async function PATCH(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const id = body?.id ? String(body.id) : null
  if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.label !== undefined) patch.label = String(body.label).trim()
  if (body.project_id !== undefined) patch.project_id = body.project_id ? String(body.project_id) : null
  if (body.enabled !== undefined) patch.enabled = !!body.enabled

  const { data, error } = await supabaseAdmin
    .from('engine_accounts')
    .update(patch)
    .eq('id', id)
    .select('id, network_id, account_id, label, project_id, enabled, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ account: data })
}

export async function DELETE(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 })

  // Chỉ gỡ định nghĩa; dữ liệu revenue_raw đã fetch giữ nguyên.
  const { error } = await supabaseAdmin.from('engine_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
