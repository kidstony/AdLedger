import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { canReadProject, canWriteProject } from '@/lib/optimizer/access'

// GET /api/optimize/anomalies?project_id=... — danh sách chỉ số bất thường.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')
  if (!project_id) return NextResponse.json({ error: 'Missing project_id' }, { status: 400 })
  if (!(await canReadProject(caller, project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const includeResolved = url.searchParams.get('all') === '1'
  let q = supabaseAdmin.from('anomaly_events')
    .select('id, metric, dimension, direction, severity, value, baseline, zscore, window, state, suggestion_id, test_ticket_id, detected_at, last_seen_at')
    .eq('project_id', project_id)
    .order('detected_at', { ascending: false })
    .limit(50)
  if (!includeResolved) q = q.eq('state', 'open')
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ anomalies: data ?? [] })
}

// PATCH /api/optimize/anomalies — tắt tiếng 1 cảnh báo ({id, action:'mute'|'unmute'}).
export async function PATCH(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const id = body?.id as string | undefined
  const action = body?.action as 'mute' | 'unmute' | undefined
  if (!id || !action) return NextResponse.json({ error: 'Cần id và action' }, { status: 400 })

  const { data: ev } = await supabaseAdmin.from('anomaly_events')
    .select('id, project_id, state').eq('id', id).maybeSingle()
  if (!ev) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canWriteProject(caller, ev.project_id)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await supabaseAdmin.from('anomaly_events')
    .update({ state: action === 'mute' ? 'muted' : 'open' })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
