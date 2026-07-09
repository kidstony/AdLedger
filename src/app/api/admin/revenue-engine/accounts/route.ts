import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Quản lý tài khoản Engine (engine_accounts): định nghĩa tài khoản/ref của mỗi
// network và gán về dự án. Login/profile vẫn chạy cục bộ trên máy engine.
const ALLOWED = ['super_admin', 'manager']
const SLUG = /^[a-z0-9_-]+$/i
const ACCOUNT_COLS = 'id, network_id, account_id, label, project_id, enabled, dashboard_url, login_url, login_status, last_login_at, created_at'

async function guard(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return null
  return caller
}

export async function GET(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Nguồn network cho dropdown = affiliate_networks (Quản lý dự án). Slug NULL →
  // network_id null → client hiển thị mờ (chưa có slug engine).
  let netQuery = supabaseAdmin
    .from('affiliate_networks')
    .select('id, name, color, slug')
    .order('name')
  if (caller.organization_id) netQuery = netQuery.eq('organization_id', caller.organization_id)

  const [accounts, networks, projects, cfgs] = await Promise.all([
    supabaseAdmin.from('engine_accounts')
      .select(ACCOUNT_COLS)
      .order('network_id').order('account_id'),
    netQuery,
    supabaseAdmin.from('projects').select('project_id, name, affiliate_network').order('name'),
    supabaseAdmin.from('engine_network_configs').select('network_id').eq('enabled', true),
  ])
  if (accounts.error) return NextResponse.json({ error: accounts.error.message }, { status: 500 })

  // Network đã có config engine (DB) — file config (tolt/blancvpn) coi như luôn có.
  const configured = [...new Set([...(cfgs.data ?? []).map(c => c.network_id), 'tolt', 'blancvpn'])]

  return NextResponse.json({
    accounts: accounts.data ?? [],
    networks: (networks.data ?? []).map(n => ({
      id: n.id,
      network_id: n.slug ?? null,
      network_name: n.name,
      color: n.color,
    })),
    projects: projects.data ?? [],
    configured,
  })
}

// Tự sinh account_id theo quy ước: account đầu = network_id, sau đó network_id_2,
// _3… (lấy ứng viên đầu tiên chưa dùng). account_id là tên thư mục profile Chrome
// nên phải slug-safe.
async function nextAccountId(network_id: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('engine_accounts')
    .select('account_id')
    .eq('network_id', network_id)
  const taken = new Set((data ?? []).map(r => r.account_id))
  let candidate = network_id
  let n = 2
  while (taken.has(candidate)) candidate = `${network_id}_${n++}`
  return candidate
}

export async function POST(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const network_id = String(body?.network_id ?? '').trim()
  const project_id = body?.project_id ? String(body.project_id) : null
  const dashboard_url = body?.dashboard_url ? String(body.dashboard_url).trim() : null
  const login_url = body?.login_url ? String(body.login_url).trim() : null

  if (!network_id) return NextResponse.json({ error: 'Thiếu network' }, { status: 400 })

  // account_id được sinh tự động; thử lại 1 lần nếu bị đua (unique 23505).
  for (let attempt = 0; attempt < 2; attempt++) {
    const account_id = await nextAccountId(network_id)
    if (!SLUG.test(account_id)) {
      return NextResponse.json({ error: 'Không sinh được account_id hợp lệ (network_id chứa ký tự lạ)' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('engine_accounts')
      .insert({ network_id, account_id, label: account_id, project_id, dashboard_url, login_url, created_by: caller.user_id })
      .select(ACCOUNT_COLS)
      .single()

    if (!error) return NextResponse.json({ account: data })
    if (error.code === '23505' && attempt === 0) continue // đua slug — tính lại
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ error: 'Không tạo được tài khoản, thử lại' }, { status: 409 })
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
  if (body.dashboard_url !== undefined) patch.dashboard_url = body.dashboard_url ? String(body.dashboard_url).trim() : null
  if (body.login_url !== undefined) patch.login_url = body.login_url ? String(body.login_url).trim() : null

  const { data, error } = await supabaseAdmin
    .from('engine_accounts')
    .update(patch)
    .eq('id', id)
    .select(ACCOUNT_COLS)
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
