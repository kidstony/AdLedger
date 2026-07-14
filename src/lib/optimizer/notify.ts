import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendTelegramMessage } from '@/lib/telegram'

// ─────────────────────────────────────────────────────────────────────────────
// Thông báo Telegram của Optimizer v2 — tái dùng bot đã cấu hình trong
// organizations.telegram_bot_token/telegram_chat_id (trang Cài đặt).
// • Tin NGAY: đột biến nghiêm trọng, chạm stop-loss, phiếu test kết luận,
//   nghi mất kết nối network. Mỗi sự kiện chỉ gửi 1 lần (đánh dấu ở caller).
// • Digest: tối đa 1 lần/ngày, khi run đầu tiên trong ngày có dữ liệu mới.
// ─────────────────────────────────────────────────────────────────────────────

interface TelegramCfg { botToken: string; chatId: string }

export async function getTelegramCfg(organizationId: string): Promise<TelegramCfg | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('telegram_bot_token, telegram_chat_id')
    .eq('id', organizationId)
    .maybeSingle()
  if (!data?.telegram_bot_token || !data?.telegram_chat_id) return null
  return { botToken: data.telegram_bot_token, chatId: data.telegram_chat_id }
}

// Gửi 1 tin — nuốt lỗi (thông báo hỏng không được làm hỏng run phân tích).
export async function sendSafe(cfg: TelegramCfg | null, text: string): Promise<boolean> {
  if (!cfg) return false
  try {
    const res = await sendTelegramMessage(cfg.botToken, cfg.chatId, text)
    return res.ok
  } catch {
    return false
  }
}

export interface DigestSummary {
  newSuggestions: { title: string; severity: string; project: string }[]
  anomalies: number
  runningTickets: { code: string; state: string; note: string }[]
  concludedYesterday: { code: string; verdict: string }[]
}

export function buildDigestText(d: DigestSummary): string | null {
  const parts: string[] = []
  if (d.newSuggestions.length) {
    const top = d.newSuggestions.slice(0, 3).map(s => `  • [${s.project}] ${s.title}`).join('\n')
    parts.push(`💡 <b>${d.newSuggestions.length} đề xuất mới</b>\n${top}`)
  }
  if (d.anomalies > 0) parts.push(`⚡ ${d.anomalies} chỉ số bất thường đang mở`)
  if (d.runningTickets.length) {
    const t = d.runningTickets.slice(0, 3).map(t => `  • ${t.code}: ${t.note}`).join('\n')
    parts.push(`🧪 <b>${d.runningTickets.length} phiếu test đang chạy</b>\n${t}`)
  }
  if (d.concludedYesterday.length) {
    const t = d.concludedYesterday.map(t => `  • ${t.code}: ${t.verdict === 'won' ? 'THẮNG ✅' : t.verdict === 'lost' ? 'thua ❌' : t.verdict}`).join('\n')
    parts.push(`🏁 Phiếu test vừa kết luận\n${t}`)
  }
  if (!parts.length) return null
  return `📊 <b>AdLedger — tối ưu camp hôm nay</b>\n\n${parts.join('\n\n')}\n\nMở trang Tối Ưu Camp → tab "Hành động &amp; Test" để xử lý.`
}
