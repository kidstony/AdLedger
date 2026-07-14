// Gửi tin nhắn Telegram qua Bot API — tách từ /api/admin/telegram-config để lib
// khác (optimizer notify, reminders) import được mà không kéo theo route file.
export async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}
