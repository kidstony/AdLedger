import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { canReadProject, canWriteProject } from '@/lib/optimizer/access'
import { mergeThresholds } from '@/lib/optimizer/defaults'
import { synthesizeTicket } from '@/lib/optimizer/tests'

// GET /api/optimize/tests?project_id=...&all=1 — danh sách phiếu test.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  if (!(await canReadProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const includeAll = url.searchParams.get('all') === '1'
  let q = supabaseAdmin.from('test_tickets').select('*')
    .eq('project_id', project_id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (!includeAll) q = q.in('state', ['proposed', 'accepted', 'awaiting_camp', 'running'])
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tickets: data ?? [] })
}

// POST /api/optimize/tests — tạo phiếu test thủ công (source='manual').
export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const project_id = body?.project_id as string | undefined
  const hypothesis = (body?.hypothesis as string | undefined)?.trim()
  if (!project_id || !hypothesis)
    return NextResponse.json({ error: 'Cần project_id và hypothesis (giả thuyết test)' }, { status: 400 })
  if (!(await canWriteProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: settings } = caller.organization_id
    ? await supabaseAdmin.from('optimizer_settings')
        .select('thresholds').eq('organization_id', caller.organization_id).is('project_id', null).maybeSingle()
    : { data: null }
  const th = mergeThresholds((settings?.thresholds ?? {}) as Record<string, number>)

  const draft = synthesizeTicket({
    th, hypothesis,
    target: (body?.target as Record<string, unknown>) ?? {},
    sourceMedianDailySpend: Number(body?.median_daily_spend) || 0,
    control: {},
  })

  const { data: ins, error } = await supabaseAdmin.from('test_tickets').insert({
    organization_id: caller.organization_id ?? null,
    project_id,
    source: 'manual',
    state: 'accepted',           // user tự tạo = đã chấp nhận luôn
    hypothesis: draft.hypothesis,
    target: draft.target as unknown as Record<string, unknown>,
    test_budget: Number(body?.test_budget) || draft.test_budget,
    max_days: Number(body?.max_days) || draft.max_days,
    min_clicks: Number(body?.min_clicks) || draft.min_clicks,
    success_criteria: body?.success_criteria ?? draft.success_criteria,
    stoploss: body?.stoploss ?? draft.stoploss,
    control: draft.control,
  }).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, ticket: ins })
}
