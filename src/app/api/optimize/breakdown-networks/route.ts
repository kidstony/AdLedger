import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { usdOf, pickRevenueType, BreakdownRow } from '@/lib/breakdown-revenue'

// Tab "Dữ liệu tối ưu Network" (trang Tối Ưu Camp): trạng thái pipeline BREAKDOWN per account —
// bật/tắt, có config chưa, lần chạy cuối (engine_runs kind='breakdown'), alert riêng
// (tag '<account>:breakdown'). Pipeline này ĐỘC LẬP hoàn toàn với pipeline doanh thu.
// Dữ liệu dạng engine-admin → chỉ super_admin/manager (khớp guard của commands/config API).
const ALLOWED = ['super_admin', 'manager']

interface ConfigReport { kind?: string; name?: string; date_mode?: string }

// Dòng revenue_breakdown đọc để tóm tắt (thêm date/fetched_at so với BreakdownRow gốc).
interface BdSummaryRow extends BreakdownRow {
  account_id: string
  report: string
  date: string
  fetched_at: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

// Tóm tắt dữ liệu breakdown đã thu của 1 account (gộp TẤT CẢ ngày). Ngữ nghĩa gộp theo NGUỒN:
//  • Snapshot report (date_mode='window_end' — vd Tolt geo/device): mỗi lần sync ghi 1 dòng/kỳ,
//    mỗi dòng = tổng-cả-kỳ → lấy SNAPSHOT NGÀY MỚI NHẤT (cộng nhiều ngày = chồng kỳ).
//  • Per-conversion report (mỗi dòng = chuyển đổi ngày thật — vd Localrent orders, proxy-seller):
//    CỘNG mọi ngày. giờ/sub luôn per-conversion → cộng hết.
// snapshotReports = tên các report dùng window_end của network này.
function summarize(rows: BdSummaryRow[], snapshotReports: Set<string>) {
  if (rows.length === 0) return null
  const type = pickRevenueType(rows)
  const typed = rows.filter(r => r.revenue_type === type)

  let lastFetched = ''
  let minDate = '', maxDate = ''
  const hourArr = new Array(24).fill(0)
  let hasHour = false, hourUsd = 0, hourSubUsd = 0

  for (const r of typed) {
    if (r.fetched_at > lastFetched) lastFetched = r.fetched_at
    if (!minDate || r.date < minDate) minDate = r.date
    if (!maxDate || r.date > maxDate) maxDate = r.date
    const usd = usdOf(r)
    if (usd == null) continue
    // Giờ: per-conversion (date thật), cộng mọi ngày — snapshot report có hour=-1 nên không góp.
    if (r.hour >= 0) { hourArr[r.hour] += usd; hourUsd += usd; if (r.sub_id) hourSubUsd += usd; hasHour = true }
  }

  // Gộp 1 chiều (country|device), LẤY TỪ ĐÚNG MỘT REPORT NGUỒN — nếu network báo cùng chiều ở nhiều
  // report (đo 1 khoản theo nhiều cách) thì chỉ đếm 1 lần, không phình gấp đôi. Trả { byDim, dimTotal }
  // — dimTotal là "tổng thật" của chiều (mẫu số %; dư ra → 'Nước khác'/không rõ).
  const aggDim = (dim: 'country' | 'device') => {
    const byDim = new Map<string, number>()
    // Report nguồn = report phủ chiều đầy đủ nhất (tổng usd các dòng CÓ chiều lớn nhất). Không tên-cứng.
    const reportsWithDim = [...new Set(typed.filter(r => r[dim]).map(r => r.report))]
    if (reportsWithDim.length === 0) return { byDim, dimTotal: 0 }
    let src = reportsWithDim[0], bestCov = -1
    for (const rep of reportsWithDim) {
      const cov = typed.filter(r => r.report === rep && r[dim]).reduce((s, r) => s + (usdOf(r) ?? 0), 0)
      if (cov > bestCov) { bestCov = cov; src = rep }
    }
    const srcRows = typed.filter(r => r.report === src)

    if (snapshotReports.has(src)) {
      // Snapshot: chỉ ngày mới nhất của report nguồn (mỗi dòng = tổng-cả-kỳ; cộng nhiều ngày = chồng kỳ).
      const latest = srcRows.filter(r => r[dim]).map(r => r.date).reduce((a, b) => (a > b ? a : b))
      let allUsd = 0
      for (const r of srcRows) {
        if (r.date !== latest) continue
        const usd = usdOf(r); if (usd == null) continue
        if (r[dim]) byDim.set(r[dim] as string, (byDim.get(r[dim] as string) ?? 0) + usd)
        // Dòng "All" (country=''&device=''&hour<0) = tổng thật kỳ (nguồn geo bị cap top-N nước).
        else if (!r.country && !r.device && r.hour < 0 && usd > allUsd) allUsd = usd
      }
      const sum = [...byDim.values()].filter(u => u > 0).reduce((s, u) => s + u, 0)
      return { byDim, dimTotal: Math.max(allUsd, sum) }
    }
    // Per-conversion: CỘNG mọi ngày của report nguồn. dimTotal = tổng usd MỌI dòng của report
    // (kể cả dòng thiếu chiều → phần dư = 'Nước khác'/không rõ).
    let total = 0
    for (const r of srcRows) {
      const usd = usdOf(r); if (usd == null) continue
      total += usd
      if (r[dim]) byDim.set(r[dim] as string, (byDim.get(r[dim] as string) ?? 0) + usd)
    }
    return { byDim, dimTotal: total }
  }

  const { byDim: byCountry, dimTotal: countryTotal } = aggDim('country')
  const { byDim: byDevice } = aggDim('device')

  // Bỏ dòng 0đ (thiết bị 'Unknown'/nước không phát sinh doanh thu) — không cần hiển thị "0%".
  const deviceTotal = [...byDevice.values()].filter(u => u > 0).reduce((s, u) => s + u, 0)
  const sumCountry = [...byCountry.values()].filter(u => u > 0).reduce((s, u) => s + u, 0)
  const countryDenom = countryTotal > 0 ? countryTotal : sumCountry
  const topEntries = [...byCountry.entries()].filter(([, u]) => u > 0).sort((a, b) => b[1] - a[1]).slice(0, 12)
  const shownSum = topEntries.reduce((s, [, u]) => s + u, 0)
  const topCountry = topEntries
    .map(([country, usd]) => ({ country, usd: round2(usd), pct: countryDenom > 0 ? Math.round((usd / countryDenom) * 100) : 0 }))
  // Doanh thu ngoài top nước hiển thị (server cap top-N, hoặc đơn không rõ quốc gia) → gộp "Nước khác".
  if (countryTotal > shownSum + 0.5 && topCountry.length > 0) {
    const other = countryTotal - shownSum
    topCountry.push({ country: '__other__', usd: round2(other), pct: countryDenom > 0 ? Math.round((other / countryDenom) * 100) : 0 })
  }
  const topDevice = [...byDevice.entries()].filter(([, u]) => u > 0).sort((a, b) => b[1] - a[1])
    .map(([device, usd]) => ({ device, usd: round2(usd), pct: deviceTotal > 0 ? Math.round((usd / deviceTotal) * 100) : 0 }))

  // totalUsd KHÔNG cộng chéo các chiều: giờ/quốc gia/thiết bị đo CÙNG khoản doanh thu theo 3 chiều
  // → cộng lại là đếm trùng. Lấy chiều CÓ TỔNG LỚN NHẤT (đầy đủ nhất) làm "tổng doanh thu breakdown".
  const totalUsd = Math.max(hourUsd, countryTotal, deviceTotal, sumCountry)
  // subPct theo chiều giờ (per-conversion — nơi sub_id có nghĩa).
  const subPct = hourUsd > 0 ? Math.round((hourSubUsd / hourUsd) * 100) : 0

  return {
    totalUsd: round2(totalUsd),
    rows: typed.length,
    minDate: minDate || null,
    maxDate: maxDate || null,
    lastFetched: lastFetched || null,
    hasCountry: topCountry.length > 0,
    hasDevice: topDevice.length > 0,
    hasHour,
    hasSub: hourSubUsd > 0,
    subPct,
    byCountry: topCountry,
    byDevice: topDevice,
    byHour: hourArr.map(round2),
  }
}

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [acctRes, cfgRes, netRes, runRes, alertRes, settingsRes, projRes, bdRes] = await Promise.all([
    supabaseAdmin.from('engine_accounts')
      .select('id, network_id, account_id, label, project_id, enabled, login_status, dashboard_url'),
    supabaseAdmin.from('engine_network_configs')
      .select('network_id, enabled, breakdown_enabled, config'),
    supabaseAdmin.from('engine_networks').select('network_id, network_name'),
    supabaseAdmin.from('engine_runs')
      .select('network_id, account_id, status, breakdown_upserted, error_type, error_message, date_from, date_to, started_at, finished_at')
      .eq('kind', 'breakdown')
      .order('started_at', { ascending: false })
      .limit(200),
    supabaseAdmin.from('engine_alerts')
      .select('network_id, error_type, message, occurrences, last_seen')
      .eq('status', 'open')
      .like('network_id', '%:breakdown'),
    supabaseAdmin.from('engine_settings')
      .select('auto_sync_enabled, interval_hours, worker_last_seen_at')
      .eq('id', 1).maybeSingle(),
    supabaseAdmin.from('projects').select('project_id, name'),
    // Dữ liệu breakdown đã thu (mọi ngày) — tóm tắt theo account để hiện trong panel mở rộng.
    supabaseAdmin.from('revenue_breakdown')
      .select('network_id, account_id, report, country, device, hour, sub_id, revenue, revenue_usd, currency, revenue_type, date, fetched_at')
      .limit(20000),
  ])

  const cfgByNetwork = new Map(
    (cfgRes.data ?? []).map(c => {
      const reports = Array.isArray(c.config?.reports) ? (c.config.reports as ConfigReport[]) : []
      const bdReports = reports.filter(r => r?.kind === 'breakdown')
      return [c.network_id, {
        enabled: c.enabled !== false,
        breakdown_enabled: c.breakdown_enabled !== false,
        has_breakdown_config: bdReports.length > 0,
        breakdown_report_names: bdReports.map(r => r.name ?? 'breakdown'),
        // Report snapshot (date_mode='window_end') → summarize lấy ngày mới nhất; còn lại cộng mọi ngày.
        snapshot_reports: new Set(bdReports.filter(r => r.date_mode === 'window_end').map(r => r.name ?? 'breakdown')),
      }]
    })
  )
  const netName = new Map((netRes.data ?? []).map(n => [n.network_id, n.network_name]))
  const projName = new Map((projRes.data ?? []).map(p => [p.project_id, p.name]))

  // Lần chạy breakdown GẦN NHẤT per account (runs đã sort desc → lần đầu gặp là mới nhất).
  const lastRunByAccount = new Map<string, NonNullable<typeof runRes.data>[number]>()
  for (const r of runRes.data ?? []) {
    const key = `${r.network_id}|${r.account_id}`
    if (!lastRunByAccount.has(key)) lastRunByAccount.set(key, r)
  }

  // Alert breakdown gom theo tag '<account_id>:breakdown'.
  const alertsByTag = new Map<string, { error_type: string; message: string | null; occurrences: number; last_seen: string }[]>()
  for (const a of alertRes.data ?? []) {
    const arr = alertsByTag.get(a.network_id) ?? []
    arr.push({ error_type: a.error_type, message: a.message, occurrences: a.occurrences, last_seen: a.last_seen })
    alertsByTag.set(a.network_id, arr)
  }

  // Tóm tắt dữ liệu breakdown đã thu, gom theo (network_id, account_id slug).
  const bdByAccount = new Map<string, BdSummaryRow[]>()
  for (const r of (bdRes.data ?? []) as BdSummaryRow[]) {
    const key = `${r.network_id}|${r.account_id}`
    const arr = bdByAccount.get(key) ?? []
    arr.push(r)
    bdByAccount.set(key, arr)
  }

  const rows = (acctRes.data ?? []).map(a => {
    const cfg = cfgByNetwork.get(a.network_id)
    return {
      account_uuid: a.id,                 // engine_accounts.id — POST lệnh fetch_breakdown/discover cần cái này
      account_id: a.account_id,
      label: a.label,
      network_id: a.network_id,
      network_name: netName.get(a.network_id) ?? a.network_id,
      project_id: a.project_id,
      project_name: a.project_id ? (projName.get(a.project_id) ?? a.project_id) : null,
      login_status: a.login_status,
      account_enabled: a.enabled,
      dashboard_url: a.dashboard_url,
      breakdown_enabled: cfg?.breakdown_enabled ?? true,
      has_breakdown_config: cfg?.has_breakdown_config ?? false,
      breakdown_report_names: cfg?.breakdown_report_names ?? [],
      last_run: lastRunByAccount.get(`${a.network_id}|${a.account_id}`) ?? null,
      open_alerts: alertsByTag.get(`${a.account_id}:breakdown`) ?? [],
      data_summary: summarize(bdByAccount.get(`${a.network_id}|${a.account_id}`) ?? [], cfg?.snapshot_reports ?? new Set<string>()),
    }
  }).sort((a, b) => a.network_name.localeCompare(b.network_name) || a.label.localeCompare(b.label))

  return NextResponse.json({
    settings: settingsRes.data ?? { auto_sync_enabled: false, interval_hours: 6, worker_last_seen_at: null },
    rows,
  })
}
