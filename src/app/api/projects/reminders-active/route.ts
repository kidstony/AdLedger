import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Returns project_ids that have at least one non-triggered reminder for the current user
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('project_reminders')
    .select('project_id')
    .eq('user_id', caller.user_id)
    .eq('is_triggered', false)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const projectIds = [...new Set((data ?? []).map(r => r.project_id).filter(Boolean))] as string[]
  return NextResponse.json(projectIds)
}
