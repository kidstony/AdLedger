import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!caller.organization_id) {
    return NextResponse.json({ telegram_bot_token: null, telegram_chat_id: null })
  }

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('telegram_bot_token, telegram_chat_id')
    .eq('id', caller.organization_id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? { telegram_bot_token: null, telegram_chat_id: null })
}

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { telegram_bot_token, telegram_chat_id } = await req.json()

  if (!caller.organization_id) {
    return NextResponse.json({ error: 'Global Admin không có tổ chức để lưu config' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ telegram_bot_token: telegram_bot_token || null, telegram_chat_id: telegram_chat_id || null })
    .eq('id', caller.organization_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

// Test: gửi tin nhắn thử
export async function PUT(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || caller.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!caller.organization_id) {
    return NextResponse.json({ error: 'Cần có tổ chức' }, { status: 400 })
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('telegram_bot_token, telegram_chat_id')
    .eq('id', caller.organization_id)
    .single()

  if (!org?.telegram_bot_token || !org?.telegram_chat_id) {
    return NextResponse.json({ error: 'Chưa cấu hình Telegram Bot' }, { status: 400 })
  }

  const res = await sendTelegramMessage(
    org.telegram_bot_token,
    org.telegram_chat_id,
    '✅ Kết nối Telegram Bot thành công!\n\n🤖 P&L Tracker đã sẵn sàng gửi nhắc nhở qua Telegram.'
  )

  if (!res.ok) {
    const err = await res.json()
    return NextResponse.json({ error: err.description ?? 'Telegram API error' }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}

export async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}
