import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

async function sendTelegram(botToken: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
  } catch { /* silent fail — Telegram is best-effort */ }
}

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = caller.user_id

  // 1. Fetch reminders đến hạn
  const { data: dueReminders } = await supabaseAdmin
    .from('project_reminders')
    .select('id, project_id, message, repeat_type, repeat_days, remind_at, notify_inapp, notify_telegram')
    .eq('user_id', uid)
    .eq('is_triggered', false)
    .lte('remind_at', new Date().toISOString())

  if (dueReminders && dueReminders.length > 0) {
    // Lấy tên project + statuses + person_in_charge
    const projectIds = [...new Set(dueReminders.map(r => r.project_id).filter(Boolean))]
    const { data: projectRows } = await supabaseAdmin
      .from('projects')
      .select('project_id, name, statuses, person_in_charge')
      .in('project_id', projectIds)
    const projectMap = new Map((projectRows ?? []).map(p => [p.project_id, p]))

    // Lấy tên người phụ trách
    const personIds = [...new Set((projectRows ?? []).map((p: { person_in_charge: string | null }) => p.person_in_charge).filter(Boolean))] as string[]
    const personMap = new Map<string, string>()
    if (personIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, full_name')
        .in('user_id', personIds)
      ;(profiles ?? []).forEach((p: { user_id: string; full_name: string }) => personMap.set(p.user_id, p.full_name))
    }

    // Lấy Telegram config của org (nếu có)
    let telegramToken: string | null = null
    let telegramChatId: string | null = null
    if (caller.organization_id) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('telegram_bot_token, telegram_chat_id')
        .eq('id', caller.organization_id)
        .single()
      telegramToken = org?.telegram_bot_token ?? null
      telegramChatId = org?.telegram_chat_id ?? null
    }

    // Tạo notifications + gửi Telegram
    const inappReminders = dueReminders.filter(r => r.notify_inapp)
    if (inappReminders.length > 0) {
      await supabaseAdmin.from('notifications').insert(
        inappReminders.map(r => ({
          user_id: uid,
          type: 'reminder',
          title: `🔔 Nhắc nhở: ${projectMap.get(r.project_id)?.name ?? r.project_id}`,
          body: r.message ?? null,
          project_id: r.project_id,
        }))
      )
    }

    // Gửi Telegram cho reminders có notify_telegram = true
    if (telegramToken && telegramChatId) {
      const telegramReminders = dueReminders.filter(r => r.notify_telegram)
      for (const r of telegramReminders) {
        const proj = projectMap.get(r.project_id) as { name: string; statuses: string[]; person_in_charge: string | null } | undefined
        const statusLabels: Record<string, string> = {
          waiting_camp: 'Chờ Lên Camp', testing: 'Đang Test', tested_loss: 'Đã Test (Lỗ)',
          waiting_payment: 'Chờ Thanh Toán', scaling: 'Đang Scale',
          paused_camp: 'Dừng Camp', on_hold: 'Tạm Dừng', abandoned: 'Bỏ',
        }
        const statusLine = (proj?.statuses ?? []).map(s => statusLabels[s] ?? s).join(', ')
        const personName = proj?.person_in_charge ? personMap.get(proj.person_in_charge) : null
        const text = [
          `🔔 <b>Nhắc nhở từ P&L Tracker</b>`,
          ``,
          `📁 Dự án: <b>${proj?.name ?? r.project_id}</b>`,
          r.message ? `📝 Nội dung: ${r.message}` : null,
          statusLine ? `📊 Tình trạng: ${statusLine}` : null,
          personName ? `👤 Người phụ trách: ${personName}` : null,
        ].filter(Boolean).join('\n')
        await sendTelegram(telegramToken, telegramChatId, text)
      }
    }

    // Mark triggered
    await supabaseAdmin
      .from('project_reminders')
      .update({ is_triggered: true })
      .in('id', dueReminders.map(r => r.id))

    // Tạo next reminder cho loại lặp lại
    const repeatReminders = dueReminders.filter(r => r.repeat_type !== 'none')
    if (repeatReminders.length > 0) {
      const { data: fullReminders } = await supabaseAdmin
        .from('project_reminders')
        .select('*')
        .in('id', repeatReminders.map(r => r.id))

      if (fullReminders) {
        await supabaseAdmin.from('project_reminders').insert(
          fullReminders.map(r => {
            const next = new Date(r.remind_at)
            if (r.repeat_type === 'daily') next.setDate(next.getDate() + 1)
            else if (r.repeat_type === 'weekly') next.setDate(next.getDate() + 7)
            else if (r.repeat_type === 'custom' && r.repeat_days) next.setDate(next.getDate() + r.repeat_days)
            return {
              project_id: r.project_id,
              user_id: uid,
              remind_at: next.toISOString(),
              repeat_type: r.repeat_type,
              repeat_days: r.repeat_days,
              message: r.message,
              notify_inapp: r.notify_inapp,
              notify_telegram: r.notify_telegram,
              is_triggered: false,
            }
          })
        )
      }
    }
  }

  // 2. Trả notifications (50 mới nhất)
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .select('id, type, title, body, project_id, is_read, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PATCH(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, all } = await req.json()

  if (all) {
    await supabaseAdmin.from('notifications').update({ is_read: true })
      .eq('user_id', caller.user_id).eq('is_read', false)
  } else if (id) {
    await supabaseAdmin.from('notifications').update({ is_read: true })
      .eq('id', id).eq('user_id', caller.user_id)
  }

  return NextResponse.json({ success: true })
}
