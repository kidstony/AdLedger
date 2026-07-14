import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { canReadProject } from '@/lib/optimizer/access'
import { rowToSuggestion, SuggestionRow } from '@/lib/optimizer/persisted'
import { ruleReliability, RuleStat } from '@/lib/optimizer/defaults'

// GET /api/optimize/actions?project_id=... — hàng đợi hành động (tab Hành động & Test):
// đề xuất mọi trạng thái 60 ngày gần nhất, nhóm theo vòng đời + độ tin cậy per-rule.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  if (!(await canReadProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const [sugRes, stateRes] = await Promise.all([
    supabaseAdmin.from('optimizer_suggestions')
      .select('*')
      .eq('project_id', project_id)
      .gte('issued_at', since)
      .order('issued_at', { ascending: false })
      .limit(200),
    caller.organization_id
      ? supabaseAdmin.from('optimizer_state')
          .select('last_run_at, rule_stats').eq('organization_id', caller.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const rows = ((sugRes.data ?? []) as SuggestionRow[]).map(rowToSuggestion)
  const ruleStats = ((stateRes.data as { rule_stats?: Record<string, RuleStat> } | null)?.rule_stats ?? {})

  // Độ tin cậy per-rule cho badge "rule này đúng X/Y lần".
  const reliability: Record<string, { won: number; lost: number; reliability: number }> = {}
  for (const [key, stat] of Object.entries(ruleStats)) {
    reliability[key] = { won: stat.won ?? 0, lost: stat.lost ?? 0, reliability: ruleReliability(stat) }
  }

  return NextResponse.json({
    open: rows.filter(r => r.state === 'proposed'),
    measuring: rows.filter(r => ['applied', 'evaluating'].includes(r.state)),
    concluded: rows.filter(r => ['won', 'lost', 'inconclusive'].includes(r.state)),
    dismissed: rows.filter(r => ['dismissed', 'expired'].includes(r.state)),
    reliability,
    lastRunAt: (stateRes.data as { last_run_at?: string } | null)?.last_run_at ?? null,
  })
}
