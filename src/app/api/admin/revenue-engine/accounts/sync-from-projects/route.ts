import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Reconcile: với mỗi project đã gán affiliate_network (có slug engine) mà CHƯA có
// engine_account nào → tự tạo 1 account (account_id auto theo slug). Idempotent,
// không xoá/sửa account có sẵn. Engine ghi doanh thu theo engine_accounts.project_id.
const ALLOWED = ['super_admin', 'manager']
const SLUG = /^[a-z0-9_-]+$/i

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 1. affiliate_networks có slug → map tên (lower) → slug
  let netQuery = supabaseAdmin.from('affiliate_networks').select('name, slug')
  if (caller.organization_id) netQuery = netQuery.eq('organization_id', caller.organization_id)
  const { data: networks, error: netErr } = await netQuery
  if (netErr) return NextResponse.json({ error: netErr.message }, { status: 500 })
  const slugByName = new Map<string, string>()
  for (const n of networks ?? []) {
    if (n.slug && SLUG.test(n.slug)) slugByName.set(n.name.trim().toLowerCase(), n.slug)
  }

  // 2. projects đã gán affiliate_network
  const { data: projects, error: projErr } = await supabaseAdmin
    .from('projects')
    .select('project_id, name, affiliate_network')
    .not('affiliate_network', 'is', null)
  if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 })

  // 3. engine_accounts hiện có
  const { data: existing, error: accErr } = await supabaseAdmin
    .from('engine_accounts')
    .select('network_id, account_id, project_id')
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })

  const projectsWithAccount = new Set((existing ?? []).map(a => a.project_id).filter(Boolean))
  // taken account_id theo từng network (gồm cả cái vừa tạo trong batch)
  const takenByNet = new Map<string, Set<string>>()
  for (const a of existing ?? []) {
    if (!takenByNet.has(a.network_id)) takenByNet.set(a.network_id, new Set())
    takenByNet.get(a.network_id)!.add(a.account_id)
  }
  const nextAccountId = (networkId: string): string => {
    const taken = takenByNet.get(networkId) ?? new Set<string>()
    takenByNet.set(networkId, taken)
    let candidate = networkId
    let n = 2
    while (taken.has(candidate)) candidate = `${networkId}_${n++}`
    taken.add(candidate)
    return candidate
  }

  const toInsert: {
    network_id: string; account_id: string; label: string; project_id: string; created_by: string
  }[] = []
  for (const p of projects ?? []) {
    if (projectsWithAccount.has(p.project_id)) continue
    const slug = slugByName.get((p.affiliate_network ?? '').trim().toLowerCase())
    if (!slug) continue
    toInsert.push({
      network_id: slug,
      account_id: nextAccountId(slug),
      label: p.name,
      project_id: p.project_id,
      created_by: caller.user_id,
    })
  }

  if (toInsert.length === 0) return NextResponse.json({ created: 0, accounts: [] })

  const { data, error } = await supabaseAdmin
    .from('engine_accounts')
    .insert(toInsert)
    .select('id, network_id, account_id, label, project_id, enabled, created_at')
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ created: data?.length ?? 0, accounts: data ?? [] })
}
