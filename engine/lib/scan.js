// Auto-scan lúc dò (discover): sau khi user đăng nhập xong, tự quét các link menu
// cùng origin có tên "giống trang báo cáo" (Conversions/Reports/Statistics/Earnings...)
// để tìm trang chứa dữ liệu doanh thu/breakdown — user không cần biết trang nào có số.
//
// AN TOÀN: chỉ điều hướng GET qua <a href> cùng origin — KHÔNG BAO GIỜ click nút/form,
// không mở tab mới. Link phải đạt điểm từ khóa ≥ 2 mới được ghé (không ghé link lạ);
// link tiêu cực (logout/settings/billing/delete...) bị loại tuyệt đối.
import { log } from './logger.js'
import { extractTables } from './html-table.js'

const STRONG_RE = /conversion|report|statist|earning|commission|payout|transaction/i // +3
const MEDIUM_RE = /analytic|performance|revenue|income|payment|sale\b|sales\b|referr/i // +2
const WEAK_RE = /\bstats?\b|sub[-_ ]?id|\bgeo\b|countr|history|summary|detail/i // +1
// Tiêu cực THẮNG mọi điểm cộng ("Billing reports" vẫn bị loại) — logout/hủy/cấu hình/tải file.
const NEG_RE = /log[-_ ]?out|sign[-_ ]?out|password|billing|invoice|setting|preference|profile|help|support|\bdocs?\b|faq|delete|remove|invite|upgrade|pricing|\bplans?\b|subscription|terms|privacy|policy|contact|api[-_ ]?key|webhook|postback|creative|banner|material|news|blog|notification|export|download/i
const FILE_EXT_RE = /\.(pdf|csv|xlsx?|zip|docx?)(\?|#|$)/i // goto sẽ thành download → loại

// Nhãn tab con phân khúc phổ biến trên dashboard affiliate (click để lộ dữ liệu country/device).
// Optimize chỉ dùng geo + device (+ giờ từ created_at) → không gồm Traffic source/Links/Promo.
const SEGMENT_TAB_LABELS = [
  'Location', 'Locations', 'Country', 'Countries', 'Geo', 'Geography',
  'Region', 'Regions', 'City', 'Cities', 'Device', 'Devices', 'Platform', 'OS',
]
const MAX_TABS = 4

// Chuẩn hóa URL để dedupe/so với root: bỏ '/' cuối; bỏ hash TRỪ hash route SPA (#/, #!).
export function normalizeScanUrl(raw) {
  try {
    const u = new URL(raw)
    const hash = u.hash.startsWith('#/') || u.hash.startsWith('#!') ? u.hash : ''
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}${hash}`
  } catch {
    return String(raw).replace(/\/+$/, '')
  }
}

function scoreLink(text, url) {
  const hay = `${text} ${url.pathname}${url.search}${url.hash}`
  if (NEG_RE.test(hay)) return -1
  let s = 0
  if (STRONG_RE.test(hay)) s += 3
  if (MEDIUM_RE.test(hay)) s += 2
  if (WEAK_RE.test(hay)) s += 1
  return s
}

// Gom + chấm điểm link ứng viên từ 1 trang. Trả [{ url, path, score }].
async function collectLinks(page) {
  let anchors = []
  try {
    anchors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).slice(0, 500).map((a) => ({
        href: a.href,
        text: (a.innerText || a.textContent || '').trim().slice(0, 120),
      }))
    )
  } catch { return [] }

  const pageOrigin = (() => { try { return new URL(page.url()).origin } catch { return null } })()
  const out = []
  for (const a of anchors) {
    let u
    try { u = new URL(a.href) } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue // bỏ mailto:/tel:/javascript:
    if (pageOrigin && u.origin !== pageOrigin) continue // chỉ cùng origin
    if (FILE_EXT_RE.test(u.pathname + u.search)) continue
    const score = scoreLink(a.text, u)
    if (score < 2) continue // 1 WEAK đơn lẻ không đủ — không ghé link không rõ ràng
    out.push({ url: u.href, norm: normalizeScanUrl(u.href), path: u.pathname + u.hash, pathname: u.pathname, score })
  }
  return out
}

// Click các tab phân khúc (Location/Device...) trên 1 trang để lộ dataset country/device.
// Không đoán selector DOM (React app tab có thể là div/span/custom) — click TRỰC TIẾP theo
// nhãn cố định qua getByText (Playwright tự tìm element bất kể tag). Dataset mỗi tab: XHR
// listener context-level tự bắt HOẶC bảng đổi (snapshotTables chụp). Gắn via_tab để detect
// biết action nào tái hiện lúc sync. Best-effort: nhãn không có/không click được → bỏ qua.
async function clickSegmentTabs(page, captured, { settleMs = 4000, deadline = Infinity, accountId = '', onProgress = null } = {}) {
  let clicked = 0
  for (const label of SEGMENT_TAB_LABELS) {
    if (clicked >= MAX_TABS) break
    if (Date.now() > deadline - 8000) break
    let loc
    try {
      loc = page.getByText(new RegExp('^' + label + '$', 'i')).first() // ^...$ i: khớp Location/LOCATION, không khớp "Location settings"
      if ((await loc.count()) === 0) continue
      if (!(await loc.isVisible())) continue
    } catch { continue }
    const baseline = captured.length
    try { await loc.click({ timeout: 5000 }) } catch { continue }
    try { await onProgress?.(`Mở tab "${label}"…`) } catch { /* chỉ hiển thị */ }
    log.info(`auto-scan: click tab "${label}"`, accountId)
    await page.waitForTimeout(settleMs) // để XHR của tab bắn xong (context listener tự hứng)
    await snapshotTables(page, captured)
    for (let i = baseline; i < captured.length; i++) {
      if (!captured[i].via_tab) captured[i].via_tab = label
    }
    clicked++
  }
  if (clicked) log.info(`auto-scan: click được ${clicked} tab phân khúc`, accountId)
  return clicked
}

// Chụp bảng HTML của 1 trang, push vào captured kèm page_url.
async function snapshotTables(page, captured) {
  try {
    for (const t of await extractTables(page)) {
      captured.push({
        url: `${page.url()}#table${t.table_index}`,
        kind: 'table',
        table_index: t.table_index,
        visible: t.visible !== false,
        page_url: page.url(),
        payload: { rows: t.rows, headers: t.headers },
      })
    }
  } catch { /* trang đóng/bận — bỏ qua */ }
}

// Quét các trang báo cáo ứng viên. captured = mảng của attachJsonCapture (listener context-level
// vẫn đang gắn → XHR của từng trang tự được hứng kèm page_url); bảng HTML chụp tay per-page.
// rootUrls: Set URL đã chuẩn hóa của các trang gốc — không quét lại.
export async function scanReportPages(context, page, captured, {
  rootUrls = new Set(),
  accountId = '',
  onProgress = null,   // async (msg) => {} — worker ghi engine_commands.message cho UI
  shouldAbort = null,  // async () => boolean — dừng khi lệnh bị "Dò lại" thay thế
  maxPages = 6,
  budgetMs = 120_000,
  pageTimeoutMs = 20_000,
  settleMs = 4_000,
} = {}) {
  const deadline = Date.now() + budgetMs
  let tabsClicked = 0

  // A. Chụp bảng + click tab phân khúc của mọi trang đang mở (trang report có thể đã mở sẵn).
  for (const p of context.pages()) {
    await snapshotTables(p, captured)
    tabsClicked += await clickSegmentTabs(p, captured, { settleMs, deadline, accountId, onProgress })
  }

  // B. Gom link ứng viên từ mọi trang đang mở, dedupe + loại root, xếp hạng.
  const byNorm = new Map()
  for (const p of context.pages()) {
    for (const cand of await collectLinks(p)) {
      if (rootUrls.has(cand.norm)) continue
      const existing = byNorm.get(cand.norm)
      if (!existing || cand.score > existing.score) byNorm.set(cand.norm, cand)
    }
  }
  const cands = [...byNorm.values()]
    .sort((a, b) => b.score - a.score || a.pathname.length - b.pathname.length) // điểm cao trước; tie: menu cấp cao (path ngắn)
    .slice(0, maxPages)

  log.info(`auto-scan: ${cands.length} trang ứng viên${cands.length ? ` — ${cands.map((c) => c.path).join(', ')}` : ''}`, accountId)
  let visited = 0
  let loginWalled = 0

  // C. Ghé tuần tự trong CÙNG page (profile giữ đăng nhập; GET navigation, không click link).
  for (const [i, cand] of cands.entries()) {
    if (Date.now() > deadline - 8000) { log.warn('auto-scan: hết ngân sách thời gian — dừng.', accountId); break }
    if (shouldAbort && (await shouldAbort())) { log.warn('auto-scan: lệnh bị thay thế — dừng.', accountId); break }
    try { await onProgress?.(`Quét trang ${i + 1}/${cands.length}: ${cand.path}`) } catch { /* message chỉ để hiển thị */ }
    log.info(`auto-scan (${i + 1}/${cands.length}): ${cand.path}`, accountId)
    try {
      // 'domcontentloaded' (không phải 'load'): SPA hash-route điều hướng same-document
      // không bao giờ fire 'load'. settleMs phía sau chờ XHR bắn xong.
      await page.goto(cand.url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs })
    } catch {
      continue // timeout/net error/download bị chặn → trang sau
    }
    await page.waitForTimeout(settleMs)
    // Trang đòi đăng nhập lại (token trong memory/route bảo vệ) → bỏ qua, không tính visited.
    const walled =
      /\/(log-?in|sign-?in|auth)\b/i.test(page.url()) ||
      (await page.locator("input[type='password']").count().catch(() => 0)) > 0
    if (walled) { loginWalled++; continue }
    await snapshotTables(page, captured)
    tabsClicked += await clickSegmentTabs(page, captured, { settleMs, deadline, accountId, onProgress })
    visited++
  }

  return { found: cands.length, visited, loginWalled, tabsClicked }
}
