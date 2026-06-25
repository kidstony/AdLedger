import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// POST — giao dự án cho member (access_level = 'editor')
export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'super_admin' && caller.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { project_id, user_id } = await req.json()

  if (caller.role === 'manager') {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('team_id')
      .eq('project_id', project_id)
      .single()
    if (project?.team_id !== caller.team_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Upsert vào project_shares với editor level (thay thế project_members)
  const { error } = await supabaseAdmin
    .from('project_shares')
    .upsert(
      { project_id, user_id, shared_by: caller.user_id, access_level: 'editor' },
      { onConflict: 'project_id,user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

// DELETE — thu hồi quyền truy cập của member
export async function DELETE(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'super_admin' && caller.role !== 'manager') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { project_id, user_id } = await req.json()

  if (caller.role === 'manager') {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('team_id')
      .eq('project_id', project_id)
      .single()
    if (project?.team_id !== caller.team_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { error } = await supabaseAdmin
    .from('project_shares')
    .delete()
    .eq('project_id', project_id)
    .eq('user_id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
