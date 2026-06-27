import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile, getOrgTeamIds } from '@/lib/require-role'
import { memberCanDo } from '@/lib/check-member-permission'

export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabaseAdmin
    .from('other_costs')
    .select('*, cost_categories(id, name, color)')
    .order('date', { ascending: false })

  if (caller.role === 'super_admin' && caller.organization_id) {
    const teamIds = await getOrgTeamIds(caller.organization_id)
    const { data: orgProjects } = await supabaseAdmin
      .from('projects').select('project_id').in('team_id', teamIds)
    const projectIds = (orgProjects ?? []).map((p: { project_id: string }) => p.project_id)
    if (projectIds.length === 0) return NextResponse.json([])
    query = query.in('project_id', projectIds)
  }

  if (from) query = query.gte('date', from)
  if (to) query = query.lte('date', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (caller.role === 'member') {
    if (!body.project_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const allowed = await memberCanDo(caller.user_id, body.project_id, 'input_expense')
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('other_costs')
    .insert(body)
    .select('*, cost_categories(id, name, color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, cost_categories: _cats, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (caller.role === 'member') {
    const projectId = updates.project_id ?? body.project_id
    if (!projectId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const allowed = await memberCanDo(caller.user_id, projectId, 'input_expense')
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('other_costs')
    .update(updates)
    .eq('id', id)
    .select('*, cost_categories(id, name, color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (caller.role === 'member') {
    const { data: cost } = await supabaseAdmin
      .from('other_costs')
      .select('project_id')
      .eq('id', id)
      .maybeSingle()
    if (!cost?.project_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const allowed = await memberCanDo(caller.user_id, cost.project_id, 'input_expense')
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabaseAdmin
    .from('other_costs')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
