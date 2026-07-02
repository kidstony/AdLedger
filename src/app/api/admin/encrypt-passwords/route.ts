import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { encrypt, isEncrypted } from '@/lib/crypto'

// One-time migration: encrypt all plaintext affiliate_password values in DB
export async function POST(req: NextRequest) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('project_id, affiliate_password')
    .not('affiliate_password', 'is', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const toEncrypt = (projects ?? []).filter(
    p => p.affiliate_password && !isEncrypted(p.affiliate_password)
  )

  let updated = 0
  for (const p of toEncrypt) {
    const encrypted = encrypt(p.affiliate_password!)
    const { error: upErr } = await supabaseAdmin
      .from('projects')
      .update({ affiliate_password: encrypted })
      .eq('project_id', p.project_id)
    if (!upErr) updated++
  }

  return NextResponse.json({ total: toEncrypt.length, updated })
}
