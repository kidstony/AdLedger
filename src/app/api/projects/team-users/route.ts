import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Returns user_id + full_name for all members in the same team as the caller.
// Accessible by all roles — used to display person_in_charge names.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let query = supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name')
    .order('full_name')

  // Super admin: if scoped to org, filter by org; else all users
  if (caller.role === 'super_admin' && caller.organization_id) {
    query = query.eq('organization_id', caller.organization_id)
  } else if (caller.role === 'manager' && caller.team_id) {
    query = query.eq('team_id', caller.team_id)
  } else if (caller.role === 'member' && caller.team_id) {
    query = query.eq('team_id', caller.team_id)
  }
  // Global super_admin: returns all users

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    (data ?? []).map(u => ({ user_id: u.user_id, full_name: u.full_name ?? '' }))
  )
}
