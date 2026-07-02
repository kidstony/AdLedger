import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { STATUS_CONFIG } from '@/lib/types'
import { encrypt } from '@/lib/crypto'

// Human-readable labels for history log
const FIELD_LABELS: Record<string, string> = {
  category_id:        'Category',
  affiliate_url:      'URL Affiliate',
  affiliate_username: 'Username',
  affiliate_password: 'Password',
  affiliate_network:  'Mạng Affiliate',
  statuses:           'Tình trạng',
  camp_start_date:    'Ngày lên camp',
  person_in_charge:   'Người phụ trách',
  note:               'Note',
  name:               'Tên dự án',
  ref_link:           'Link Ref',
  email_ref:          'Email Ref',
  bank_account_id:    'Bank nhận',
  master_project_id:  'Tổng Dự Án',
}

function serializeValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

function serializeStatuses(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null
  return v.map(s => STATUS_CONFIG[s as keyof typeof STATUS_CONFIG]?.label ?? s).join(', ')
}

async function resolveCategoryName(id: unknown): Promise<string | null> {
  if (!id) return null
  const { data } = await supabaseAdmin.from('project_categories').select('name').eq('id', id).single()
  return data?.name ?? String(id)
}

async function resolvePersonName(userId: unknown): Promise<string | null> {
  if (!userId) return null
  const { data } = await supabaseAdmin.from('user_profiles').select('full_name').eq('user_id', userId).single()
  return data?.full_name ?? String(userId)
}

// Fields member can update (camp-manager fields only)
const MEMBER_ALLOWED_FIELDS = [
  'affiliate_url', 'affiliate_username', 'affiliate_password',
  'affiliate_network', 'statuses', 'camp_start_date', 'person_in_charge', 'note', 'ref_link',
]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: project_id } = await params
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager', 'member'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (caller.role === 'manager') {
    const { data: existingProj } = await supabaseAdmin
      .from('projects').select('team_id').eq('project_id', project_id).single()
    if (existingProj?.team_id !== caller.team_id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (caller.role === 'member') {
    const { data: proj } = await supabaseAdmin
      .from('projects').select('team_id, person_in_charge').eq('project_id', project_id).single()
    const { data: share } = await supabaseAdmin
      .from('project_shares').select('id').eq('project_id', project_id).eq('user_id', caller.user_id).maybeSingle()
    const hasAccess = (proj?.team_id && proj.team_id === caller.team_id) || !!share || proj?.person_in_charge === caller.user_id
    if (!hasAccess)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()

  const allowedFields = caller.role === 'member'
    ? MEMBER_ALLOWED_FIELDS
    : [
        'category_id', 'affiliate_url', 'affiliate_username', 'affiliate_password',
        'affiliate_network', 'statuses', 'camp_start_date', 'person_in_charge', 'note',
        'name', 'cid', 'mcc_id', 'ref_link', 'email_ref', 'bank_account_id',
        'master_project_id', 'screen_revenue_type', 'team_id', 'google_campaign_id',
      ]

  const update: Record<string, unknown> = {}
  for (const key of allowedFields) {
    if (key in body) update[key] = body[key]
  }

  // Encrypt affiliate_password before storing; empty string = keep existing (don't overwrite)
  if ('affiliate_password' in update) {
    if (update.affiliate_password && typeof update.affiliate_password === 'string') {
      update.affiliate_password = encrypt(update.affiliate_password)
    } else if (update.affiliate_password === '') {
      delete update.affiliate_password
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Không có field nào để cập nhật' }, { status: 400 })
  }

  if ('statuses' in update) {
    const VALID_STATUSES = Object.keys(STATUS_CONFIG)
    if (!Array.isArray(update.statuses) || !update.statuses.every(s => VALID_STATUSES.includes(s as string)))
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 })
  }

  // Fetch current values for history diff
  const { data: current } = await supabaseAdmin
    .from('projects')
    .select(Object.keys(update).join(', '))
    .eq('project_id', project_id)
    .single()

  const { data, error } = await supabaseAdmin
    .from('projects')
    .update(update)
    .eq('project_id', project_id)
    .select('*, category:project_categories(id, name, color)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Log history for tracked fields
  if (current) {
    const trackedFields = ['statuses', 'category_id', 'person_in_charge', 'name', 'note', 'camp_start_date', 'affiliate_network']
    const currentRec = current as unknown as Record<string, unknown>

    // Get user's display name (needed regardless)
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(caller.user_id)
    const { data: profile } = await supabaseAdmin
      .from('user_profiles').select('full_name').eq('user_id', caller.user_id).single()
    const userName = profile?.full_name ?? authUser?.user?.email ?? 'Unknown'

    const historyEntries = await Promise.all(
      trackedFields
        .filter(f => f in update)
        .map(async f => {
          let oldVal: string | null
          let newVal: string | null

          if (f === 'statuses') {
            oldVal = serializeStatuses(currentRec[f])
            newVal = serializeStatuses(update[f])
          } else if (f === 'category_id') {
            oldVal = await resolveCategoryName(currentRec[f])
            newVal = await resolveCategoryName(update[f])
          } else if (f === 'person_in_charge') {
            oldVal = await resolvePersonName(currentRec[f])
            newVal = await resolvePersonName(update[f])
          } else {
            oldVal = serializeValue(currentRec[f])
            newVal = serializeValue(update[f])
          }

          if (oldVal === newVal) return null
          return {
            project_id,
            user_id: caller.user_id,
            user_name: userName,
            field: FIELD_LABELS[f] ?? f,
            old_value: oldVal,
            new_value: newVal,
          }
        })
    )

    const toInsert = historyEntries.filter((e): e is NonNullable<typeof e> => e !== null)
    if (toInsert.length > 0) {
      await supabaseAdmin.from('project_history').insert(toInsert)
    }
  }

  return NextResponse.json(data)
}
