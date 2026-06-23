import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('banks')
    .select('*, bank_accounts(count)')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { name, type, bank_category } = await req.json()
  if (!name || !bank_category) return NextResponse.json({ error: 'name and bank_category required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('banks')
    .insert({ name, type: type ?? 'international', bank_category })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PUT(req: NextRequest) {
  const { id, name, type, bank_category } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('banks')
    .update({ name, type, bank_category })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Check if bank has accounts
  const { count } = await supabaseAdmin
    .from('bank_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('bank_id', id)

  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: 'Ngân hàng này đang có tài khoản, không thể xóa.' }, { status: 409 })
  }

  const { error } = await supabaseAdmin.from('banks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
