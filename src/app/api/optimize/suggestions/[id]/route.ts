import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { canWriteProject } from '@/lib/optimizer/access'
import { mergeThresholds, RULE_EVAL } from '@/lib/optimizer/defaults'

// PATCH /api/optimize/suggestions/[id] — vòng đời đề xuất (Optimizer v2):
//   action='applied'  : user đã làm theo trong Google Ads → hẹn ngày đo kết quả
//   action='dismissed': bỏ qua (kèm note) → cooldown, engine không nhắc lại ngay
//   action='reopen'   : mở lại đề xuất đã bỏ qua
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action as 'applied' | 'dismissed' | 'reopen' | undefined
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

  const { data: sug } = await supabaseAdmin
    .from('optimizer_suggestions')
    .select('id, project_id, organization_id, rule_key, state, params')
    .eq('id', id).maybeSingle()
  if (!sug) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canWriteProject(caller, sug.project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const nowIso = new Date().toISOString()

  if (action === 'applied') {
    if (!['proposed'].includes(sug.state))
      return NextResponse.json({ error: `Không thể đánh dấu áp dụng từ trạng thái ${sug.state}` }, { status: 400 })
    // Có spec đo → hẹn ngày chấm; không có (setup_tracking, data_quality...) → chỉ ghi nhận.
    const hasEval = !!RULE_EVAL[sug.rule_key]
    let evaluateAfter: string | null = null
    if (hasEval && sug.organization_id) {
      const { data: settings } = await supabaseAdmin.from('optimizer_settings')
        .select('thresholds').eq('organization_id', sug.organization_id).is('project_id', null).maybeSingle()
      const th = mergeThresholds((settings?.thresholds ?? {}) as Record<string, number>)
      evaluateAfter = new Date(Date.now() + th.EV_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
    } else if (hasEval) {
      evaluateAfter = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    }
    const { error } = await supabaseAdmin.from('optimizer_suggestions').update({
      state: 'applied',
      applied_at: nowIso,
      applied_by: caller.user_id,
      applied_note: body?.note ?? null,
      evaluate_after: evaluateAfter,
      last_seen_at: nowIso,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, evaluate_after: evaluateAfter })
  }

  if (action === 'dismissed') {
    if (!['proposed', 'applied', 'evaluating'].includes(sug.state))
      return NextResponse.json({ error: `Không thể bỏ qua từ trạng thái ${sug.state}` }, { status: 400 })
    const { error } = await supabaseAdmin.from('optimizer_suggestions').update({
      state: 'dismissed',
      dismissed_note: body?.note ?? null,
      last_seen_at: nowIso,
    }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // reopen
  if (sug.state !== 'dismissed')
    return NextResponse.json({ error: 'Chỉ mở lại được đề xuất đã bỏ qua' }, { status: 400 })
  const { error } = await supabaseAdmin.from('optimizer_suggestions').update({
    state: 'proposed', dismissed_note: null, last_seen_at: nowIso,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
