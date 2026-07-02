import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { data, error } = await supabaseAdmin
    .from('project_history')
    .select('id, field, old_value, new_value, user_name, created_at')
    .eq('project_id', project_id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
