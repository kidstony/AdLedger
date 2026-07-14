import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { optimizeCampaign } from '@/lib/campaign-optimizer'
import { loadCampaignBundle } from '@/lib/optimizer/stats-loader'
import { markDirty, runAnalysis } from '@/lib/optimizer/engine'
import { rowToSuggestion, PersistedSuggestion, SuggestionRow } from '@/lib/optimizer/persisted'
import { OptSeverity } from '@/lib/types'

// GET /api/optimize?project_id=...&from=...&to=...
// Phân tích 1 camp (theo project) và trả gợi ý tối ưu. Dùng service_role +
// kiểm quyền trong code (giống pnl-summary). Phần lắp ráp dữ liệu nằm ở
// src/lib/optimizer/stats-loader.ts (dùng chung với engine chạy nền).
//
// Optimizer v2: danh sách đề xuất ưu tiên đọc từ DB (optimizer_suggestions —
// engine chạy nền ghi, có vòng đời + độ tin cậy). Org chưa từng chạy engine
// (chưa migrate) → fallback tính live như cũ. Health/breakdown/winday/launch
// luôn tính live (rẻ + cần phản ánh đúng khoảng ngày user chọn).
const STALE_HOURS = 12

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  const from = url.searchParams.get('from') ?? '2000-01-01'
  const to   = url.searchParams.get('to')   ?? new Date().toISOString().split('T')[0]

  // Kiểm quyền theo role (mirror pnl-summary).
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

  const loaded = await loadCampaignBundle({ project_id, from, to, organizationId: caller.organization_id ?? null })
  if (!loaded.ok) {
    if (loaded.code === 'NO_PROJECT')
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    return NextResponse.json({ error: 'Project chưa gắn Google campaign', code: 'NO_CAMPAIGN' }, { status: 400 })
  }
  const { bundle } = loaded

  const result = optimizeCampaign(bundle.input)

  // ── Optimizer v2: đề xuất persist + anomaly + phiếu test + lần chạy cuối ──
  const orgId = caller.organization_id ?? null
  let lastRunAt: string | null = null
  let persisted = false
  let v2Suggestions: PersistedSuggestion[] = []
  let anomalies: unknown[] = []
  let tests: unknown[] = []
  let ruleStats: Record<string, unknown> = {}

  if (orgId) {
    const [stateRes, sugRes, anomRes, testRes] = await Promise.all([
      supabaseAdmin.from('optimizer_state')
        .select('last_run_at, dirty_since, rule_stats').eq('organization_id', orgId).maybeSingle(),
      supabaseAdmin.from('optimizer_suggestions')
        .select('*').eq('project_id', project_id)
        .in('state', ['proposed', 'applied', 'evaluating'])
        .order('score', { ascending: false }),
      supabaseAdmin.from('anomaly_events')
        .select('id, metric, dimension, direction, severity, value, baseline, zscore, window, state, detected_at, last_seen_at')
        .eq('project_id', project_id).eq('state', 'open')
        .order('detected_at', { ascending: false }).limit(20),
      supabaseAdmin.from('test_tickets')
        .select('id, ticket_code, state, hypothesis, target, test_budget, max_days, min_clicks, success_criteria, stoploss, test_campaign_id, test_project_id, started_at, daily_log, conclusion, created_at')
        .eq('project_id', project_id)
        .in('state', ['proposed', 'accepted', 'awaiting_camp', 'running'])
        .order('created_at', { ascending: false }),
    ])
    const state = stateRes.data
    lastRunAt = state?.last_run_at ?? null
    ruleStats = (state?.rule_stats as Record<string, unknown>) ?? {}
    anomalies = anomRes.data ?? []
    tests = testRes.data ?? []

    if (lastRunAt) {
      persisted = true
      v2Suggestions = ((sugRes.data ?? []) as SuggestionRow[]).map(rowToSuggestion)
    }

    // Stale-check: quá lâu chưa chạy / còn cờ dữ liệu mới → phân tích lại sau khi trả response.
    const stale = !lastRunAt
      || Date.now() - new Date(lastRunAt).getTime() > STALE_HOURS * 3600_000
      || !!state?.dirty_since
    if (stale) {
      after(async () => {
        try {
          await markDirty(orgId)
          await runAnalysis({ organizationId: orgId, trigger: 'pageload' })
        } catch (e) {
          console.error('[optimizer] pageload trigger failed:', e)
        }
      })
    }
  }

  // Persisted mode: tab "Đề xuất" hiển thị các đề xuất đang mở từ DB (sắp theo
  // severity rồi score); fallback = kết quả tính live như cũ.
  const rank: Record<OptSeverity, number> = { high: 3, medium: 2, low: 1 }
  const suggestions = persisted
    ? [...v2Suggestions].sort((a, b) => rank[b.severity] - rank[a.severity] || b.score - a.score)
    : result.suggestions

  return NextResponse.json({
    project: { project_id, name: bundle.project.name, cid: bundle.project.cid, campaign_id: bundle.campaign_id },
    range: { from, to },
    cost: bundle.cost,
    revenue: bundle.revenue,
    settings: bundle.settings,
    hasMetrics: bundle.hasMetrics,
    breakdown: bundle.bdMeta,
    ...result,
    suggestions,
    v2: { persisted, lastRunAt, anomalies, tests, ruleStats },
  })
}
