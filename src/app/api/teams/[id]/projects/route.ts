import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireRole } from '@/lib/require-role'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { project_id } = await req.json()

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ team_id: id })
    .eq('project_id', project_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const authErr = await requireRole(req, ['super_admin'])
  if (authErr) return authErr

  const { project_id } = await req.json()

  const { error } = await supabaseAdmin
    .from('projects')
    .update({ team_id: null })
    .eq('project_id', project_id)
    .eq('team_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
