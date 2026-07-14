import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { DEFAULT_THRESHOLDS, mergeThresholds } from '@/lib/optimizer/defaults'

// GET /api/optimize/settings — ngưỡng hiệu lực (mặc định + override) + metadata
// để UI tự render form. PUT — lưu override (chỉ ghi phần KHÁC mặc định).
// super_admin/manager của org.
export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!caller.organization_id)
    return NextResponse.json({ definitions: DEFAULT_THRESHOLDS, overrides: {}, effective: mergeThresholds(null), auto_tune: false })

  const url = new URL(req.url)
  const project_id = url.searchParams.get('project_id')   // null = ngưỡng chung org

  let q = supabaseAdmin.from('optimizer_settings')
    .select('thresholds, auto_tune')
    .eq('organization_id', caller.organization_id)
  q = project_id ? q.eq('project_id', project_id) : q.is('project_id', null)
  const { data } = await q.maybeSingle()

  const overrides = (data?.thresholds ?? {}) as Record<string, number>
  return NextResponse.json({
    definitions: DEFAULT_THRESHOLDS,
    overrides,
    effective: mergeThresholds(overrides),
    auto_tune: data?.auto_tune ?? false,
  })
}

export async function PUT(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!caller.organization_id)
    return NextResponse.json({ error: 'Cần có tổ chức' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const project_id = (body?.project_id as string | undefined) ?? null
  const incoming = (body?.thresholds ?? {}) as Record<string, unknown>

  // Chỉ giữ key hợp lệ + giá trị KHÁC mặc định (xóa key = quay về mặc định).
  const overrides: Record<string, number> = {}
  for (const def of DEFAULT_THRESHOLDS) {
    const v = incoming[def.key]
    if (typeof v === 'number' && Number.isFinite(v) && v !== def.value) {
      overrides[def.key] = Math.min(def.max, Math.max(def.min, v))
    }
  }

  const { error } = await supabaseAdmin.from('optimizer_settings').upsert({
    organization_id: caller.organization_id,
    project_id,
    thresholds: overrides,
    ...(body?.auto_tune != null ? { auto_tune: !!body.auto_tune } : {}),
    updated_by: caller.user_id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,project_id' })
  if (error) {
    // Unique index dùng COALESCE(project_id,'') — onConflict cột trần có thể không khớp
    // khi project_id null: fallback update-then-insert.
    let q = supabaseAdmin.from('optimizer_settings')
      .update({ thresholds: overrides, ...(body?.auto_tune != null ? { auto_tune: !!body.auto_tune } : {}), updated_by: caller.user_id, updated_at: new Date().toISOString() })
      .eq('organization_id', caller.organization_id)
    q = project_id ? q.eq('project_id', project_id) : q.is('project_id', null)
    const { data: upd } = await q.select('id')
    if (!upd?.length) {
      const { error: insErr } = await supabaseAdmin.from('optimizer_settings').insert({
        organization_id: caller.organization_id, project_id,
        thresholds: overrides, auto_tune: !!body?.auto_tune, updated_by: caller.user_id,
      })
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, overrides, effective: mergeThresholds(overrides) })
}
