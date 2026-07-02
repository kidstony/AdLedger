import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bankId = new URL(req.url).searchParams.get('bank_id')

  let query = supabaseAdmin.from('bank_accounts').select('*').order('created_at')
  if (bankId) query = query.eq('bank_id', bankId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { bank_id, account_identifier, owner_name, note, coin_type, network, wallet_address } = await req.json()
  if (!bank_id || !owner_name) {
    return NextResponse.json({ error: 'bank_id and owner_name required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .insert({
      bank_id,
      account_identifier: account_identifier ?? null,
      owner_name,
      note: note ?? null,
      coin_type: coin_type ?? null,
      network: network ?? null,
      wallet_address: wallet_address ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, account_identifier, owner_name, note, coin_type, network, wallet_address } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('bank_accounts')
    .update({
      account_identifier: account_identifier ?? null,
      owner_name,
      note: note ?? null,
      coin_type: coin_type ?? null,
      network: network ?? null,
      wallet_address: wallet_address ?? null,
    })
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

  const { count } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true })
    .eq('bank_account_id', id)

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `${count} dự án đang dùng tài khoản này, không thể xóa.` }, { status: 409 })
  }

  const { error } = await supabaseAdmin.from('bank_accounts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
