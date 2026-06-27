import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function DELETE(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !['super_admin', 'manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { user_id } = await req.json()

  if (user_id === caller.user_id) {
    return NextResponse.json({ error: 'Không thể xóa tài khoản đang đăng nhập' }, { status: 400 })
  }

  if (caller.role === 'manager') {
    const { data: target } = await supabaseAdmin
      .from('user_profiles')
      .select('role, team_id')
      .eq('user_id', user_id)
      .single()

    if (!target) return NextResponse.json({ error: 'User không tồn tại' }, { status: 404 })
    if (target.team_id !== caller.team_id) {
      return NextResponse.json({ error: 'Không có quyền xóa user ngoài team' }, { status: 403 })
    }
    if (target.role !== 'member') {
      return NextResponse.json({ error: 'Chỉ có thể xóa tài khoản Member' }, { status: 403 })
    }
  }

  await supabaseAdmin.from('project_members').delete().eq('user_id', user_id)
  await supabaseAdmin.from('project_assignments').delete().eq('user_id', user_id)
  await supabaseAdmin.from('project_shares').delete().eq('user_id', user_id)
  await supabaseAdmin.from('user_profiles').delete().eq('user_id', user_id)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}
