import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { computeScreenRevenue, PendingRow } from '@/lib/screen-revenue'
import { pickRevenueType, usdOf, BreakdownRow, dedupeSnapshotRows, snapshotKeysFromConfigs } from '@/lib/breakdown-revenue'

// GET /api/optimize/breakdown-data?project_id=...&from=...&to=...
// Tab "Dữ liệu nguồn" của Tối Ưu Camp: xem dữ liệu breakdown thô Engine đã thu +
// ĐỐI CHIẾU với DT Màn hình (affiliate_revenue pending — số P&L đã tin dùng, do report
// doanh thu của chính network đổ về) để biết dữ liệu có đầy đủ/chính xác không.
// Không yêu cầu google_campaign_id (xem dữ liệu nguồn, không cần camp).

interface BdRow extends BreakdownRow {
  account_id: string
  fetched_at: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  const from = url.searchParams.get('from') ?? '2000-01-01'
  const to   = url.searchParams.get('to')   ?? new Date().toISOString().split('T')[0]

  // Kiểm quyền theo role (mirror /api/optimize).
  if (caller.role === 'member') {
    const { data: share } = await supabaseAdmin
      .from('project_shares').select('id')
      .eq('project_id', project_id).eq('user_id', caller.user_id).maybeSingle()
    if (!share) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (caller.role === 'manager') {
    const { data: proj } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (proj?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, screen_revenue_type')
    .eq('project_id', project_id)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const isCumulative = project.screen_revenue_type === 'cumulative'

  const [breakdownRes, pendingRes] = await Promise.all([
    supabaseAdmin
      .from('revenue_breakdown')
      .select('date, network_id, account_id, country, device, hour, sub_id, campaign_id, revenue, currency, revenue_usd, conversions, revenue_type, fetched_at, report')
      .eq('project_id', project_id)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true }),
    supabaseAdmin
      .from('affiliate_revenue')
      .select('date, amount, cycle_end')
      .eq('project_id', project_id).eq('type', 'pending')
      .gte('date', from).lte('date', to),
  ])
  // Bỏ trùng report snapshot (window_end) — chỉ giữ ngày mới nhất; per-conversion giữ mọi ngày.
  const rawBdRows = (breakdownRes.data ?? []) as BdRow[]
  let snapshotKeys = new Set<string>()
  if (rawBdRows.length) {
    const nets = [...new Set(rawBdRows.map(r => r.network_id))]
    const { data: cfgs } = await supabaseAdmin.from('engine_network_configs').select('network_id, config').in('network_id', nets)
    snapshotKeys = snapshotKeysFromConfigs(cfgs ?? [])
  }
  const bdRows = dedupeSnapshotRows(rawBdRows, snapshotKeys) as BdRow[]
  const isSnap = (r: BdRow) => snapshotKeys.has(`${r.network_id}|${r.report}`)

  // DT Màn hình daily — project cumulative cần baseline dòng pending cuối trước khoảng ngày.
  let baselinePrev = 0
  if (isCumulative) {
    const { data: prev } = await supabaseAdmin
      .from('affiliate_revenue')
      .select('amount, cycle_end')
      .eq('project_id', project_id).eq('type', 'pending')
      .lt('date', from)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    baselinePrev = prev ? (prev.cycle_end ? 0 : (prev.amount ?? 0)) : 0
  }
  const pendingRows: PendingRow[] = (pendingRes.data ?? [])
    .map(r => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
  const { byDate: screenByDate, total: screenTotal } =
    computeScreenRevenue(pendingRows, isCumulative, baselinePrev)

  // ── Gộp theo network — mỗi network 1 card với độ phủ dimension riêng ─────────
  const byNetwork = new Map<string, BdRow[]>()
  for (const r of bdRows) {
    const arr = byNetwork.get(r.network_id) ?? []
    arr.push(r)
    byNetwork.set(r.network_id, arr)
  }

  const bdByDayAll = new Map<string, number>() // đối chiếu theo ngày — CHỈ report per-conversion (có dữ liệu theo ngày thật)
  const networks = [...byNetwork.entries()].map(([network_id, rows]) => {
    // Chỉ tính 1 loại revenue_type (ưu tiên pending) để không cộng trùng pending + confirmed.
    const type = pickRevenueType(rows)
    const typed = rows.filter(r => r.revenue_type === type)

    let allUsd = 0
    let dimCountry = 0, dimDevice = 0, dimHour = 0, dimSubId = 0
    const byDay = new Map<string, { usd: number; rows: number }>()
    const byCountry = new Map<string, { usd: number; conversions: number | null }>()
    const byDevice = new Map<string, number>()
    const byHour = new Map<number, number>()
    let lastFetchedAt = ''

    for (const r of typed) {
      const usd = usdOf(r)
      if (r.fetched_at > lastFetchedAt) lastFetchedAt = r.fetched_at
      if (usd == null) continue
      allUsd += usd
      if (r.country) dimCountry += usd
      if (r.device) dimDevice += usd
      if (r.hour >= 0) dimHour += usd
      if (r.sub_id) dimSubId += usd

      const day = byDay.get(r.date) ?? { usd: 0, rows: 0 }
      day.usd += usd; day.rows += 1
      byDay.set(r.date, day)
      // Đối chiếu ngày vs DT Màn hình: chỉ dùng report per-conversion (snapshot là tổng-cả-kỳ,
      // dồn vào 1 ngày cuối → không so theo ngày được).
      if (!isSnap(r)) bdByDayAll.set(r.date, (bdByDayAll.get(r.date) ?? 0) + usd)

      if (r.country) {
        const c = byCountry.get(r.country) ?? { usd: 0, conversions: null }
        c.usd += usd
        if (r.conversions != null) c.conversions = (c.conversions ?? 0) + r.conversions
        byCountry.set(r.country, c)
      }
      if (r.device) byDevice.set(r.device, (byDevice.get(r.device) ?? 0) + usd)
      if (r.hour >= 0) byHour.set(r.hour, (byHour.get(r.hour) ?? 0) + usd)
    }
    // totalUsd = MAX theo chiều (geo/device/giờ đo cùng khoản theo nhiều cách) — không cộng chéo.
    const totalUsd = Math.max(dimCountry, dimDevice, dimHour) || allUsd

    const dates = typed.map(r => r.date)
    const pctOf = (n: number) => (totalUsd > 0 ? Math.round((n / totalUsd) * 100) : 0)
    return {
      network_id,
      account_ids: [...new Set(rows.map(r => r.account_id))],
      revenue_type: type,
      totalUsd: round2(totalUsd),
      rows: typed.length,
      minDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
      maxDate: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      lastFetchedAt: lastFetchedAt || null,
      dims: { country: pctOf(dimCountry), device: pctOf(dimDevice), hour: pctOf(dimHour), subId: pctOf(dimSubId) },
      byDay: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([date, v]) => ({ date, breakdownUsd: round2(v.usd), rows: v.rows })),
      byCountry: [...byCountry.entries()].sort((a, b) => b[1].usd - a[1].usd)
        .map(([country, v]) => ({
          country, usd: round2(v.usd), conversions: v.conversions,
          sharePct: totalUsd > 0 ? Math.round((v.usd / totalUsd) * 100) : 0,
        })),
      byDevice: [...byDevice.entries()].sort((a, b) => b[1] - a[1])
        .map(([device, usd]) => ({
          device, usd: round2(usd),
          sharePct: totalUsd > 0 ? Math.round((usd / totalUsd) * 100) : 0,
        })),
      byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0])
        .map(([hour, usd]) => ({ hour, usd: round2(usd) })),
    }
  }).sort((a, b) => b.totalUsd - a.totalUsd)

  // ── Đối chiếu theo ngày: DT Màn hình (P&L) vs tổng breakdown ─────────────────
  const allDates = [...new Set([...Object.keys(screenByDate), ...bdByDayAll.keys()])].sort((a, b) => b.localeCompare(a))
  const days = allDates.map(date => {
    const screenUsd = round2(screenByDate[date] ?? 0)
    const breakdownUsd = round2(bdByDayAll.get(date) ?? 0)
    return {
      date, screenUsd, breakdownUsd,
      // Δ% so với số P&L; ngày không có DT màn hình → null (không so được).
      deltaPct: screenUsd > 0 ? Math.round(((breakdownUsd - screenUsd) / screenUsd) * 100) : null,
    }
  })
  const bdTotal = [...bdByDayAll.values()].reduce((s, v) => s + v, 0)

  return NextResponse.json({
    project: { project_id, name: project.name },
    range: { from, to },
    networks,
    reconciliation: {
      screenTotal: round2(screenTotal),
      breakdownTotal: round2(bdTotal),
      coveragePct: screenTotal > 0 ? Math.round((bdTotal / screenTotal) * 100) : null,
      days,
    },
  })
}
