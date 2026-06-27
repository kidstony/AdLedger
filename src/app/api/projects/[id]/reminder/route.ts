import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('project_reminders')
    .select('*')
    .eq('project_id', project_id)
    .eq('user_id', caller.user_id)
    .order('remind_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { remind_at, repeat_type = 'none', repeat_days, message, notify_inapp = true, notify_telegram = false } = await req.json()

  if (!remind_at) return NextResponse.json({ error: 'Thiếu thời gian nhắc nhở' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('project_reminders')
    .insert({
      project_id,
      user_id: caller.user_id,
      remind_at,
      repeat_type,
      repeat_days: repeat_type === 'custom' ? repeat_days : null,
      message: message ?? null,
      notify_inapp,
      notify_telegram,
      is_triggered: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { reminder_id } = await req.json()

  const { error } = await supabaseAdmin
    .from('project_reminders')
    .delete()
    .eq('id', reminder_id)
    .eq('project_id', project_id)
    .eq('user_id', caller.user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
