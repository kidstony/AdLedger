import { dateWindow, renderUrl } from './dates.js'
import { log } from './logger.js'
import { extractTableAllPages } from './html-table.js'

export function matchesPattern(url, capture) {
  if (capture.pattern_type === 'regex') return new RegExp(capture.url_pattern).test(url)
  return url.includes(capture.url_pattern)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Ghi đè 1 field trong body multipart/form-data (giữ nguyên các field khác, kể cả sessid).
// Body dạng:  --boundary\r\nContent-Disposition: form-data; name="from"\r\n\r\n<value>\r\n--boundary
// Field đang rỗng vẫn có sẵn khối → chỉ thay phần <value>.
function setMultipartField(body, name, value) {
  const re = new RegExp(`(name="${name}"\\r?\\n\\r?\\n)([\\s\\S]*?)(\\r?\\n--)`)
  if (!re.test(body)) return body // field không tồn tại → để nguyên (không tự thêm)
  return body.replace(re, `$1${value}$3`)
}

// Đăng ký route ghi đè field ngày trong request (vd proxy-seller POST from/to rỗng → điền
// cửa sổ để backfill). Trả hàm unroute để gỡ sau report. window = {from,to} dayjs.
async function applyRequestOverride(page, report, window) {
  const ov = report.request_override
  if (!ov || !ov.form_fields) return async () => {}
  const fmt = ov.date_format ?? 'YYYY-MM-DD'
  const rendered = {}
  for (const [field, tpl] of Object.entries(ov.form_fields)) {
    rendered[field] = String(tpl)
      .replaceAll('{start_date}', window.from.format(fmt))
      .replaceAll('{end_date}', window.to.format(fmt))
  }
  const matcher = (url) => (ov.url_pattern ? url.includes(ov.url_pattern) : true)
  const handler = async (route) => {
    const req = route.request()
    if ((ov.method && req.method() !== ov.method) || !matcher(req.url())) return route.continue()
    let body = req.postData()
    if (!body) return route.continue()
    for (const [field, value] of Object.entries(rendered)) body = setMultipartField(body, field, value)
    log.info(`request_override: ${req.method()} ${req.url().slice(0, 80)} → ${JSON.stringify(rendered)}`, report.name)
    await route.continue({ postData: body })
  }
  await page.route(matcher, handler)
  return async () => { await page.unroute(matcher, handler).catch(() => {}) }
}

// Chạy toàn bộ reports của 1 network trong 1 page:
// - Listener response đăng ký TRƯỚC mọi navigation, gom TẤT CẢ response JSON khớp pattern
// - Sau load: đợi post_load_wait_ms, rồi poll đến khi không có response khớp mới
//   trong capture_settle_ms (SPA hay bắn XHR muộn / pagination tự động)
// base = dashboard_url của account (thay {base} trong report.url). Trả
// { captured: [{report, payload, url}], loginSignal, finalUrl }
export async function captureReports(page, config, base = '', { windowDays } = {}) {
  // Config kiểu-template ({base}) bắt buộc account có dashboard_url.
  if (!base && config.reports.some((r) => (r.url ?? '').includes('{base}'))) {
    throw new Error(
      `Network "${config.network_id}" dùng {base} nhưng account thiếu dashboard_url — nhập "URL dashboard" trong admin.`
    )
  }
  // windowDays: caller truyền để backfill lần đầu (rộng) vs incremental; vắng → window_days.
  const window = dateWindow(windowDays ?? config.window_days, config.timezone)
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
    // Ghi đè field ngày trong request (nếu khai) TRƯỚC khi điều hướng để bắt kịp XHR đầu.
    const unroute = await applyRequestOverride(page, report, window)
    const url = renderUrl(report.url, window, report.url_date_format, base)
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

    // Chế độ đọc bảng HTML (dashboard render server-side): đọc thẳng DOM table,
    // không chờ XHR. payload = { rows } → dùng rows_path="rows".
    if (report.mode === 'html_table') {
      const { rows, pages } = await extractTableAllPages(page, report.table_index ?? 0, { maxPages: report.max_pages ?? 100 })
      captured.push({ report: report.name, payload: { rows }, url })
      log.info(`report "${report.name}" (html_table #${report.table_index ?? 0}): đọc ${rows.length} dòng qua ${pages} trang`, config.network_id)
      await unroute()
      continue
    }

    // Poll đến khi không có response khớp mới trong capture_settle_ms
    let lastCount = -1
    while (lastCount !== captured.length + pendingJson.length) {
      lastCount = captured.length + pendingJson.length
      await sleep(report.wait.capture_settle_ms)
    }
    await Promise.all(pendingJson) // đảm bảo mọi res.json() đã xong
    await unroute()
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
