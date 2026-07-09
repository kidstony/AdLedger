// Đăng nhập 1 account (1 profile) + smoke-test session — tách từ login.js để
// login.js (CLI, chờ Enter) và worker.js (poll tự động) dùng chung.
import { log } from './logger.js'
import { openContext } from './browser.js'
import { captureReports, matchesPattern } from './capture.js'
import { extractRows } from './extract.js'

function resolveLoginUrl(config, account) {
  const base = (account.login_url ?? account.dashboard_url ?? '').replace(/\/+$/, '')
  const raw = config.login_url ?? config.reports[0].url
  if (raw.includes('{base}') && !base) return null
  return raw.replaceAll('{base}', base).replace(/\{start_date\}|\{end_date\}/g, '')
}

// waitForLogin(page): async — resolve khi đã đăng nhập xong (CLI: chờ Enter; worker: poll).
// Trả { ok, message }.
export async function loginAccount(config, account, waitForLogin) {
  const loginUrl = resolveLoginUrl(config, account)
  if (loginUrl === null) {
    return { ok: false, message: `Account "${account.id}" thiếu dashboard_url — nhập URL dashboard trong admin.` }
  }

  log.info(`Mở cửa sổ đăng nhập ${config.network_name} — ${account.label} (${account.id})...`, account.id)
  let context = await openContext(account.id)
  let page = context.pages()[0] ?? (await context.newPage())
  await page.goto(loginUrl, { waitUntil: 'load', timeout: 60000 }).catch(() => {})

  await waitForLogin(page)

  await context.close() // flush cookie vào profile
  log.info('Đã lưu phiên đăng nhập. Chạy thử bước hứng dữ liệu...', account.id)

  // Smoke test: mở lại bằng cookie vừa lưu, thử hứng response
  context = await openContext(account.id)
  page = context.pages()[0] ?? (await context.newPage())
  try {
    const { captured, loginSignal } = await captureReports(page, config, account.dashboard_url)
    if (captured.length > 0) {
      log.info(`✓ Session OK — hứng được ${captured.length} response.`, account.id)
      return { ok: true, message: `Session OK (${captured.length} response)` }
    }
    if (loginSignal) return { ok: false, message: `Chưa đăng nhập được (${loginSignal})` }
    return { ok: false, message: `Session có vẻ OK nhưng không hứng được response khớp "${config.reports[0].capture.url_pattern}" — kiểm tra capture.url_pattern.` }
  } catch (err) {
    return { ok: false, message: err.message }
  } finally {
    await context.close().catch(() => {})
  }
}

// waitForLogin cho worker: dò KHẲNG ĐỊNH — chờ đến khi trang tải được DỮ LIỆU THẬT
// (hứng XHR khớp capture.url_pattern mà extractRows trả mảng khác rỗng). Payload
// {"error":"Unauthorized"} → extractRows = [] → chưa tính là đăng nhập. Tránh đóng
// sớm/dương-tính-giả của cách dò phủ định. Trả true nếu bắt được dữ liệu, false nếu timeout.
export function waitForLoginByCapture(page, config, { timeoutMs = 300000 } = {}) {
  const report = config.reports[0]
  return new Promise((resolve) => {
    let done = false
    const finish = (val) => {
      if (done) return
      done = true
      page.off('response', onResp)
      clearTimeout(timer)
      resolve(val)
    }
    const onResp = async (response) => {
      if (done) return
      if (!matchesPattern(response.url(), report.capture)) return
      try {
        const payload = await response.json()
        if (extractRows(payload, report.rows_path).length > 0) finish(true)
      } catch { /* không phải JSON hoặc lỗi parse — bỏ qua, chờ tiếp */ }
    }
    page.on('response', onResp)
    const timer = setTimeout(() => finish(false), timeoutMs)
    // Reload 1 lần để chắc chắn listener bắt được XHR (trường hợp đã đăng nhập sẵn:
    // XHR có thể đã bắn lúc goto trước khi gắn listener). Không cản trở việc user
    // đăng nhập tay sau đó (khi login xong, SPA bắn XHR dữ liệu mới → bắt được).
    page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {})
  })
}
