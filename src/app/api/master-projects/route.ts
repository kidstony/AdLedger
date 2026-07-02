import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json([], { status: 401 })

  if (caller.role === 'super_admin') {
    const { data } = await supabaseAdmin.from('master_projects').select('*').order('name')
    return NextResponse.json(data ?? [])
  }

  if (caller.role === 'manager' && caller.team_id) {
    const [{ data: teamProjects }, { data: teamMembers }] = await Promise.all([
      supabaseAdmin.from('projects').select('master_project_id').eq('team_id', caller.team_id).not('master_project_id', 'is', null),
      supabaseAdmin.from('user_profiles').select('user_id').eq('team_id', caller.team_id),
    ])
    const viaProjectIds = [...new Set((teamProjects ?? []).map(p => p.master_project_id as string))]
    const memberIds = (teamMembers ?? []).map(m => m.user_id as string)
    const { data: viaCreation } = memberIds.length
      ? await supabaseAdmin.from('master_projects').select('id').in('created_by', memberIds)
      : { data: [] }
    const allIds = [...new Set([...viaProjectIds, ...(viaCreation ?? []).map(r => r.id)])]
    if (!allIds.length) return NextResponse.json([])
    const { data } = await supabaseAdmin.from('master_projects').select('*').in('id', allIds).order('name')
    return NextResponse.json(data ?? [])
  }

  // member: accessible via project shares + person_in_charge + own creations
  const [{ data: shares }, { data: picProjects }, { data: ownCreations }] = await Promise.all([
    supabaseAdmin.from('project_shares').select('project_id').eq('user_id', caller.user_id),
    supabaseAdmin.from('projects').select('master_project_id').eq('person_in_charge', caller.user_id).not('master_project_id', 'is', null),
    supabaseAdmin.from('master_projects').select('id').eq('created_by', caller.user_id),
  ])
  const shareProjectIds = (shares ?? []).map(s => s.project_id as string)
  const { data: sharedMPs } = shareProjectIds.length
    ? await supabaseAdmin.from('projects').select('master_project_id').in('project_id', shareProjectIds).not('master_project_id', 'is', null)
    : { data: [] }
  const allIds = [...new Set([
    ...(sharedMPs ?? []).map(p => p.master_project_id as string),
    ...(picProjects ?? []).map(p => p.master_project_id as string),
    ...(ownCreations ?? []).map(r => r.id),
  ])]
  if (!allIds.length) return NextResponse.json([])
  const { data } = await supabaseAdmin.from('master_projects').select('*').in('id', allIds).order('name')
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager', 'member'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const id = slug + '-' + Date.now().toString(36)

  const { data, error } = await supabaseAdmin
    .from('master_projects')
    .insert({ id, name: name.trim(), description: null, created_by: caller.user_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
