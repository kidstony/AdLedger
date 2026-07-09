import { log } from './logger.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Chạy chuỗi "thao tác trước khi đọc" trên page — DÙNG CHUNG cho dò (worker) lẫn sync (capture)
// để nguồn cần tương tác (vd click "Payment history" của Localrent) hiện dữ liệu rồi mới đọc.
// actions: [{ type:'click', text?, selector?, wait_ms? } | { type:'wait', wait_ms?, selector? }]
// Best-effort: mỗi bước lỗi → log.warn rồi tiếp tục (không làm hỏng cả lần chạy).
export async function runActions(page, actions, networkId = '') {
  if (!Array.isArray(actions) || actions.length === 0) return
  for (const act of actions) {
    try {
      const type = act?.type ?? 'click'
      if (type === 'click') {
        const loc = act.selector
          ? page.locator(act.selector).first()
          : page.getByText(String(act.text ?? ''), { exact: false }).first()
        await loc.click({ timeout: act.timeout_ms ?? 10000 })
        log.info(`action click "${act.selector ?? act.text}"`, networkId)
        await sleep(act.wait_ms ?? 2500)
      } else if (type === 'wait') {
        if (act.selector) await page.locator(act.selector).first().waitFor({ timeout: act.timeout_ms ?? 10000 })
        else await sleep(act.wait_ms ?? 1500)
      } else if (type === 'select') {
        await page.locator(act.selector).selectOption(act.value)
        await sleep(act.wait_ms ?? 1500)
      } else if (type === 'fill') {
        await page.locator(act.selector).fill(String(act.value ?? ''))
        await sleep(act.wait_ms ?? 500)
      }
    } catch (err) {
      log.warn(`action ${act?.type ?? 'click'} "${act?.selector ?? act?.text ?? ''}" lỗi: ${String(err.message).split('\n')[0]}`, networkId)
    }
  }
}
