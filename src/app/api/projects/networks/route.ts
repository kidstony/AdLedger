import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { uniqueSlug } from '@/lib/slug'

// Slug engine là duy nhất toàn cục (map 1-1 tới engine/configs/<slug>.json).
async function genUniqueSlug(name: string): Promise<string> {
  const { data } = await supabaseAdmin.from('affiliate_networks').select('slug')
  const taken = (data ?? []).map(r => r.slug).filter(Boolean) as string[]
  return uniqueSlug(name, taken)
}

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let query = supabaseAdmin
    .from('affiliate_networks')
    .select('id, name, color, organization_id, slug')
    .order('name')

  if (caller.organization_id) {
    query = query.eq('organization_id', caller.organization_id)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name, color } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Tên network không được trống' }, { status: 400 })

  const slug = await genUniqueSlug(name.trim())

  const { data, error } = await supabaseAdmin
    .from('affiliate_networks')
    .insert({
      name: name.trim(),
      color: color ?? '#6b7280',
      organization_id: caller.organization_id ?? null,
      created_by: caller.user_id,
      slug,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, name, color } = await req.json()
  if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 })

  const update: Record<string, string> = {}
  if (name !== undefined) update.name = name.trim()
  if (color !== undefined) update.color = color

  // Slug cố định: chỉ backfill nếu bản ghi cũ chưa có slug (không đổi theo tên).
  const { data: existing } = await supabaseAdmin
    .from('affiliate_networks').select('name, slug').eq('id', id).single()
  if (existing && !existing.slug) {
    update.slug = await genUniqueSlug(update.name ?? existing.name)
  }

  const { data, error } = await supabaseAdmin
    .from('affiliate_networks')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Thiếu id' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('affiliate_networks')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
