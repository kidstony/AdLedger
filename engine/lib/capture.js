import { dateWindow, renderUrl } from './dates.js'
import { log } from './logger.js'

function matchesPattern(url, capture) {
  if (capture.pattern_type === 'regex') return new RegExp(capture.url_pattern).test(url)
  return url.includes(capture.url_pattern)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Chạy toàn bộ reports của 1 network trong 1 page:
// - Listener response đăng ký TRƯỚC mọi navigation, gom TẤT CẢ response JSON khớp pattern
// - Sau load: đợi post_load_wait_ms, rồi poll đến khi không có response khớp mới
//   trong capture_settle_ms (SPA hay bắn XHR muộn / pagination tự động)
// Trả { captured: [{report, payload, url}], loginSignal, finalUrl }
export async function captureReports(page, config) {
  const window = dateWindow(config.window_days, config.timezone)
  const captured = []
  const pendingJson = []
  let activeReport = null

  page.on('response', (response) => {
    if (!activeReport) return
    const url = response.url()
    if (!matchesPattern(url, activeReport.capture)) return
    const methods = activeReport.capture.methods
    if (methods && !methods.includes(response.request().method())) return

    const report = activeReport
    pendingJson.push(
      response
        .json()
        .then((payload) => {
          captured.push({ report: report.name, payload, url })
          log.info(`  hứng được response: ${url.slice(0, 120)}`, config.network_id)
        })
        .catch(() => {
          // khớp pattern nhưng không phải JSON (preflight, html...) → bỏ qua
        })
    )
  })

  for (const report of config.reports) {
    activeReport = report
    const url = renderUrl(report.url, window, report.url_date_format)
    log.info(`report "${report.name}": mở ${url.slice(0, 150)}`, config.network_id)

    const waitUntil = report.wait.strategy === 'networkidle' ? 'networkidle' : 'load'
    try {
      await page.goto(url, { waitUntil, timeout: report.wait.navigation_timeout_ms })
    } catch (err) {
      if (waitUntil === 'networkidle') {
        // SPA nhiều XHR nền không bao giờ idle → chấp nhận, dựa vào settle-poll phía dưới
        log.warn(`networkidle timeout, tiếp tục với dữ liệu đã hứng: ${err.message.split('\n')[0]}`, config.network_id)
      } else {
        throw err
      }
    }

    await sleep(report.wait.post_load_wait_ms)

    // Poll đến khi không có response khớp mới trong capture_settle_ms
    let lastCount = -1
    while (lastCount !== captured.length + pendingJson.length) {
      lastCount = captured.length + pendingJson.length
      await sleep(report.wait.capture_settle_ms)
    }
    await Promise.all(pendingJson) // đảm bảo mọi res.json() đã xong
  }
  activeReport = null

  // Ghi nhận dấu hiệu login NGAY khi còn page (đóng context rồi thì không kiểm tra được)
  const loginSignal = await detectLoggedOut(page, config.login_check)
  return { captured, window, loginSignal, finalUrl: page.url() }
}

async function detectLoggedOut(page, loginCheck) {
  const url = page.url()
  for (const pattern of loginCheck.logged_out_url_patterns) {
    if (url.includes(pattern)) return `URL khớp "${pattern}"`
  }
  for (const selector of loginCheck.logged_out_selectors) {
    try {
      if ((await page.locator(selector).count()) > 0) return `selector "${selector}" xuất hiện`
    } catch {
      // selector lỗi cú pháp → bỏ qua
    }
  }
  return null
}
