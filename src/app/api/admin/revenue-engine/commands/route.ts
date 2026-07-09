import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Hàng lệnh cho worker engine: admin tạo lệnh login/fetch, worker (máy luôn bật)
// poll & thực thi. GET trả lệnh gần đây để admin hiển thị trạng thái.
const ALLOWED = ['super_admin', 'manager']

async function guard(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return null
  return caller
}

export async function GET(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data, error } = await supabaseAdmin
    .from('engine_commands')
    .select('id, type, account_id, network_id, status, message, created_at, finished_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ commands: data ?? [] })
}

// Đặt tín hiệu cho lệnh (vd discover: user bấm "Phân tích" → signal='analyze').
export async function PATCH(req: Request) {
  if (!(await guard(req))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => null)
  const id = body?.id ? String(body.id) : null
  const signal = body?.signal ? String(body.signal) : null
  if (!id || !signal) return NextResponse.json({ error: 'Thiếu id/signal' }, { status: 400 })
  const { error } = await supabaseAdmin
    .from('engine_commands').update({ signal })
    .eq('id', id).in('status', ['pending', 'running'])
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const caller = await guard(req)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const type = String(body?.type ?? '')
  const account_id = body?.account_id ? String(body.account_id) : null
  const force = !!body?.force // login: xoá phiên cũ, buộc đăng nhập lại
  if (!['login', 'fetch', 'discover'].includes(type)) {
    return NextResponse.json({ error: 'type phải là login|fetch|discover' }, { status: 400 })
  }
  if (!account_id) return NextResponse.json({ error: 'Thiếu account_id' }, { status: 400 })

  // Lấy network_id + chặn lệnh trùng đang chờ/chạy cho cùng account.
  const { data: acct } = await supabaseAdmin
    .from('engine_accounts').select('network_id, dashboard_url').eq('id', account_id).single()
  if (!acct) return NextResponse.json({ error: 'Account không tồn tại' }, { status: 404 })
  if (!acct.dashboard_url) {
    return NextResponse.json({ error: 'Account chưa có URL dashboard — nhập URL trước khi kết nối' }, { status: 400 })
  }

  if (type === 'fetch') {
    // Fetch: tránh trùng (đồng bộ 2 lần cùng lúc vô nghĩa).
    const { data: dup } = await supabaseAdmin
      .from('engine_commands').select('id')
      .eq('account_id', account_id).eq('type', type).in('status', ['pending', 'running']).limit(1)
    if (dup && dup.length) return NextResponse.json({ error: 'Đã có lệnh đồng bộ đang chạy cho account này' }, { status: 409 })
  } else {
    // login/discover: "làm lại" → huỷ lệnh cũ cùng loại (kể cả mồ côi) rồi tạo mới.
    await supabaseAdmin.from('engine_commands')
      .update({ status: 'error', message: 'Thay bằng lệnh mới', finished_at: new Date().toISOString() })
      .eq('account_id', account_id).eq('type', type).in('status', ['pending', 'running'])
  }

  const { data, error } = await supabaseAdmin
    .from('engine_commands')
    .insert({ type, account_id, network_id: acct.network_id, force: type === 'login' ? force : false, created_by: caller.user_id })
    .select('id, type, account_id, network_id, status, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ command: data })
}
