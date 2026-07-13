// Đăng nhập 1 account (1 profile) + smoke-test session — tách từ login.js để
// login.js (CLI, chờ Enter) và worker.js (poll tự động) dùng chung.
import { log } from './logger.js'
import { openContext } from './browser.js'
import { captureReports, matchesPattern } from './capture.js'
import { extractRows } from './extract.js'
import { extractTables } from './html-table.js'

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
    // Smoke test GỌN: chỉ cần reports[0] (report doanh thu chính) để xác nhận phiên đã lưu +
    // có dữ liệu — không chạy hết mọi report (nhanh hơn nhiều, vd tolt có 4 report).
    const scoped = { ...config, reports: [config.reports[0]] }
    const { captured, loginSignal } = await captureReports(page, scoped, account.dashboard_url)
    // Tín hiệu ĐĂNG XUẤT (redirect trang login / thấy form login) → chắc chắn CHƯA đăng nhập.
    if (loginSignal) return { ok: false, message: `Chưa đăng nhập được (${loginSignal})` }
    // "Đăng nhập OK" phải có DỮ LIỆU THẬT: response khớp pattern MÀ extractRows>0. Response rỗng
    // hoặc {"error":"Unauthorized"} vẫn khớp URL (captured>0) nhưng KHÔNG phải đã đăng nhập →
    // loại bỏ dương-tính-giả (đồng bộ tiêu chí với waitForLoginByCapture). Chạy cho cả xhr lẫn
    // html_table (payload html_table = { rows }, rows_path='rows').
    const withData = captured.filter((c) => {
      try { return extractRows(c.payload, config.reports[c.report_index]?.rows_path ?? '').length > 0 }
      catch { return false }
    })
    if (withData.length > 0) {
      log.info(`✓ Session OK — hứng được ${withData.length}/${captured.length} response có dữ liệu.`, account.id)
      return { ok: true, message: `Session OK (${withData.length} response có dữ liệu)` }
    }
    // Có response khớp pattern nhưng KHÔNG dòng dữ liệu nào → không khẳng định đăng nhập (chưa
    // đăng nhập, hoặc mọi báo cáo đang trống). An toàn: coi như cần đăng nhập lại.
    return {
      ok: false,
      message: captured.length > 0
        ? `Chưa xác nhận đăng nhập: hứng ${captured.length} response nhưng KHÔNG có dữ liệu (chưa đăng nhập, hoặc báo cáo trống). Đăng nhập lại trong cửa sổ vừa mở.`
        : `Không hứng được response khớp "${config.reports[0].capture.url_pattern}" — kiểm tra capture.url_pattern hoặc đăng nhập lại.`,
    }
  } catch (err) {
    return { ok: false, message: err.message }
  } finally {
    await context.close().catch(() => {})
  }
}

// waitForLogin cho worker: dò KHẲNG ĐỊNH — chờ đến khi trang tải được DỮ LIỆU THẬT, cho CẢ 2
// chế độ report (không đoán mò → không dương-tính-giả, resolve NGAY khi có dữ liệu):
//  • xhr: hứng XHR khớp capture.url_pattern mà extractRows > 0 ({"error":"Unauthorized"} → [] → chưa tính).
//  • html_table: KHÔNG có XHR để nghe → poll DOM, thấy BẢNG có ≥1 dòng = đã đăng nhập (trang login
//    không có bảng dữ liệu) → resolve trong vài giây thay vì chờ hết timeout.
// Trả true nếu bắt được dữ liệu, false nếu hết timeout (chưa đăng nhập).
export function waitForLoginByCapture(page, config, { timeoutMs = 300000 } = {}) {
  const report = config.reports[0]
  const isHtmlTable = report.mode === 'html_table'
  return new Promise((resolve) => {
    let done = false
    let poll = null
    const finish = (val) => {
      if (done) return
      done = true
      page.off('response', onResp)
      if (poll) clearInterval(poll)
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
    // Report đọc BẢNG HTML: poll DOM ~2.5s/lần — bảng có dữ liệu = đã đăng nhập.
    if (isHtmlTable) {
      poll = setInterval(async () => {
        if (done) return
        try {
          const tabs = await extractTables(page)
          if (tabs.some((t) => Array.isArray(t.rows) && t.rows.length > 0)) finish(true)
        } catch { /* trang đang tải/điều hướng — thử lại nhịp sau */ }
      }, 2500)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    // Reload 1 lần để chắc chắn bắt được dữ liệu ngay khi đã đăng nhập sẵn (XHR có thể đã bắn
    // trước khi gắn listener; bảng có thể đã render). Không cản trở user đăng nhập tay sau đó.
    page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {})
  })
}
