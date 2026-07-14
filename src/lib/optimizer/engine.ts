import { supabaseAdmin } from '@/lib/supabase-admin'
import { optimizeCampaign } from '@/lib/campaign-optimizer'
import { OptimizationSuggestion } from '@/lib/types'
import { computeScreenRevenue, PendingRow } from '@/lib/screen-revenue'
import { BreakdownRow, dedupeSnapshotRows, snapshotKeysFromConfigs, usdOf, pickRevenueType } from '@/lib/breakdown-revenue'
import { countryNameByGeoId } from '@/lib/geo-targets'
import { loadCampaignBundle } from './stats-loader'
import { mergeThresholds, toOptimizerCfg, RULE_EVAL, suggestionScore, Thresholds, RuleStat } from './defaults'
import { detectDailyAnomalies, detectTrends, detectHotKeys, looksLikeOutage, median, DailyStatPoint, AnomalyFinding, HotFinding } from './anomaly'
import { computeConfirmRate, ConfirmRateResult } from './confirm-rate'
import { evaluateOutcome, windowsOverlap, EvalDailyStat } from './evaluate'
import { synthesizeTicket, evaluateTicket, TicketDay, TicketTarget } from './tests'
import { getTelegramCfg, sendSafe, buildDigestText, DigestSummary } from './notify'
import { resolveAdoptiveOrg } from './access'

// ─────────────────────────────────────────────────────────────────────────────
// Optimizer v2 — engine chạy nền. Kích hoạt khi dữ liệu về (webhook ads-script,
// worker ping sau sync revenue, nhập DT tay, stale-check khi mở trang).
//
// Pipeline mỗi run (per org):
//   claim lock → confirm-rate per project → rebuild optimizer_daily_stats
//   → chẩn đoán sự cố network (ức chế rule nếu nghi sự cố)
//   → phát hiện đột biến (z-score) + xu hướng (Theil–Sen)
//   → chạy rule engine (optimizeCampaign với ngưỡng từ DB) → diff vào
//     optimizer_suggestions (persist + vòng đời)
//   → chấm outcome các đề xuất đã áp dụng đến hạn → cập nhật độ tin cậy rule
//   → phiếu test: sinh draft từ đột biến cơ hội, auto-link, chấm hằng ngày
//   → Telegram: tin ngay (đột biến nặng/stop-loss/kết luận test) + digest 1 lần/ngày
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyzeTrigger = 'webhook' | 'worker' | 'pageload' | 'manual' | 'revenue'

const CLAIM_MINUTES = 15          // script Ads gửi ~6 POST liên tiếp → chỉ POST đầu chạy
const STATS_WINDOW_DAYS = 35      // cửa sổ rebuild daily stats (baseline 28d + đệm)
const TIME_BUDGET_MS = 240_000    // Vercel free tier — quá thì dừng, dirty_since giữ nguyên để run sau chạy tiếp

const todayIso = () => new Date().toISOString().slice(0, 10)
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

interface RunStats {
  projects: number
  suggestions_new: number
  suggestions_updated: number
  anomalies: number
  evaluated: number
  tickets_created: number
  tickets_evaluated: number
  errors: string[]
  notes?: string[]     // thông tin không phải lỗi (vd nhận phân tích project chưa gán team)
  incomplete?: boolean
}

interface OrgProject {
  project_id: string
  name: string
  google_campaign_id: string | null
  screen_revenue_type: string | null
}

// Đánh dấu "có dữ liệu mới" — trigger (webhook/nhập tay) đặt TRƯỚC khi gọi
// runAnalysis qua after(); engine chỉ xóa cờ khi đã chạy trọn vẹn.
export async function markDirty(organizationId: string | null): Promise<void> {
  if (!organizationId) return
  await supabaseAdmin.from('optimizer_state')
    .upsert({ organization_id: organizationId }, { onConflict: 'organization_id', ignoreDuplicates: true })
  await supabaseAdmin.from('optimizer_state')
    .update({ dirty_since: new Date().toISOString() })
    .eq('organization_id', organizationId)
}

export async function runAnalysis(opts: {
  organizationId?: string | null
  trigger: AnalyzeTrigger
  force?: boolean          // 'manual' bỏ qua claim window
}): Promise<{ ran: boolean; orgs: number }> {
  // Xác định org cần chạy: có org → chỉ org đó; không (worker/global) → mọi org.
  let orgIds: string[]
  if (opts.organizationId) {
    orgIds = [opts.organizationId]
  } else {
    const { data } = await supabaseAdmin.from('organizations').select('id')
    orgIds = (data ?? []).map(o => o.id)
  }

  // Đề xuất tối ưu KHÔNG phụ thuộc gán team: project chưa gán team (mồ côi) vẫn được
  // phân tích — "org chính" (resolveAdoptiveOrg) nhận phân tích hộ trong run của nó
  // (optimizer_state/Telegram/ngưỡng key theo org nên cần 1 org đứng tên).
  const { data: orphanRows } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, google_campaign_id, screen_revenue_type')
    .is('team_id', null)
    .not('google_campaign_id', 'is', null)
  const orphanProjects = orphanRows ?? []
  const adoptiveOrgId = orphanProjects.length ? await resolveAdoptiveOrg() : null

  let ran = 0
  for (const orgId of orgIds) {
    try {
      const ok = await runOrgAnalysis(orgId, opts.trigger, opts.force ?? opts.trigger === 'manual',
        orgId === adoptiveOrgId ? orphanProjects : [])
      if (ok) ran++
    } catch (e) {
      console.error(`[optimizer] org ${orgId} failed:`, e)
    }
  }
  return { ran: ran > 0, orgs: ran }
}

async function runOrgAnalysis(orgId: string, trigger: AnalyzeTrigger, force: boolean, orphanProjects: OrgProject[] = []): Promise<boolean> {
  const startedAt = Date.now()
  const nowIso = new Date().toISOString()

  // ── Claim lock (atomic — chỉ 1 run trong CLAIM_MINUTES trừ khi force) ──────
  await supabaseAdmin.from('optimizer_state')
    .upsert({ organization_id: orgId }, { onConflict: 'organization_id', ignoreDuplicates: true })
  let claim = supabaseAdmin.from('optimizer_state')
    .update({ last_run_at: nowIso, updated_at: nowIso })
    .eq('organization_id', orgId)
  if (!force) {
    const cutoff = new Date(Date.now() - CLAIM_MINUTES * 60000).toISOString()
    claim = claim.or(`last_run_at.is.null,last_run_at.lt.${cutoff}`)
  }
  const { data: claimed } = await claim.select('organization_id, rule_stats, confirm_rates, last_digest_date, dirty_since')
  if (!claimed?.length) return false   // run khác vừa chạy — bỏ qua
  const state = claimed[0] as {
    rule_stats: Record<string, RuleStat>
    confirm_rates: Record<string, unknown>
    last_digest_date: string | null
    dirty_since: string | null
  }
  const dirtyAtStart = state.dirty_since

  const { data: runRow } = await supabaseAdmin.from('optimizer_runs')
    .insert({ organization_id: orgId, triggered_by: trigger, status: 'running' })
    .select('id').single()
  const runId = runRow?.id as string | undefined
  if (runId) await supabaseAdmin.from('optimizer_state').update({ last_run_id: runId }).eq('organization_id', orgId)

  const stats: RunStats = {
    projects: 0, suggestions_new: 0, suggestions_updated: 0, anomalies: 0,
    evaluated: 0, tickets_created: 0, tickets_evaluated: 0, errors: [],
  }

  try {
    // ── Ngưỡng: mặc định + override org (+ override project bên trong loop) ──
    const { data: settingRows } = await supabaseAdmin.from('optimizer_settings')
      .select('project_id, thresholds, auto_tune')
      .eq('organization_id', orgId)
    const orgSetting = (settingRows ?? []).find(s => !s.project_id)
    const projSettings = new Map((settingRows ?? []).filter(s => s.project_id).map(s => [s.project_id as string, s]))
    const orgOverrides = (orgSetting?.thresholds ?? {}) as Record<string, number>

    // ── Danh sách project của org (qua teams) có gắn campaign + project mồ côi
    //    được "nhận nuôi" (đề xuất tối ưu không phụ thuộc gán team) ────────────
    const { data: teams } = await supabaseAdmin.from('teams').select('id').eq('organization_id', orgId)
    const teamIds = (teams ?? []).map(t => t.id)
    let projList: OrgProject[] = []
    if (teamIds.length) {
      const { data: projects } = await supabaseAdmin.from('projects')
        .select('project_id, name, google_campaign_id, screen_revenue_type')
        .in('team_id', teamIds)
        .not('google_campaign_id', 'is', null)
      projList = (projects ?? []) as OrgProject[]
    }
    if (orphanProjects.length) {
      projList = [...projList, ...orphanProjects]
      stats.notes = [`Nhận phân tích ${orphanProjects.length} project chưa gán team: ${orphanProjects.map(p => p.project_id).join(', ')} (nên gán team trong Quản lý dự án để phân quyền đúng)`]
    }
    if (!projList.length) { await finishRun(runId, orgId, stats, state, dirtyAtStart, null); return true }

    const baseTh = mergeThresholds(orgOverrides)

    // ── Chẩn đoán cấp NETWORK trước (chống khuyên tắt camp oan) ──────────────
    const networkHealth = await diagnoseNetworks(projList.map(p => p.project_id), baseTh)

    const from = daysAgoIso(STATS_WINDOW_DAYS - 1)
    const to = todayIso()

    const ruleStats: Record<string, RuleStat> = { ...(state.rule_stats ?? {}) }
    const confirmRates: Record<string, unknown> = { ...(state.confirm_rates ?? {}) }
    const digestNewSuggestions: DigestSummary['newSuggestions'] = []
    const immediateMsgs: string[] = []

    // ── Per project (tuần tự — bound memory + time budget) ───────────────────
    for (const proj of projList) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stats.incomplete = true; break }
      try {
        const projTh = mergeThresholds({ ...orgOverrides, ...((projSettings.get(proj.project_id)?.thresholds ?? {}) as Record<string, number>) })
        const r = await analyzeProject({
          orgId, projectId: proj.project_id, projectName: proj.name,
          from, to, th: projTh, ruleStats,
          network: networkHealth.byProject.get(proj.project_id) ?? null,
        })
        stats.projects++
        stats.suggestions_new += r.newSuggestions
        stats.suggestions_updated += r.updatedSuggestions
        stats.anomalies += r.anomalies
        stats.evaluated += r.evaluated
        stats.tickets_created += r.ticketsCreated
        if (r.confirmRate) confirmRates[proj.project_id] = r.confirmRate
        digestNewSuggestions.push(...r.digestSuggestions)
        immediateMsgs.push(...r.immediateMsgs)
      } catch (e) {
        stats.errors.push(`${proj.project_id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ── Sự cố network → cảnh báo NGAY (1 lần / sự kiện) ──────────────────────
    for (const o of networkHealth.outages) {
      const persisted = await persistNetworkOutage(orgId, o, baseTh)
      if (persisted) immediateMsgs.push(
        `🔌 <b>Nghi mất kết nối network "${o.networkId}"</b>\nHôm nay doanh thu = $0 trên mọi camp của network trong khi vẫn có ${o.todayClicks} click (bình thường ~$${o.baseline.toFixed(2)}/ngày). Khả năng chết link tracking hoặc bị đăng xuất — KHÔNG phải camp tệ. Đã tạm ẩn các đề xuất "cắt camp" liên quan. Mở trang Quản lý Doanh thu Engine kiểm tra đăng nhập/link.`)
    }

    // ── Phiếu test: auto-link + chấm hằng ngày + dọn phiếu quên ─────────────
    const ticketResult = await processTickets(orgId, baseTh)
    stats.tickets_evaluated = ticketResult.evaluated
    immediateMsgs.push(...ticketResult.immediateMsgs)

    // ── Telegram ──────────────────────────────────────────────────────────────
    const tg = await getTelegramCfg(orgId)
    for (const msg of immediateMsgs) await sendSafe(tg, msg)

    const today = todayIso()
    let digestSent: string | null = null
    if (tg && state.last_digest_date !== today && (trigger === 'webhook' || trigger === 'worker')) {
      const digest = await buildDigest(orgId, digestNewSuggestions)
      const text = buildDigestText(digest)
      if (text && await sendSafe(tg, text)) digestSent = today
    }

    await supabaseAdmin.from('optimizer_state')
      .update({
        rule_stats: ruleStats,
        confirm_rates: confirmRates,
        ...(digestSent ? { last_digest_date: digestSent } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', orgId)

    await finishRun(runId, orgId, stats, state, dirtyAtStart, null)
    return true
  } catch (e) {
    await finishRun(runId, orgId, stats, state, dirtyAtStart, e instanceof Error ? e.message : String(e))
    throw e
  }
}

async function finishRun(
  runId: string | undefined, orgId: string, stats: RunStats,
  state: { dirty_since: string | null }, dirtyAtStart: string | null, error: string | null,
) {
  if (runId) {
    await supabaseAdmin.from('optimizer_runs').update({
      status: error ? 'error' : 'done',
      stats: stats as unknown as Record<string, unknown>,
      message: error,
      finished_at: new Date().toISOString(),
    }).eq('id', runId)
  }
  // Xóa cờ dirty CHỈ khi không có dữ liệu mới đến trong lúc chạy và run trọn vẹn.
  if (!error && !stats.incomplete) {
    const { data } = await supabaseAdmin.from('optimizer_state')
      .select('dirty_since').eq('organization_id', orgId).maybeSingle()
    const cur = data?.dirty_since ?? null
    if (cur === dirtyAtStart || cur == null) {
      await supabaseAdmin.from('optimizer_state').update({ dirty_since: null }).eq('organization_id', orgId)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chẩn đoán cấp network: (1) doanh thu = 0 đồng loạt mà vẫn có click → nghi
// chết link/đăng xuất; (2) sync thất bại / quá cũ → dữ liệu "chưa tươi".
// Cả hai → ức chế đề xuất cut/loại-geo dựa doanh thu của các project liên quan.
// Dùng revenue_raw (grain ngày thuần từ network — không dính cumulative).
// ─────────────────────────────────────────────────────────────────────────────

interface NetworkFlag { networkId: string; outage: boolean; stale: boolean }
interface OutageInfo { networkId: string; todayClicks: number; baseline: number; projectIds: string[] }

async function diagnoseNetworks(projectIds: string[], th: Thresholds): Promise<{
  byProject: Map<string, NetworkFlag>
  outages: OutageInfo[]
}> {
  const byProject = new Map<string, NetworkFlag>()
  const outages: OutageInfo[] = []

  const { data: accounts } = await supabaseAdmin.from('engine_accounts')
    .select('network_id, account_id, project_id, enabled')
    .in('project_id', projectIds)
  const accs = (accounts ?? []).filter(a => a.enabled && a.project_id)
  if (!accs.length) return { byProject, outages }

  const networks = [...new Set(accs.map(a => a.network_id))]
  const projByNetwork = new Map<string, string[]>()
  for (const a of accs) {
    const arr = projByNetwork.get(a.network_id) ?? []
    if (!arr.includes(a.project_id!)) arr.push(a.project_id!)
    projByNetwork.set(a.network_id, arr)
  }

  // Sync gần nhất thành công per network (kind revenue) — cũ quá = chưa tươi.
  const { data: recentRuns } = await supabaseAdmin.from('engine_runs')
    .select('network_id, status, finished_at')
    .in('network_id', networks)
    .eq('status', 'success')
    .order('finished_at', { ascending: false })
    .limit(networks.length * 5)
  const lastSuccess = new Map<string, string>()
  for (const r of recentRuns ?? []) {
    if (r.finished_at && !lastSuccess.has(r.network_id)) lastSuccess.set(r.network_id, r.finished_at)
  }

  // Doanh thu theo ngày per network 15 ngày gần nhất (pending — tiền màn hình).
  const { data: rawRows } = await supabaseAdmin.from('revenue_raw')
    .select('network_id, date, revenue_usd, revenue, revenue_type')
    .in('network_id', networks)
    .gte('date', daysAgoIso(15))
  const byNetDate = new Map<string, Map<string, number>>()
  for (const r of rawRows ?? []) {
    if (r.revenue_type === 'confirmed') continue
    const m = byNetDate.get(r.network_id) ?? new Map<string, number>()
    m.set(r.date, (m.get(r.date) ?? 0) + (r.revenue_usd ?? r.revenue ?? 0))
    byNetDate.set(r.network_id, m)
  }

  for (const net of networks) {
    const projIds = projByNetwork.get(net) ?? []
    const staleMs = th.OUT_STALE_HOURS * 3600_000
    const last = lastSuccess.get(net)
    const stale = !last || Date.now() - new Date(last).getTime() > staleMs

    let outage = false
    let todayClicks = 0
    let baseline = 0
    if (!stale) {
      // "Hôm nay" theo dữ liệu network = ngày mới nhất có click bên Google Ads.
      const { data: camps } = await supabaseAdmin.from('projects')
        .select('project_id, google_campaign_id').in('project_id', projIds)
      const campIds = (camps ?? []).map(c => c.google_campaign_id).filter(Boolean) as string[]
      if (campIds.length) {
        const { data: mrows } = await supabaseAdmin.from('campaign_metrics')
          .select('date, clicks').in('campaign_id', campIds).gte('date', daysAgoIso(2))
        const byDate = new Map<string, number>()
        for (const m of mrows ?? []) byDate.set(m.date, (byDate.get(m.date) ?? 0) + m.clicks)
        const lastDate = [...byDate.keys()].sort().pop()
        if (lastDate) {
          todayClicks = byDate.get(lastDate) ?? 0
          const revMap = byNetDate.get(net) ?? new Map()
          const todayRevenue = revMap.get(lastDate) ?? 0
          const prior = [...revMap.entries()].filter(([d]) => d < lastDate).map(([, v]) => v)
          baseline = median(prior)
          outage = looksLikeOutage({ todayRevenue, baselineRevenueMedian: baseline, todayClicks, minClicks: th.OUT_MIN_CLICKS })
        }
      }
    }

    for (const pid of projIds) {
      const cur = byProject.get(pid)
      byProject.set(pid, {
        networkId: net,
        outage: (cur?.outage ?? false) || outage,
        stale: (cur?.stale ?? false) || stale,
      })
    }
    if (outage) outages.push({ networkId: net, todayClicks, baseline, projectIds: projIds })
  }

  return { byProject, outages }
}

// Ghi sự cố network vào anomaly_events (dedupe per network) — trả true nếu là event MỚI (cần Telegram).
async function persistNetworkOutage(orgId: string, o: OutageInfo, th: Thresholds): Promise<boolean> {
  const dedupeKey = `network_outage:${o.networkId}`
  const pid = o.projectIds[0]
  const { data: existing } = await supabaseAdmin.from('anomaly_events')
    .select('id, telegram_sent_at').eq('dedupe_key', dedupeKey).eq('state', 'open').maybeSingle()
  const nowIso = new Date().toISOString()
  if (existing) {
    await supabaseAdmin.from('anomaly_events').update({ last_seen_at: nowIso }).eq('id', existing.id)
    return false
  }
  await supabaseAdmin.from('anomaly_events').insert({
    organization_id: orgId, project_id: pid, campaign_id: null,
    metric: 'network_outage', dimension: { network: o.networkId }, dedupe_key: dedupeKey,
    direction: 'down', severity: 'high',
    value: 0, baseline: o.baseline, spread: 0, zscore: null,
    window: { clicks: o.todayClicks },
    cooldown_until: new Date(Date.now() + th.AN_COOLDOWN_DAYS * 86400000).toISOString(),
    telegram_sent_at: nowIso,
  })
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Phân tích 1 project
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectResult {
  newSuggestions: number
  updatedSuggestions: number
  anomalies: number
  evaluated: number
  ticketsCreated: number
  confirmRate: unknown | null
  digestSuggestions: DigestSummary['newSuggestions']
  immediateMsgs: string[]
}

async function analyzeProject(opts: {
  orgId: string
  projectId: string
  projectName: string
  from: string
  to: string
  th: Thresholds
  ruleStats: Record<string, RuleStat>
  network: NetworkFlag | null
}): Promise<ProjectResult> {
  const { orgId, projectId, from, to, th, ruleStats } = opts
  const result: ProjectResult = {
    newSuggestions: 0, updatedSuggestions: 0, anomalies: 0, evaluated: 0,
    ticketsCreated: 0, confirmRate: null, digestSuggestions: [], immediateMsgs: [],
  }

  const loaded = await loadCampaignBundle({ project_id: projectId, from, to, organizationId: orgId })
  if (!loaded.ok) return result
  const { bundle } = loaded
  const input = bundle.input
  const campaignId = bundle.campaign_id
  const suppressRevenueRules = !!(opts.network?.outage || opts.network?.stale)

  // ── 1. Tiền thực nhận (confirm-rate) ───────────────────────────────────────
  const cr = await computeProjectConfirmRate(projectId, bundle.project.screen_revenue_type === 'cumulative', th)
  if (cr?.rate != null) {
    result.confirmRate = { rate: cr.rate, periods: cr.periods.length, latestDropDpt: cr.latestDropDpt, updated: todayIso() }
  }

  // ── 2. Rebuild optimizer_daily_stats (snapshot ổn định cho baseline + eval) ─
  const dailyStats = buildDailyStats(input)
  if (dailyStats.length) {
    await supabaseAdmin.from('optimizer_daily_stats').upsert(
      dailyStats.map(d => ({
        project_id: projectId, campaign_id: campaignId, date: d.date,
        spend: d.spend, revenue_screen: d.revenue_screen,
        clicks: d.clicks, impressions: d.impressions,
        cpc: d.cpc, ctr: d.ctr, roi: d.roi,
        roi_effective: cr?.rate != null && d.spend > 0
          ? ((d.revenue_screen * cr.rate - d.spend) / d.spend) * 100 : null,
        is_lost_budget: d.is_lost_budget, is_lost_rank: null,
        mature: d.mature, organization_id: orgId, updated_at: new Date().toISOString(),
      })),
      { onConflict: 'project_id,date' },
    )
  }

  // ── 3. Đột biến + xu hướng ─────────────────────────────────────────────────
  let findings = [...detectDailyAnomalies(dailyStats, th), ...detectTrends(dailyStats, th)]
  // Nghi sự cố network → đừng báo "doanh thu tụt/ROI tụt" (nguyên nhân là kết nối, đã có event riêng).
  if (suppressRevenueRules) {
    findings = findings.filter(f => !['revenue', 'roi', 'revenue_trend', 'roi_trend'].includes(f.metric))
  }
  // Kỳ mới network trả thiếu hơn hẳn → báo động.
  if (cr?.latestDropDpt != null && cr.latestDropDpt >= th.CR_DROP_DPT) {
    findings.push({
      metric: 'confirm_rate', dimension: null, dedupeKey: 'confirm_rate',
      direction: 'down', severity: 'high',
      value: cr.periods[cr.periods.length - 1].rate * 100,
      baseline: (cr.periods.slice(0, -1).reduce((s, p) => s + p.rate, 0) / Math.max(1, cr.periods.length - 1)) * 100,
      spread: 0, zscore: null,
      window: { drop_dpt: cr.latestDropDpt, periods: cr.periods.length },
    })
  }

  // Hot geo/offer (đột biến cơ hội) — từ doanh thu chi tiết network.
  const hot = await detectProjectHotKeys(projectId, th)
  result.anomalies = findings.length + hot.geo.length + hot.offer.length

  const anomalyPersist = await persistAnomalies(orgId, projectId, campaignId, findings, hot, th)
  result.immediateMsgs.push(...anomalyPersist.immediateMsgs.map(m => `[${opts.projectName}] ${m}`))

  // ── 4. Rule engine (ngưỡng từ DB) + rule sinh từ anomaly ──────────────────
  const optResult = optimizeCampaign(input, toOptimizerCfg(th))
  let candidates: OptimizationSuggestion[] = optResult.suggestions.filter(s => s.ruleKey)

  // Ức chế đề xuất dựa doanh thu khi network sự cố / dữ liệu chưa tươi.
  if (suppressRevenueRules) {
    const blocked = new Set(['cut_no_revenue', 'cut_deep_loss', 'geo_exclude', 'launch_stoploss'])
    candidates = candidates.filter(s => !blocked.has(s.ruleKey!))
  }

  // ROI hiệu dụng: tiền màn hình × tỷ lệ thực trả. Sửa 2 quyết định dễ sai nhất:
  //   • camp trông lãi nhưng thực chất lỗ sau khi trừ phần network không trả → thêm cảnh báo CẮT;
  //   • camp "đủ lãi để scale" theo màn hình nhưng chưa đủ theo tiền thực → chặn đề xuất scale.
  if (cr?.rate != null && !suppressRevenueRules) {
    const effRevenue = input.totalRevenue * cr.rate
    const effRoi = input.totalCost > 0 ? ((effRevenue - input.totalCost) / input.totalCost) * 100 : null
    const screenRoi = input.totalCost > 0 ? ((input.totalRevenue - input.totalCost) / input.totalCost) * 100 : null
    if (effRoi != null && screenRoi != null) {
      if (screenRoi >= th.LOSS_ROI && effRoi < th.LOSS_ROI) {
        candidates.push(makeEngineSuggestion({
          ruleKey: 'cut_effective_loss', type: 'cut', severity: 'high', confidence: 'roi',
          campaignId, projectId, label: input.campaignLabel,
          title: 'Theo tiền THỰC NHẬN camp này đang lỗ — màn hình chỉ lãi ảo',
          detail: `Các kỳ thanh toán trước, network chỉ thực trả ~${(cr.rate * 100).toFixed(0)}% số tiền hiện trên màn hình của dự án này. Nhân tỷ lệ đó: doanh thu thực dự kiến ${fmtUsd(effRevenue)} < chi phí ${fmtUsd(input.totalCost)} → ROI thực ~${effRoi.toFixed(0)}% (màn hình đang hiện ${screenRoi.toFixed(0)}%).`,
          action: 'Coi camp này là ĐANG LỖ khi ra quyết định. Giảm chi/thu hẹp; nếu nghi network trả thiếu bất thường, đối chiếu kỳ thanh toán gần nhất.',
          evidence: [
            { metric: 'Tỷ lệ thực trả', value: `${(cr.rate * 100).toFixed(0)}%` },
            { metric: 'ROI theo màn hình', value: `${screenRoi.toFixed(0)}%` },
            { metric: 'ROI theo tiền thực', value: `${effRoi.toFixed(0)}%` },
          ],
          impact: Math.max(0, input.totalCost - effRevenue),
          params: { rate: cr.rate, effRoi, screenRoi },
        }))
      }
      if (effRoi < th.TARGET_ROI) {
        const before = candidates.length
        candidates = candidates.filter(s => !(s.ruleKey === 'raise_budget_scale' || s.ruleKey === 'geo_scale'))
        if (candidates.length < before) {
          // Ghi chú minh bạch vì sao không khuyên scale dù màn hình lãi.
          candidates.push(makeEngineSuggestion({
            ruleKey: 'scale_blocked_confirm', type: 'data_quality', severity: 'low', confidence: 'roi',
            campaignId, projectId, label: input.campaignLabel,
            title: 'Chưa khuyên scale — tiền thực nhận chưa đủ lãi',
            detail: `Theo màn hình camp đủ lãi để scale, nhưng network chỉ thực trả ~${(cr.rate * 100).toFixed(0)}% → ROI thực ~${effRoi.toFixed(0)}% (< ngưỡng ${th.TARGET_ROI}%). Scale bây giờ là phóng to khoản lãi chưa chắc có thật.`,
            action: 'Chờ thêm 1 kỳ thanh toán để xác nhận tỷ lệ thực trả, hoặc scale rất từ từ (≤10%/lần).',
            evidence: [
              { metric: 'Tỷ lệ thực trả', value: `${(cr.rate * 100).toFixed(0)}%` },
              { metric: 'ROI theo tiền thực', value: `${effRoi.toFixed(0)}%` },
            ],
            impact: 0,
            params: { rate: cr.rate, effRoi },
          }))
        }
      }
    }
  }

  // Rule sinh từ anomaly phía chi phí + trend (đưa vào cùng hàng đợi hành động).
  candidates.push(...anomalyToSuggestions(findings, { campaignId, projectId, label: input.campaignLabel }))

  // ── 5. Diff vào optimizer_suggestions (persist + vòng đời) ────────────────
  const diff = await diffSuggestions(orgId, projectId, campaignId, candidates, ruleStats, th)
  result.newSuggestions = diff.inserted
  result.updatedSuggestions = diff.updated
  result.digestSuggestions = diff.newForDigest.map(t => ({ ...t, project: opts.projectName }))

  // ── 6. Chấm outcome đề xuất đã áp dụng đến hạn ────────────────────────────
  result.evaluated = await evaluateDueSuggestions(projectId, campaignId, ruleStats, th)

  // ── 7. Seed phiếu test từ đột biến cơ hội / giả thuyết win-day ────────────
  result.ticketsCreated = await seedTickets({
    orgId, projectId, campaignId, th,
    hot, anomalyIds: anomalyPersist.hotEventIds,
    winLift: candidates.find(s => s.ruleKey === 'insight_win_lift') ?? null,
    medianDailySpend: median(dailyStats.filter(d => d.spend > 0).map(d => d.spend)),
    dailyStats,
  })
  if (result.ticketsCreated > 0) {
    result.immediateMsgs.push(`🧪 Có ${result.ticketsCreated} phiếu test mới được đề xuất (từ đột biến doanh thu) — vào tab "Hành động & Test" để duyệt.`)
  }

  return result
}

const usdFmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtUsd = (n: number) => '$' + usdFmt2.format(n)

// Suggestion do engine sinh (anomaly/confirm-rate) — cùng shape với rule engine.
function makeEngineSuggestion(o: {
  ruleKey: string
  type: OptimizationSuggestion['type']
  severity: OptimizationSuggestion['severity']
  confidence: OptimizationSuggestion['confidence']
  campaignId: string
  projectId: string
  label: string
  title: string
  detail: string
  action: string
  evidence: { metric: string; value: string }[]
  impact: number
  params?: Record<string, unknown>
  dedupeKey?: string
}): OptimizationSuggestion {
  return {
    id: `eng-${o.ruleKey}`,
    ruleKey: o.ruleKey,
    dedupeKey: o.dedupeKey ?? o.ruleKey,
    type: o.type, severity: o.severity, confidence: o.confidence,
    scope: { level: 'campaign', label: o.label, campaign_id: o.campaignId, project_id: o.projectId },
    title: o.title, detail: o.detail, evidence: o.evidence,
    recommendedAction: o.action, impactScore: o.impact,
    params: o.params,
  }
}

// Đổi anomaly phía chi phí thành đề xuất hành động (cùng hàng đợi với rule).
function anomalyToSuggestions(
  findings: AnomalyFinding[],
  ctx: { campaignId: string; projectId: string; label: string },
): OptimizationSuggestion[] {
  const out: OptimizationSuggestion[] = []
  const sev = (f: AnomalyFinding) => (f.severity === 'high' ? 'high' as const : 'medium' as const)
  for (const f of findings) {
    const base = { campaignId: ctx.campaignId, projectId: ctx.projectId, label: ctx.label }
    const day = (f.window as { date?: string }).date ?? ''
    switch (f.metric) {
      case 'cpc':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'anomaly_cpc', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Giá click tăng vọt bất thường (${fmtUsd(f.value)}/click, bình thường ~${fmtUsd(f.baseline)})`,
          detail: `Ngày ${day}: giá mỗi click cao hơn hẳn nền 28 ngày (độ lệch z=${f.zscore?.toFixed(1)}). Thường do đối thủ vào đấu giá, Google nới match, hoặc mất điểm chất lượng.`,
          action: 'Xem tab Search terms xem có cụm lạ mới; kiểm tra bid/đối thủ; cân nhắc giảm bid tạm nếu kéo dài 2-3 ngày.',
          evidence: [
            { metric: 'CPC ngày ' + day, value: fmtUsd(f.value) },
            { metric: 'CPC bình thường', value: fmtUsd(f.baseline) },
          ],
          impact: (f.value - f.baseline) * 20,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'ctr':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'anomaly_ctr', type: 'fix_creative', severity: sev(f), confidence: 'engagement',
          title: `Tỷ lệ bấm sập bất thường (${f.value.toFixed(2)}%, bình thường ~${f.baseline.toFixed(2)}%)`,
          detail: `Ngày ${day}: tỷ lệ người bấm quảng cáo thấp hơn hẳn nền 28 ngày. Thường do mẫu quảng cáo bị từ chối/thay đổi, đối thủ chèn trên, hoặc truy vấn lệch.`,
          action: 'Kiểm tra trạng thái mẫu quảng cáo trong Google Ads (bị disapprove?); xem search terms ngày đó.',
          evidence: [
            { metric: 'CTR ngày ' + day, value: `${f.value.toFixed(2)}%` },
            { metric: 'CTR bình thường', value: `${f.baseline.toFixed(2)}%` },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'spend':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'anomaly_spend', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Chi phí bùng bất thường (${fmtUsd(f.value)}, bình thường ~${fmtUsd(f.baseline)}/ngày)`,
          detail: `Ngày ${day}: chi tiêu cao hơn hẳn nền (đã tính cả thứ trong tuần). Kiểm tra xem có chủ đích không (tăng budget/bid?) — nếu không, Google có thể đang nới phân phối.`,
          action: 'Đối chiếu lịch sử thay đổi trong Google Ads (Change history); nếu không có thay đổi chủ đích → xem search terms/geo ngày đó.',
          evidence: [
            { metric: 'Chi ngày ' + day, value: fmtUsd(f.value) },
            { metric: 'Bình thường', value: fmtUsd(f.baseline) + '/ngày' },
          ],
          impact: f.value - f.baseline,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'roi':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'anomaly_roi', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Lãi/lỗ tụt mạnh (${f.value.toFixed(0)}%, bình thường ~${f.baseline.toFixed(0)}%)`,
          detail: `Ngày ${day} (đã chốt doanh thu): ROI thấp hơn nền ${((f.window as { drop_dpt?: number }).drop_dpt ?? 0).toFixed(0)} điểm %. Xem giá click và doanh thu ngày đó để biết tụt từ phía nào.`,
          action: 'So sánh CPC + doanh thu ngày đó với các ngày trước; nếu doanh thu tụt còn click giữ nguyên → nghi offer/link; nếu CPC tăng → nghi đấu giá.',
          evidence: [
            { metric: 'ROI ngày ' + day, value: `${f.value.toFixed(0)}%` },
            { metric: 'ROI bình thường', value: `${f.baseline.toFixed(0)}%` },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'revenue':
        if (f.direction === 'down') {
          out.push(makeEngineSuggestion({
            ...base, ruleKey: 'anomaly_revenue', type: 'margin_alert', severity: sev(f), confidence: 'roi',
            title: `Doanh thu tụt bất thường (${fmtUsd(f.value)}, bình thường ~${fmtUsd(f.baseline)}/ngày)`,
            detail: `Ngày ${day} (đã chốt): tiền màn hình thấp hơn hẳn nền 28 ngày (z=${f.zscore?.toFixed(1)}). Nếu click vẫn bình thường → nghi phía network/offer; nếu click cũng tụt → phía quảng cáo.`,
            action: 'Kiểm tra dashboard network (offer còn chạy? geo còn trả?); so click cùng ngày.',
            evidence: [
              { metric: 'DT ngày ' + day, value: fmtUsd(f.value) },
              { metric: 'Bình thường', value: fmtUsd(f.baseline) + '/ngày' },
            ],
            impact: f.baseline - f.value,
            params: { finding: f as unknown as Record<string, unknown> },
          }))
        }
        break
      case 'is_lost_budget':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'anomaly_is_budget', type: 'raise_budget', severity: sev(f), confidence: 'engagement',
          title: `Đột nhiên mất nhiều hiển thị vì hết ngân sách (+${((f.window as { jump_dpt?: number }).jump_dpt ?? 0).toFixed(0)} đpt)`,
          detail: `Ngày ${day}: tỷ lệ mất hiển thị do hết tiền nhảy lên ${f.value.toFixed(0)}% (bình thường ~${f.baseline.toFixed(0)}%). Nhu cầu đang tăng — nếu camp lãi thì đây là cơ hội scale; nếu chưa rõ lãi thì cẩn thận Google tiêu nhanh hơn.`,
          action: 'Nếu ROI đang tốt → tăng ngân sách 15-25%; nếu chưa rõ → giữ và theo dõi 2-3 ngày.',
          evidence: [
            { metric: 'Mất IS vì budget', value: `${f.value.toFixed(0)}%` },
            { metric: 'Bình thường', value: `${f.baseline.toFixed(0)}%` },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'cpc_trend':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'trend_cpc', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Giá click đang bò dần lên (+${f.value.toFixed(0)}% trong ${(f.window as { window_days?: number }).window_days} ngày)`,
          detail: 'Không phải tăng sốc 1 ngày mà nhích đều nhiều tuần — kiểu "camp đang nguội": cạnh tranh tăng dần hoặc điểm chất lượng giảm dần. Loại này z-score 1 ngày không bắt được.',
          action: 'Làm mới mẫu quảng cáo (angle mới), rà Quality Score, xem đối thủ mới trong Auction insights.',
          evidence: [
            { metric: 'Tăng tích lũy', value: `+${f.value.toFixed(0)}%` },
            { metric: 'CPC hiện tại (median)', value: fmtUsd(f.baseline) },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'revenue_trend':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'trend_revenue', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Doanh thu đang nguội dần (${f.value.toFixed(0)}% trong ${(f.window as { window_days?: number }).window_days} ngày)`,
          detail: 'Tiền màn hình giảm đều qua nhiều tuần (không phải tụt sốc 1 ngày). Thường do offer bão hòa, payout giảm, hoặc chất lượng traffic trôi dần.',
          action: 'Kiểm tra payout/điều khoản offer còn như cũ; xem geo nào đang nguội (tab Dữ liệu Network); cân nhắc test offer thay thế.',
          evidence: [
            { metric: 'Giảm tích lũy', value: `${f.value.toFixed(0)}%` },
            { metric: 'DT/ngày (median)', value: fmtUsd(f.baseline) },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'roi_trend':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'trend_roi', type: 'margin_alert', severity: sev(f), confidence: 'roi',
          title: `Lãi đang trượt dần (${f.value.toFixed(0)} điểm % trong ${(f.window as { window_days?: number }).window_days} ngày)`,
          detail: 'ROI giảm đều nhiều tuần — biên lời đang bị bào mòn từ từ (giá click nhích + doanh thu nguội cùng lúc).',
          action: 'Xem 2 cảnh báo thành phần (giá click / doanh thu) để biết bào mòn từ phía nào; nếu cả hai → cân nhắc làm mới camp hoặc đổi offer.',
          evidence: [{ metric: 'Trượt tích lũy', value: `${f.value.toFixed(0)} đpt` }],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
      case 'confirm_rate':
        out.push(makeEngineSuggestion({
          ...base, ruleKey: 'confirm_rate_drop', type: 'margin_alert', severity: 'high', confidence: 'roi',
          title: `Network đang trả thiếu nhiều hơn (kỳ mới chỉ trả ${f.value.toFixed(0)}%, trước đó ~${f.baseline.toFixed(0)}%)`,
          detail: `Tỷ lệ "tiền thực nhận / tiền màn hình" kỳ thanh toán mới nhất tụt ${((f.window as { drop_dpt?: number }).drop_dpt ?? 0).toFixed(0)} điểm % so với các kỳ trước. Mọi con số lãi trên màn hình đang bị thổi phồng tương ứng.`,
          action: 'Đối chiếu sao kê kỳ mới với dashboard network; hỏi AM về lý do trừ tiền; cân nhắc giảm phụ thuộc network này hoặc test offer/network thay thế.',
          evidence: [
            { metric: 'Kỳ mới thực trả', value: `${f.value.toFixed(0)}%` },
            { metric: 'Các kỳ trước', value: `~${f.baseline.toFixed(0)}%` },
          ],
          impact: 0,
          params: { finding: f as unknown as Record<string, unknown> },
        }))
        break
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirm-rate per project: kỳ confirmed (có khung payout) vs tiền màn hình cùng kỳ.
// ─────────────────────────────────────────────────────────────────────────────

async function computeProjectConfirmRate(projectId: string, isCumulative: boolean, th: Thresholds): Promise<ConfirmRateResult | null> {
  const { data: confirmedRows } = await supabaseAdmin.from('affiliate_revenue')
    .select('date, amount, payout_start_date, payout_end_date')
    .eq('project_id', projectId).eq('type', 'confirmed')
    .order('date', { ascending: false })
    .limit(th.CR_PERIODS * 2)
  const confirmed = (confirmedRows ?? [])
    .map(r => ({ date: r.date, amount: r.amount ?? 0, start: r.payout_start_date ?? null, end: r.payout_end_date ?? null }))
    .filter(c => c.start && c.end)
  if (!confirmed.length) return null

  const minStart = confirmed.reduce((m, c) => (c.start! < m ? c.start! : m), confirmed[0].start!)
  const maxEnd = confirmed.reduce((m, c) => (c.end! > m ? c.end! : m), confirmed[0].end!)

  // Tiền màn hình theo ngày trong toàn dải kỳ (delta hóa nếu cumulative).
  const { data: pendingRows } = await supabaseAdmin.from('affiliate_revenue')
    .select('date, amount, cycle_end')
    .eq('project_id', projectId).eq('type', 'pending')
    .gte('date', minStart).lte('date', maxEnd)
  let baseline = 0
  if (isCumulative) {
    const { data: prev } = await supabaseAdmin.from('affiliate_revenue')
      .select('amount, cycle_end').eq('project_id', projectId).eq('type', 'pending')
      .lt('date', minStart).order('date', { ascending: false }).limit(1).maybeSingle()
    baseline = prev ? (prev.cycle_end ? 0 : (prev.amount ?? 0)) : 0
  }
  const rows: PendingRow[] = (pendingRows ?? []).map(r => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
  const { byDate } = computeScreenRevenue(rows, isCumulative, baseline)

  return computeConfirmRate({ confirmed, pendingByDate: byDate, maxPeriods: th.CR_PERIODS })
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily stats từ bundle (dùng chung cho anomaly baseline + feedback loop)
// ─────────────────────────────────────────────────────────────────────────────

function buildDailyStats(
  input: { metrics: { date: string; impressions: number; clicks: number; cost: number; search_budget_lost_is: number | null }[]; revenueByDate: Record<string, number>; spendByDate: Record<string, number> },
): DailyStatPoint[] {
  const metricByDate = new Map(input.metrics.map(m => [m.date, m]))
  const dates = [...new Set([
    ...input.metrics.map(m => m.date),
    ...Object.keys(input.revenueByDate),
    ...Object.keys(input.spendByDate),
  ])].sort()
  // "Ngày chín" = ≤ ngày cuối đã có doanh thu nhập (cùng quy ước với win-day miner).
  const revDates = dates.filter(d => (input.revenueByDate[d] ?? 0) > 0)
  const matureCutoff = revDates.length ? revDates[revDates.length - 1] : null

  return dates.map(date => {
    const m = metricByDate.get(date)
    const spend = input.spendByDate[date] ?? 0
    const revenue = input.revenueByDate[date] ?? 0
    const clicks = m?.clicks ?? 0
    const impressions = m?.impressions ?? 0
    return {
      date, spend, revenue_screen: revenue, clicks, impressions,
      cpc: clicks > 0 ? (m?.cost ?? spend) / clicks : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      roi: spend > 0 ? ((revenue - spend) / spend) * 100 : null,
      is_lost_budget: m?.search_budget_lost_is ?? null,
      mature: matureCutoff != null && date <= matureCutoff,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Hot geo/offer từ revenue_breakdown (đã lọc report snapshot)
// ─────────────────────────────────────────────────────────────────────────────

type HotBdRow = BreakdownRow & { offer_name: string }

async function detectProjectHotKeys(projectId: string, th: Thresholds): Promise<{ geo: HotFinding[]; offer: HotFinding[] }> {
  const { data: bdRows } = await supabaseAdmin.from('revenue_breakdown')
    .select('date, country, device, hour, sub_id, campaign_id, offer_id, offer_name, revenue, currency, revenue_usd, conversions, revenue_type, network_id, report')
    .eq('project_id', projectId)
    .gte('date', daysAgoIso(th.AN_BASELINE_DAYS))
  const raw = (bdRows ?? []) as unknown as HotBdRow[]
  if (!raw.length) return { geo: [], offer: [] }

  const nets = [...new Set(raw.map(r => r.network_id))]
  const { data: cfgs } = await supabaseAdmin.from('engine_network_configs').select('network_id, config').in('network_id', nets)
  const rows = dedupeSnapshotRows(raw, snapshotKeysFromConfigs(cfgs ?? [])) as HotBdRow[]
  const revType = pickRevenueType(rows)
  const usable = rows.filter(r => r.revenue_type === revType)

  const geoRows = usable
    .filter(r => r.country)
    .map(r => ({ date: r.date, key: r.country, usd: usdOf(r) ?? 0 }))
    .filter(r => r.usd > 0)
  const offerRows = usable
    .filter(r => r.offer_name && r.offer_name !== 'payout')
    .map(r => ({ date: r.date, key: r.offer_name, usd: usdOf(r) ?? 0 }))
    .filter(r => r.usd > 0)

  return { geo: detectHotKeys(geoRows, th), offer: detectHotKeys(offerRows, th) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist anomaly_events (dedupe + cooldown + tự resolve khi êm trở lại)
// ─────────────────────────────────────────────────────────────────────────────

async function persistAnomalies(
  orgId: string, projectId: string, campaignId: string,
  findings: AnomalyFinding[],
  hot: { geo: HotFinding[]; offer: HotFinding[] },
  th: Thresholds,
): Promise<{ immediateMsgs: string[]; hotEventIds: Map<string, string> }> {
  const immediateMsgs: string[] = []
  const hotEventIds = new Map<string, string>()
  const nowIso = new Date().toISOString()
  const cooldownIso = new Date(Date.now() + th.AN_COOLDOWN_DAYS * 86400000).toISOString()

  const { data: openRows } = await supabaseAdmin.from('anomaly_events')
    .select('id, dedupe_key, severity, telegram_sent_at, window')
    .eq('project_id', projectId).eq('state', 'open')
  const open = new Map((openRows ?? []).map(r => [r.dedupe_key, r]))

  const allFindings: { f: AnomalyFinding; hotKey?: string }[] = [
    ...findings.map(f => ({ f })),
    ...hot.geo.map(h => ({
      f: {
        metric: 'geo_revenue', dimension: { geo: h.key }, dedupeKey: `geo_revenue:${h.key}`,
        direction: 'up', severity: h.severity, value: h.todayUsd, baseline: h.baselineUsd,
        spread: 0, zscore: null, window: { date: h.date, mult: h.mult, is_new: h.isNew },
      } as AnomalyFinding,
      hotKey: `geo:${h.key}`,
    })),
    ...hot.offer.map(h => ({
      f: {
        metric: 'offer_revenue', dimension: { offer: h.key }, dedupeKey: `offer_revenue:${h.key}`,
        direction: 'up', severity: h.severity, value: h.todayUsd, baseline: h.baselineUsd,
        spread: 0, zscore: null, window: { date: h.date, mult: h.mult, is_new: h.isNew },
      } as AnomalyFinding,
      hotKey: `offer:${h.key}`,
    })),
  ]

  const seenKeys = new Set<string>()
  for (const { f, hotKey } of allFindings) {
    seenKeys.add(f.dedupeKey)
    const existing = open.get(f.dedupeKey)
    if (existing) {
      await supabaseAdmin.from('anomaly_events').update({
        value: f.value, baseline: f.baseline, spread: f.spread, zscore: f.zscore,
        severity: f.severity, window: { ...(f.window ?? {}), calm_runs: 0 },
        last_seen_at: nowIso,
      }).eq('id', existing.id)
      if (hotKey) hotEventIds.set(hotKey, existing.id)
      continue
    }
    const { data: inserted } = await supabaseAdmin.from('anomaly_events').insert({
      organization_id: orgId, project_id: projectId, campaign_id: campaignId,
      metric: f.metric, dimension: f.dimension, dedupe_key: f.dedupeKey,
      direction: f.direction, severity: f.severity,
      value: f.value, baseline: f.baseline, spread: f.spread, zscore: f.zscore,
      window: { ...(f.window ?? {}), calm_runs: 0 },
      cooldown_until: cooldownIso,
      ...(f.severity === 'high' ? { telegram_sent_at: nowIso } : {}),
    }).select('id').single()
    if (inserted && hotKey) hotEventIds.set(hotKey, inserted.id)

    if (f.severity === 'high') {
      immediateMsgs.push(anomalyAlertText(f))
    }
  }

  // Tự resolve: event mở mà 2 run liên tiếp không còn cháy → coi như êm trở lại.
  for (const [key, row] of open) {
    if (seenKeys.has(key)) continue
    const calmRuns = ((row.window as { calm_runs?: number })?.calm_runs ?? 0) + 1
    if (calmRuns >= 2) {
      await supabaseAdmin.from('anomaly_events').update({ state: 'resolved', last_seen_at: nowIso }).eq('id', row.id)
    } else {
      await supabaseAdmin.from('anomaly_events').update({ window: { ...(row.window ?? {}), calm_runs: calmRuns } }).eq('id', row.id)
    }
  }

  return { immediateMsgs, hotEventIds }
}

function anomalyAlertText(f: AnomalyFinding): string {
  const day = (f.window as { date?: string }).date ?? ''
  switch (f.metric) {
    case 'cpc': return `🔺 <b>Giá click tăng vọt</b> ngày ${day}: ${fmtUsd(f.value)}/click (bình thường ~${fmtUsd(f.baseline)}).`
    case 'ctr': return `🔻 <b>Tỷ lệ bấm sập</b> ngày ${day}: ${f.value.toFixed(2)}% (bình thường ~${f.baseline.toFixed(2)}%). Kiểm tra mẫu quảng cáo có bị từ chối không.`
    case 'spend': return `💸 <b>Chi phí bùng</b> ngày ${day}: ${fmtUsd(f.value)} (bình thường ~${fmtUsd(f.baseline)}/ngày).`
    case 'revenue': return f.direction === 'down'
      ? `📉 <b>Doanh thu tụt mạnh</b> ngày ${day}: ${fmtUsd(f.value)} (bình thường ~${fmtUsd(f.baseline)}/ngày).`
      : `📈 <b>Doanh thu tăng vọt</b> ngày ${day}: ${fmtUsd(f.value)} (bình thường ~${fmtUsd(f.baseline)}/ngày) — xem tab Hành động để tách test.`
    case 'roi': return `⚠️ <b>Lãi/lỗ tụt mạnh</b> ngày ${day}: ROI ${f.value.toFixed(0)}% (bình thường ~${f.baseline.toFixed(0)}%).`
    case 'geo_revenue': return `🌍 <b>Nước hot</b>: ${countryNameByGeoId(String(f.dimension?.geo)) ?? f.dimension?.geo} mang về ${fmtUsd(f.value)} ngày ${day}${f.baseline > 0 ? ` (gấp ${(f.value / f.baseline).toFixed(1)}× bình thường)` : ' (nước mới!)'} — đã đề xuất phiếu test.`
    case 'offer_revenue': return `🎯 <b>Offer hot</b>: "${f.dimension?.offer}" mang về ${fmtUsd(f.value)} ngày ${day}${f.baseline > 0 ? ` (gấp ${(f.value / f.baseline).toFixed(1)}× bình thường)` : ' (offer mới!)'} — đã đề xuất phiếu test.`
    case 'confirm_rate': return `🏦 <b>Network trả thiếu hơn</b>: kỳ mới chỉ thực trả ${f.value.toFixed(0)}% tiền màn hình (các kỳ trước ~${f.baseline.toFixed(0)}%).`
    case 'cpc_trend': return `🐢🔺 <b>Giá click bò dần lên</b>: +${f.value.toFixed(0)}% tích lũy trong ${(f.window as { window_days?: number }).window_days} ngày.`
    case 'revenue_trend': return `🐢🔻 <b>Doanh thu nguội dần</b>: ${f.value.toFixed(0)}% tích lũy trong ${(f.window as { window_days?: number }).window_days} ngày.`
    default: return `⚡ Chỉ số bất thường (${f.metric}) ngày ${day}.`
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff candidates ↔ optimizer_suggestions (persist, dedupe, cooldown, expire)
// ─────────────────────────────────────────────────────────────────────────────

async function diffSuggestions(
  orgId: string, projectId: string, campaignId: string,
  candidates: OptimizationSuggestion[],
  ruleStats: Record<string, RuleStat>,
  th: Thresholds,
): Promise<{ inserted: number; updated: number; newForDigest: { title: string; severity: string }[] }> {
  const nowIso = new Date().toISOString()
  const { data: existingRows } = await supabaseAdmin.from('optimizer_suggestions')
    .select('id, dedupe_key, state, last_seen_at, evaluated_at')
    .eq('campaign_id', campaignId)
    .gte('issued_at', daysAgoIso(60))
  const existing = existingRows ?? []
  const openByKey = new Map(existing.filter(r => ['proposed', 'applied', 'evaluating'].includes(r.state)).map(r => [r.dedupe_key, r]))

  let inserted = 0, updated = 0
  const newForDigest: { title: string; severity: string }[] = []
  const candidateKeys = new Set<string>()

  for (const c of candidates) {
    const key = c.dedupeKey ?? c.ruleKey
    if (!key || candidateKeys.has(key)) continue
    candidateKeys.add(key)
    const score = suggestionScore(c.impactScore, c.confidence, ruleStats[c.ruleKey!])
    const openTwin = openByKey.get(key)

    if (openTwin) {
      if (openTwin.state === 'proposed') {
        await supabaseAdmin.from('optimizer_suggestions').update({
          severity: c.severity, confidence: c.confidence, suggestion_type: c.type,
          title: c.title, detail: c.detail, action: c.recommendedAction,
          evidence: { evidence: c.evidence, items: c.items ?? null, scope: c.scope },
          params: c.params ?? {},
          impact_estimate: c.impactScore, score,
          last_seen_at: nowIso,
        }).eq('id', openTwin.id)
      } else {
        await supabaseAdmin.from('optimizer_suggestions').update({ last_seen_at: nowIso }).eq('id', openTwin.id)
      }
      updated++
      continue
    }

    // Cooldown: vừa bị bỏ qua / hết hạn / thua thì đừng nhắc lại ngay.
    const cooledTwin = existing.find(r =>
      r.dedupe_key === key
      && ['dismissed', 'expired', 'lost'].includes(r.state)
      && new Date(r.evaluated_at ?? r.last_seen_at).getTime() > Date.now() - th.EV_COOLDOWN_DAYS * 86400000)
    if (cooledTwin) continue

    const { error } = await supabaseAdmin.from('optimizer_suggestions').insert({
      organization_id: orgId, project_id: projectId, campaign_id: campaignId,
      rule_key: c.ruleKey, dedupe_key: key, state: 'proposed',
      severity: c.severity, confidence: c.confidence, suggestion_type: c.type,
      title: c.title, detail: c.detail, action: c.recommendedAction,
      evidence: { evidence: c.evidence, items: c.items ?? null, scope: c.scope },
      params: c.params ?? {},
      impact_estimate: c.impactScore, score,
    })
    if (!error) {
      inserted++
      newForDigest.push({ title: c.title, severity: c.severity })
    }
  }

  // Expire: đề xuất đang mở mà rule hết cháy đủ lâu → tự ẩn.
  const expireCutoff = new Date(Date.now() - th.EV_EXPIRE_DAYS * 86400000).toISOString()
  for (const [key, row] of openByKey) {
    if (candidateKeys.has(key)) continue
    if (row.state === 'proposed' && row.last_seen_at < expireCutoff) {
      await supabaseAdmin.from('optimizer_suggestions').update({ state: 'expired' }).eq('id', row.id)
    }
  }

  return { inserted, updated, newForDigest }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chấm outcome đề xuất đã áp dụng (feedback loop) + guard confounded
// ─────────────────────────────────────────────────────────────────────────────

async function evaluateDueSuggestions(
  projectId: string, campaignId: string,
  ruleStats: Record<string, RuleStat>,
  th: Thresholds,
): Promise<number> {
  const today = todayIso()
  const { data: dueRows } = await supabaseAdmin.from('optimizer_suggestions')
    .select('id, rule_key, state, applied_at, evaluate_after, params')
    .eq('project_id', projectId)
    .in('state', ['applied', 'evaluating'])
    .lte('evaluate_after', today)
  const due = dueRows ?? []
  if (!due.length) return 0

  // Toàn bộ đề xuất applied/evaluating của camp (để phát hiện cửa sổ chồng nhau).
  const { data: allApplied } = await supabaseAdmin.from('optimizer_suggestions')
    .select('id, applied_at, evaluate_after')
    .eq('campaign_id', campaignId)
    .in('state', ['applied', 'evaluating', 'won', 'lost', 'inconclusive'])
    .not('applied_at', 'is', null)

  const { data: statRows } = await supabaseAdmin.from('optimizer_daily_stats')
    .select('date, spend, revenue_screen, clicks, impressions, mature')
    .eq('project_id', projectId)
    .gte('date', daysAgoIso(120))
  const stats: EvalDailyStat[] = (statRows ?? [])

  let evaluated = 0
  for (const s of due) {
    const spec = RULE_EVAL[s.rule_key]
    const appliedDate = s.applied_at ? s.applied_at.slice(0, 10) : null
    if (!spec || !appliedDate) {
      await supabaseAdmin.from('optimizer_suggestions').update({
        state: 'inconclusive', evaluated_at: new Date().toISOString(),
        outcome: { verdict: 'inconclusive', note: 'Rule không có spec đo kết quả' },
      }).eq('id', s.id)
      continue
    }

    const out = evaluateOutcome({ spec, appliedDate, stats, windowDays: th.EV_WINDOW_DAYS, winPct: th.EV_WIN_PCT })

    if (out.status === 'need_more_data') {
      const extendedAlready = (s.params as { eval_extended?: boolean })?.eval_extended
      if (!extendedAlready) {
        await supabaseAdmin.from('optimizer_suggestions').update({
          state: 'evaluating',
          evaluate_after: new Date(Date.now() + th.EV_WINDOW_DAYS * 86400000).toISOString().slice(0, 10),
          params: { ...(s.params ?? {}), eval_extended: true },
        }).eq('id', s.id)
      } else {
        await supabaseAdmin.from('optimizer_suggestions').update({
          state: 'inconclusive', evaluated_at: new Date().toISOString(),
          outcome: { verdict: 'inconclusive', metric: spec.metric, note: 'Không đủ dữ liệu sau khi đã gia hạn cửa sổ đo' },
        }).eq('id', s.id)
        bumpStat(ruleStats, s.rule_key, 'inconclusive')
        evaluated++
      }
      continue
    }

    // Confounded: có đề xuất khác áp cùng camp với cửa sổ đo chồng nhau →
    // không biết thay đổi nào tạo kết quả → không tính vào độ tin cậy rule.
    const myEnd = s.evaluate_after as string
    const confounded = (allApplied ?? []).some(o =>
      o.id !== s.id && o.applied_at && o.evaluate_after
      && windowsOverlap(appliedDate, myEnd, o.applied_at.slice(0, 10), o.evaluate_after))

    const verdict = out.verdict!
    const finalState = confounded ? 'inconclusive' : verdict === 'won' ? 'won' : verdict === 'lost' ? 'lost' : 'inconclusive'
    await supabaseAdmin.from('optimizer_suggestions').update({
      state: finalState,
      evaluated_at: new Date().toISOString(),
      outcome: {
        verdict: confounded ? 'confounded' : verdict,
        metric: out.metric, pre: out.pre, post: out.post, delta_pct: out.deltaPct,
        ...(confounded ? { note: 'Nhiều thay đổi áp cùng lúc trên camp — không tách được tác động' } : {}),
      },
    }).eq('id', s.id)
    bumpStat(ruleStats, s.rule_key, confounded ? 'confounded' : verdict)
    evaluated++
  }
  return evaluated
}

function bumpStat(stats: Record<string, RuleStat>, ruleKey: string, verdict: 'won' | 'lost' | 'inconclusive' | 'confounded') {
  const s = stats[ruleKey] ?? { won: 0, lost: 0, inconclusive: 0, confounded: 0 }
  s[verdict] = (s[verdict] ?? 0) + 1
  stats[ruleKey] = s
}

// ─────────────────────────────────────────────────────────────────────────────
// Phiếu test — seed draft từ đột biến cơ hội / giả thuyết win-day
// ─────────────────────────────────────────────────────────────────────────────

async function seedTickets(opts: {
  orgId: string
  projectId: string
  campaignId: string
  th: Thresholds
  hot: { geo: HotFinding[]; offer: HotFinding[] }
  anomalyIds: Map<string, string>
  winLift: OptimizationSuggestion | null
  medianDailySpend: number
  dailyStats: DailyStatPoint[]
}): Promise<number> {
  const { orgId, projectId, th } = opts
  let created = 0

  const { data: existingTickets } = await supabaseAdmin.from('test_tickets')
    .select('id, target, state, concluded_at, conclusion')
    .eq('project_id', projectId)
    .gte('created_at', daysAgoIso(90))
  const tickets = existingTickets ?? []

  const hasBlockingTicket = (kind: 'geo' | 'offer', key: string) => tickets.some(t => {
    const tg = (t.target ?? {}) as TicketTarget
    const match = kind === 'geo' ? tg.geo === key : tg.offer === key
    if (!match) return false
    if (['proposed', 'accepted', 'awaiting_camp', 'running'].includes(t.state)) return true
    // Test thua → nghỉ TK_LOST_COOLDOWN_DAYS mới đề xuất lại cùng ý tưởng.
    if (t.state === 'lost' && t.concluded_at
        && new Date(t.concluded_at).getTime() > Date.now() - th.TK_LOST_COOLDOWN_DAYS * 86400000) return true
    return false
  })

  const controlSnapshot = () => {
    const mature = opts.dailyStats.filter(d => d.mature)
    const spend = mature.reduce((s, d) => s + d.spend, 0)
    const rev = mature.reduce((s, d) => s + d.revenue_screen, 0)
    return {
      campaign_id: opts.campaignId,
      days: mature.length, spend, revenue: rev,
      roi: spend > 0 ? ((rev - spend) / spend) * 100 : null,
      snapshot_at: todayIso(),
    }
  }

  const insertTicket = async (source: 'anomaly' | 'insight', sourceId: string | null, hypothesis: string, target: TicketTarget) => {
    const draft = synthesizeTicket({
      th, hypothesis, target,
      sourceMedianDailySpend: opts.medianDailySpend,
      control: controlSnapshot(),
    })
    const { data: ins } = await supabaseAdmin.from('test_tickets').insert({
      organization_id: orgId, project_id: projectId,
      source, source_id: sourceId, state: 'proposed',
      hypothesis: draft.hypothesis, target: draft.target as unknown as Record<string, unknown>,
      test_budget: draft.test_budget, max_days: draft.max_days, min_clicks: draft.min_clicks,
      success_criteria: draft.success_criteria, stoploss: draft.stoploss, control: draft.control,
    }).select('id, ticket_code').single()
    if (ins) {
      created++
      if (sourceId) await supabaseAdmin.from('anomaly_events').update({ test_ticket_id: ins.id }).eq('id', sourceId)
    }
  }

  // Nước hot → phiếu tách camp riêng cho nước đó.
  for (const h of opts.hot.geo) {
    if (h.severity !== 'high' && !h.isNew) continue        // warn nhẹ chưa cần phiếu — tránh spam
    if (hasBlockingTicket('geo', h.key)) continue
    const label = countryNameByGeoId(h.key) ?? h.key
    await insertTicket(
      'anomaly', opts.anomalyIds.get(`geo:${h.key}`) ?? null,
      h.isNew
        ? `Nước MỚI ${label} tự nhiên mang về ${fmtUsd(h.todayUsd)} ngày ${h.date} dù không nhắm riêng — tách camp nhắm đúng nước này để xác nhận nguồn tiền và scale.`
        : `Doanh thu nước ${label} ngày ${h.date} = ${fmtUsd(h.todayUsd)}, gấp ${(h.mult ?? 0).toFixed(1)}× bình thường (~${fmtUsd(h.baselineUsd)}/ngày) — tách camp riêng cho ${label} để xác nhận không phải may mắn 1 ngày.`,
      { geo: h.key, geoLabel: label, notes: 'Tạo camp mới CHỈ nhắm nước này, copy keyword đang thắng từ camp gốc.' },
    )
  }
  // Offer hot → phiếu dồn ngân sách test offer.
  for (const h of opts.hot.offer) {
    if (h.severity !== 'high' && !h.isNew) continue
    if (hasBlockingTicket('offer', h.key)) continue
    await insertTicket(
      'anomaly', opts.anomalyIds.get(`offer:${h.key}`) ?? null,
      h.isNew
        ? `Offer mới "${h.key}" mang về ${fmtUsd(h.todayUsd)} ngày ${h.date} — test camp riêng cho offer này.`
        : `Offer "${h.key}" ngày ${h.date} mang về ${fmtUsd(h.todayUsd)}, gấp ${(h.mult ?? 0).toFixed(1)}× bình thường — test tăng phân bổ cho offer này bằng camp riêng.`,
      { offer: h.key, notes: 'Camp mới trỏ ref-link offer này; giữ nguyên geo/keyword đang chạy tốt.' },
    )
  }

  // Giả thuyết win-day (phân khúc nghiêng hẳn về ngày lãi) → phiếu tách thử.
  if (opts.winLift) {
    const lifts = (opts.winLift.params as { lifts?: { dim: string; value: string; label: string; liftPp: number }[] })?.lifts ?? []
    const topGeo = lifts.find(l => l.dim === 'geo')
    if (topGeo && !hasBlockingTicket('geo', topGeo.value)
        && !tickets.some(t => t.state === 'proposed' && (t.target as TicketTarget)?.notes?.includes('win-day'))) {
      await insertTicket(
        'insight', null,
        `Những ngày camp LÃI, tiền quảng cáo thường dồn vào ${topGeo.label} (chênh ${topGeo.liftPp.toFixed(0)} điểm % so với ngày lỗ) — tách ${topGeo.label} chạy riêng để biết chắc có phải nguồn lãi thật.`,
        { geo: topGeo.value, geoLabel: topGeo.label, notes: 'Nguồn: phân tích ngày thắng/thua (win-day). Tương quan, chưa chắc nhân quả — phiếu test này để xác nhận.' },
      )
    }
  }

  return created
}

// ─────────────────────────────────────────────────────────────────────────────
// Phiếu test — auto-link camp mới + chấm hằng ngày + dọn phiếu quên (per org)
// ─────────────────────────────────────────────────────────────────────────────

async function processTickets(orgId: string, th: Thresholds): Promise<{ evaluated: number; immediateMsgs: string[] }> {
  const immediateMsgs: string[] = []
  let evaluated = 0

  const { data: ticketRows } = await supabaseAdmin.from('test_tickets')
    .select('*')
    .eq('organization_id', orgId)
    .in('state', ['proposed', 'accepted', 'awaiting_camp', 'running'])
  const tickets = ticketRows ?? []
  if (!tickets.length) return { evaluated, immediateMsgs }

  for (const t of tickets) {
    // Dọn phiếu quên: đề xuất/chấp nhận mãi không gắn camp.
    const ageDays = (Date.now() - new Date(t.created_at).getTime()) / 86400000
    if (['proposed'].includes(t.state) && ageDays > th.TK_ABANDON_DAYS) {
      await supabaseAdmin.from('test_tickets').update({ state: 'expired', updated_at: new Date().toISOString() }).eq('id', t.id)
      continue
    }
    if (['accepted', 'awaiting_camp'].includes(t.state) && ageDays > th.TK_ABANDON_DAYS) {
      await supabaseAdmin.from('test_tickets').update({ state: 'abandoned', updated_at: new Date().toISOString() }).eq('id', t.id)
      continue
    }

    // Auto-link: user đặt mã phiếu (vd T-0042) vào tên camp mới → engine tự gắn.
    if (['accepted', 'awaiting_camp'].includes(t.state) && !t.test_campaign_id) {
      const { data: disc } = await supabaseAdmin.from('campaign_discoveries')
        .select('campaign_id, campaign_name')
        .ilike('campaign_name', `%${t.ticket_code}%`)
        .limit(1)
      if (disc?.length) {
        await supabaseAdmin.from('test_tickets').update({
          test_campaign_id: disc[0].campaign_id, state: 'running', updated_at: new Date().toISOString(),
        }).eq('id', t.id)
        t.test_campaign_id = disc[0].campaign_id
        t.state = 'running'
        immediateMsgs.push(`🧪 Phiếu ${t.ticket_code} đã tự gắn với camp mới "${disc[0].campaign_name}" — bắt đầu theo dõi.`)
      } else if (t.state === 'accepted') {
        await supabaseAdmin.from('test_tickets').update({ state: 'awaiting_camp', updated_at: new Date().toISOString() }).eq('id', t.id)
      }
    }

    // Chấm phiếu đang chạy.
    if (t.state === 'running' && t.test_campaign_id) {
      const log = await buildTicketLog(t.test_campaign_id, t.test_project_id ?? null, t.started_at ?? daysAgoIso(60))
      if (!log.length) continue
      const startedAt = t.started_at ?? log[0].date
      const verdict = evaluateTicket({
        log, th,
        maxDays: t.max_days, minClicks: t.min_clicks,
        criteria: { threshold: (t.success_criteria?.threshold ?? th.TARGET_ROI) as number, min_revenue: (t.success_criteria?.min_revenue ?? th.TK_MIN_REVENUE) as number },
        stoploss: { max_spend_no_revenue: (t.stoploss?.max_spend_no_revenue ?? t.test_budget) as number },
      })
      evaluated++

      const update: Record<string, unknown> = {
        daily_log: log, started_at: startedAt, updated_at: new Date().toISOString(),
      }
      if (verdict.verdict !== 'running') {
        update.state = verdict.verdict
        update.concluded_at = new Date().toISOString()
        update.conclusion = {
          verdict: verdict.verdict, ...verdict.totals, reason: verdict.reason,
          vs_control: (t.control as { roi?: number | null })?.roi ?? null,
        }
        if (verdict.verdict === 'won') {
          // Thắng → tự đề xuất scale camp test.
          const { data: fu } = await supabaseAdmin.from('optimizer_suggestions').insert({
            organization_id: orgId, project_id: t.test_project_id ?? t.project_id, campaign_id: t.test_campaign_id,
            rule_key: 'scale_test_winner', dedupe_key: `scale_test_winner:${t.ticket_code}`, state: 'proposed',
            severity: 'high', confidence: 'roi', suggestion_type: 'raise_budget',
            title: `Phiếu ${t.ticket_code} THẮNG — scale camp test`,
            detail: `Test kết luận THẮNG: ${verdict.reason} Giả thuyết: ${t.hypothesis}`,
            action: 'Tăng ngân sách camp test từng bước 15-25%/lần, giữ ROI trên ngưỡng; cân nhắc chuyển thành camp chính thức.',
            evidence: { evidence: [
              { metric: 'ROI test', value: `${verdict.totals.roi?.toFixed(0) ?? '?'}%` },
              { metric: 'Doanh thu test', value: fmtUsd(verdict.totals.revenue) },
              { metric: 'Số ngày', value: String(verdict.totals.days) },
            ], items: null, scope: { level: 'campaign', label: t.ticket_code } },
            params: { ticket_id: t.id, ticket_code: t.ticket_code },
            impact_estimate: verdict.totals.revenue, score: verdict.totals.revenue,
          }).select('id').single()
          if (fu) update.follow_up_suggestion_id = fu.id
          immediateMsgs.push(`🏆 <b>Phiếu ${t.ticket_code} THẮNG</b> — ${verdict.reason} Đã tạo đề xuất scale trong tab Hành động.`)
        } else if (verdict.verdict === 'stopped') {
          immediateMsgs.push(`🛑 <b>Phiếu ${t.ticket_code} chạm stop-loss</b> — ${verdict.reason} Tạm dừng camp test ngay.`)
        } else {
          immediateMsgs.push(`❌ Phiếu ${t.ticket_code} kết luận THUA — ${verdict.reason}`)
        }
      }
      await supabaseAdmin.from('test_tickets').update(update).eq('id', t.id)
    }
  }

  return { evaluated, immediateMsgs }
}

// Log ngày của camp test: chi phí + click từ Google Ads; doanh thu từ project test
// (ưu tiên) hoặc breakdown gắn theo campaign (khi ref dùng sub_id={campaignid}).
async function buildTicketLog(testCampaignId: string, testProjectId: string | null, fromDate: string): Promise<TicketDay[]> {
  const [metricsRes, revRes, bdRes] = await Promise.all([
    supabaseAdmin.from('campaign_metrics')
      .select('date, clicks, cost').eq('campaign_id', testCampaignId).gte('date', fromDate),
    testProjectId
      ? supabaseAdmin.from('affiliate_revenue')
          .select('date, amount, cycle_end').eq('project_id', testProjectId).eq('type', 'pending').gte('date', fromDate)
      : Promise.resolve({ data: null }),
    !testProjectId
      ? supabaseAdmin.from('revenue_breakdown')
          .select('date, revenue, currency, revenue_usd, revenue_type').eq('campaign_id', testCampaignId).gte('date', fromDate)
      : Promise.resolve({ data: null }),
  ])

  const revByDate = new Map<string, number>()
  if (testProjectId && revRes.data) {
    const rows: PendingRow[] = revRes.data.map((r: { date: string; amount: number | null; cycle_end: boolean | null }) => ({ date: r.date, amount: r.amount ?? 0, cycle_end: r.cycle_end }))
    const { byDate } = computeScreenRevenue(rows, false, 0)
    for (const [d, v] of Object.entries(byDate)) revByDate.set(d, v)
  } else if (bdRes.data) {
    for (const r of bdRes.data as { date: string; revenue: number; currency: string; revenue_usd: number | null; revenue_type: string }[]) {
      if (r.revenue_type === 'confirmed') continue
      const usd = usdOf(r) ?? 0
      revByDate.set(r.date, (revByDate.get(r.date) ?? 0) + usd)
    }
  }

  const spendByDate = new Map<string, { spend: number; clicks: number }>()
  for (const m of metricsRes.data ?? []) {
    const cur = spendByDate.get(m.date) ?? { spend: 0, clicks: 0 }
    cur.spend += m.cost ?? 0
    cur.clicks += m.clicks ?? 0
    spendByDate.set(m.date, cur)
  }

  const dates = [...new Set([...spendByDate.keys(), ...revByDate.keys()])].sort()
  return dates.map(date => {
    const s = spendByDate.get(date) ?? { spend: 0, clicks: 0 }
    const revenue = revByDate.get(date) ?? 0
    return {
      date, spend: s.spend, revenue, clicks: s.clicks,
      roi: s.spend > 0 ? ((revenue - s.spend) / s.spend) * 100 : null,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Digest 1 lần/ngày
// ─────────────────────────────────────────────────────────────────────────────

async function buildDigest(orgId: string, newSuggestions: DigestSummary['newSuggestions']): Promise<DigestSummary> {
  const [anomaliesRes, ticketsRes, concludedRes] = await Promise.all([
    supabaseAdmin.from('anomaly_events').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('state', 'open'),
    supabaseAdmin.from('test_tickets').select('ticket_code, state, daily_log, max_days')
      .eq('organization_id', orgId).eq('state', 'running'),
    supabaseAdmin.from('test_tickets').select('ticket_code, conclusion')
      .eq('organization_id', orgId).in('state', ['won', 'lost', 'stopped'])
      .gte('concluded_at', new Date(Date.now() - 86400000).toISOString()),
  ])
  return {
    newSuggestions,
    anomalies: anomaliesRes.count ?? 0,
    runningTickets: (ticketsRes.data ?? []).map(t => ({
      code: t.ticket_code, state: t.state,
      note: `ngày ${(t.daily_log as unknown[])?.length ?? 0}/${t.max_days}`,
    })),
    concludedYesterday: (concludedRes.data ?? []).map(t => ({
      code: t.ticket_code, verdict: (t.conclusion as { verdict?: string })?.verdict ?? '?',
    })),
  }
}
