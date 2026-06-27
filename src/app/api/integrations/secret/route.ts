import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let secret = ''
  if (caller.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations').select('ads_secret').eq('id', caller.organization_id).single()
    secret = org?.ads_secret ?? ''
  } else {
    secret = process.env.ADS_SCRIPT_SECRET ?? ''
  }

  const preview = secret.length > 4 ? '•'.repeat(secret.length - 4) + secret.slice(-4) : '••••'
  return NextResponse.json({ preview, full: secret })
}
