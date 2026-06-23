import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const bankId = new URL(req.url).searchParams.get('bank_id')

  let query = supabaseAdmin.from('bank_accounts').select('*').order('created_at')
  if (bankId) query = query.eq('bank_id', bankId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { bank_id, account_identifier, owner_name, note } = await req.json()
  if (!bank_id || !account_identifier || !owner_name) {
    return NextResponse.json({ error: 'bank_id, account_identifier, and owner_name required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({ bank_id, account_identifier, owner_name, note: note ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const { id, account_identifier, owner_name, note } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .update({ account_identifier, owner_name, note: note ?? null })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('bank_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
