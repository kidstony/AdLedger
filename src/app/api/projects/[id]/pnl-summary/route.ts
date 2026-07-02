import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { computeCidCost } from '@/lib/costs'
import { RentalGroup } from '@/lib/types'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (caller.role === 'member') {
    const { data: share } = await supabaseAdmin
      .from('project_shares').select('id')
      .eq('project_id', project_id).eq('user_id', caller.user_id).maybeSingle()
    if (!share) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  } else if (caller.role === 'manager') {
    const { data: proj } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (proj?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from') ?? '2000-01-01'
  const to   = url.searchParams.get('to')   ?? new Date().toISOString().split('T')[0]

  const { data: project } = await supabaseAdmin
    .from('projects')
    .select('project_id, cid, google_campaign_id')
    .eq('project_id', project_id)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const [revenueRes, adSpendRes, otherRes, rentalRes] = await Promise.all([
    supabaseAdmin
      .from('affiliate_revenue')
      .select('type, amount')
      .eq('project_id', project_id)
      .gte('date', from)
      .lte('date', to),

    project.google_campaign_id
      ? supabaseAdmin
          .from('ad_spend')
          .select('spend')
          .eq('campaign_id', project.google_campaign_id)
          .gte('date', from)
          .lte('date', to)
      : Promise.resolve({ data: [] as { spend: number }[] }),

    supabaseAdmin
      .from('other_costs')
      .select('amount')
      .eq('project_id', project_id),

    supabaseAdmin
      .from('rental_groups')
      .select('*, rental_group_cids!inner(cid, project_id)')
      .or(`rental_group_cids.cid.eq.${project.cid},rental_group_cids.project_id.eq.${project_id}`),
  ])

  const revenues = revenueRes.data ?? []
  const adSpends = (adSpendRes as { data: { spend: number }[] | null }).data ?? []
  const others   = otherRes.data ?? []

  const total_revenue = revenues.filter(r => r.type === 'confirmed').reduce((s, r) => s + (r.amount ?? 0), 0)
  const total_pending = revenues.filter(r => r.type === 'pending').reduce((s, r) => s + (r.amount ?? 0), 0)
  const total_spend   = adSpends.reduce((s, r) => s + (r.spend ?? 0), 0)
  const total_other   = others.reduce((s, r) => s + (r.amount ?? 0), 0)

  // Compute rental cost for this project's CID
  const adSpendByCid = new Map([[project.cid, total_spend]])
  const rentalGroups = (rentalRes.data ?? []) as unknown as RentalGroup[]
  const total_rental = rentalGroups.reduce(
    (sum, rg) => sum + computeCidCost(project.cid, rg, from, to, adSpendByCid),
    0
  )

  const total_cost   = total_spend + total_rental + total_other
  const total_profit = total_revenue - total_cost

  return NextResponse.json({
    total_revenue,
    total_pending,
    total_spend,
    total_rental,
    total_other,
    total_profit,
  })
}
