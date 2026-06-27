import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabase-admin'

export async function requireRole(req: Request, allowedRoles: string[]): Promise<NextResponse | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!data?.role || !allowedRoles.includes(data.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return null
}

export async function getCallerProfile(req: Request): Promise<{ user_id: string; role: string; team_id: string | null; organization_id: string | null } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) return null

  const { data: { user } } = await supabaseAdmin.auth.getUser(token)
  if (!user) return null

  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('role, team_id, organization_id')
    .eq('user_id', user.id)
    .single()

  if (!data) return null
  return { user_id: user.id, role: data.role, team_id: data.team_id, organization_id: data.organization_id ?? null }
}

export async function getOrgTeamIds(organizationId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('teams').select('id').eq('organization_id', organizationId)
  return data?.map((t: { id: string }) => t.id) ?? []
}
