import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Theo dõi Revenue Fetch Engine: các lần chạy gần nhất, cảnh báo đang mở,
// và tóm tắt dữ liệu staging revenue_raw theo từng network.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 50 lần chạy gần nhất
  const { data: runs, error: runsErr } = await supabaseAdmin
    .from('engine_runs')
    .select('id, network_id, status, date_from, date_to, records_captured, records_mapped, records_upserted, error_type, error_message, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(50)
  if (runsErr) return NextResponse.json({ error: runsErr.message }, { status: 500 })

  // Cảnh báo đang mở
  const { data: alerts, error: alertsErr } = await supabaseAdmin
    .from('engine_alerts')
    .select('id, network_id, error_type, message, occurrences, first_seen, last_seen')
    .eq('status', 'open')
    .order('last_seen', { ascending: false })
  if (alertsErr) return NextResponse.json({ error: alertsErr.message }, { status: 500 })

  // revenue_raw theo (dự án, tài khoản, ngày). Mỗi tài khoản ~30-60 dòng nên gộp trong JS.
  const { data: rawRows, error: rawErr } = await supabaseAdmin
    .from('revenue_raw')
    .select('network_id, account_id, account_label, project_id, date, revenue, revenue_usd, currency, fetched_at')
    .order('date', { ascending: false })
    .limit(5000)
  if (rawErr) return NextResponse.json({ error: rawErr.message }, { status: 500 })

  // Tên dự án để hiển thị (project_id → name)
  const { data: projects } = await supabaseAdmin.from('projects').select('project_id, name')
  const projectName = new Map((projects ?? []).map((p) => [p.project_id, p.name]))

  // Gom theo (project_id, account_id, date): mỗi ngày có thể chia trên nhiều offer nên sum revenue.
  const dayMap = new Map<string, {
    project_id: string | null
    project_name: string
    network_id: string
    account_id: string
    account_label: string
    date: string
    revenue: number
    revenue_usd: number | null
    currency: string
    rows: number
    last_fetched: string
  }>()
  for (const r of rawRows ?? []) {
    const accountId = r.account_id ?? r.network_id
    const projectId = r.project_id ?? null
    const key = `${projectId ?? '∅'}|${accountId}|${r.date}`
    const s = dayMap.get(key) ?? {
      project_id: projectId,
      project_name: projectId ? (projectName.get(projectId) ?? projectId) : 'Chưa gán dự án',
      network_id: r.network_id,
      account_id: accountId,
      account_label: r.account_label ?? accountId,
      date: r.date,
      revenue: 0,
      revenue_usd: null,
      currency: r.currency ?? '',
      rows: 0,
      last_fetched: r.fetched_at,
    }
    s.rows += 1
    s.revenue += Number(r.revenue) || 0
    // revenue_usd có thể null (lần fetch chưa lấy được tỷ giá) → chỉ cộng khi có số.
    if (r.revenue_usd != null) s.revenue_usd = (s.revenue_usd ?? 0) + Number(r.revenue_usd)
    if (r.fetched_at > s.last_fetched) s.last_fetched = r.fetched_at
    dayMap.set(key, s)
  }

  return NextResponse.json({
    runs: runs ?? [],
    alerts: alerts ?? [],
    days: [...dayMap.values()].sort((a, b) =>
      a.project_name.localeCompare(b.project_name) ||
      a.account_label.localeCompare(b.account_label) ||
      b.date.localeCompare(a.date)),
  })
}
