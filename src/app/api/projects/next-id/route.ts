import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabaseAdmin.from('projects').select('project_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nums = (data ?? [])
    .map((p: { project_id: string }) => parseInt(p.project_id.replace('proj', ''), 10))
    .filter((n: number) => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return NextResponse.json({ project_id: `proj${String(max + 1).padStart(3, '0')}` })
}
