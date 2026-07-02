import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin
    .from('payment_accounts')
    .select('*')
    .order('bank_type')
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { bank_type, label, manager_name, account_number } = await req.json()
  if (!bank_type || !label || !manager_name || !account_number) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('payment_accounts')
    .insert({ bank_type, label, manager_name, account_number })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, bank_type, label, manager_name, account_number } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('payment_accounts')
    .update({ bank_type, label, manager_name, account_number })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('payment_accounts')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
