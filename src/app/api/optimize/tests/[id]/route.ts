import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { canWriteProject } from '@/lib/optimizer/access'

// PATCH /api/optimize/tests/[id] — vòng đời phiếu test:
//   action='accept'  : duyệt phiếu (kèm chỉnh budget/tiêu chí) → chờ gắn camp
//   action='link'    : gắn camp test (test_campaign_id, tùy chọn test_project_id)
//   action='stop'    : dừng tay (state='stopped')
//   action='abandon' : bỏ phiếu
//   action='override': sửa tay kết luận (won/lost) kèm note
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action as string | undefined
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 })

  const { data: t } = await supabaseAdmin.from('test_tickets').select('*').eq('id', id).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canWriteProject(caller, t.project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: nowIso }

  switch (action) {
    case 'accept': {
      if (t.state !== 'proposed')
        return NextResponse.json({ error: `Không thể duyệt từ trạng thái ${t.state}` }, { status: 400 })
      patch.state = 'awaiting_camp'
      if (body.test_budget != null) {
        patch.test_budget = Number(body.test_budget)
        patch.stoploss = { ...(t.stoploss ?? {}), max_spend_no_revenue: Number(body.test_budget) }
      }
      if (body.max_days != null) patch.max_days = Number(body.max_days)
      if (body.min_clicks != null) patch.min_clicks = Number(body.min_clicks)
      if (body.success_criteria != null) patch.success_criteria = body.success_criteria
      if (body.hypothesis) patch.hypothesis = String(body.hypothesis)
      break
    }
    case 'link': {
      if (!['accepted', 'awaiting_camp'].includes(t.state))
        return NextResponse.json({ error: `Không thể gắn camp từ trạng thái ${t.state}` }, { status: 400 })
      if (!body.test_campaign_id)
        return NextResponse.json({ error: 'Thiếu test_campaign_id' }, { status: 400 })
      patch.test_campaign_id = String(body.test_campaign_id)
      if (body.test_project_id) patch.test_project_id = String(body.test_project_id)
      patch.state = 'running'
      break
    }
    case 'stop': {
      if (t.state !== 'running')
        return NextResponse.json({ error: 'Chỉ dừng được phiếu đang chạy' }, { status: 400 })
      patch.state = 'stopped'
      patch.concluded_at = nowIso
      patch.conclusion = { verdict: 'stopped', reason: body?.note ?? 'Dừng tay', manual: true }
      break
    }
    case 'abandon': {
      if (!['proposed', 'accepted', 'awaiting_camp'].includes(t.state))
        return NextResponse.json({ error: 'Phiếu đang chạy — dùng action=stop' }, { status: 400 })
      patch.state = 'abandoned'
      break
    }
    case 'override': {
      const verdict = body?.verdict as string | undefined
      if (!verdict || !['won', 'lost'].includes(verdict))
        return NextResponse.json({ error: 'verdict phải là won|lost' }, { status: 400 })
      patch.state = verdict
      patch.concluded_at = t.concluded_at ?? nowIso
      patch.conclusion = { ...(t.conclusion ?? {}), verdict, manual: true, note: body?.note ?? null }
      break
    }
    default:
      return NextResponse.json({ error: `Action không hợp lệ: ${action}` }, { status: 400 })
  }

  const { data: updated, error } = await supabaseAdmin
    .from('test_tickets').update(patch).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, ticket: updated })
}
