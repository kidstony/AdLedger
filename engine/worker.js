// Worker nền: poll bảng engine_commands, thực thi login/fetch do admin đẩy vào.
// Chạy trên máy luôn bật (Windows này). Đăng nhập mở Chrome có giao diện ở máy này.
//   node worker.js
import { getSupabase, upsertNetwork } from './lib/db.js'
import { initLogFile, log } from './lib/logger.js'
import { acquireLock, releaseLock, releaseAllLocks } from './lib/lockfile.js'
import { loadConfigs } from './lib/config.js'
import { loadAccounts } from './lib/accounts.js'
import { runNetwork } from './lib/run-network.js'
import { loginAccount, waitForLoginByCapture } from './lib/login-account.js'
import { clearProfile, openContext, closeAllContexts } from './lib/browser.js'
import { attachJsonCapture } from './lib/discover-capture.js'
import { extractTables } from './lib/html-table.js'
import { runActions } from './lib/actions.js'
import { scanReportPages, normalizeScanUrl } from './lib/scan.js'

const POLL_MS = 5000
// Số profile chạy ĐỒNG THỜI (mỗi profile = 1 Chrome headed, ~0.5GB RAM). Chỉnh qua engine/.env.
const MAX_CONCURRENT = Math.max(1, Number(process.env.ENGINE_CONCURRENCY) || 4)

const nowISO = () => new Date().toISOString()

// Lấy 1 lệnh pending cũ nhất và đánh dấu running (chống double-claim bằng điều kiện still-pending).
async function claimNext(exclude = []) {
  const sb = getSupabase()
  let q = sb
    .from('engine_commands')
    .select('*')
    .eq('status', 'pending')
  // Bỏ qua lệnh của account ĐANG chạy (chung profile → phải nối tiếp): fetch + fetch_breakdown
  // cùng account không chạy song song.
  if (exclude.length) q = q.not('account_id', 'in', `(${exclude.join(',')})`)
  const { data, error } = await q
    .order('created_at')
    .limit(1)
  if (error) { log.warn(`Đọc engine_commands lỗi: ${error.message}`); return null }
  const cmd = data?.[0]
  if (!cmd) return null
  const { data: claimed } = await sb
    .from('engine_commands')
    .update({ status: 'running', started_at: nowISO() })
    .eq('id', cmd.id).eq('status', 'pending')
    .select().single()
  return claimed ?? null // null = bị worker khác giành mất
}

async function finish(id, status, message) {
  await getSupabase().from('engine_commands')
    .update({ status, message: message ? String(message).slice(0, 500) : null, finished_at: nowISO() })
    .eq('id', id)
}

// Ghi tiến độ giữa chừng (auto-scan: "Quét trang 2/5: /reports") — UI poll message hiện live.
// Chỉ ghi khi lệnh còn running (không đè message của lệnh đã bị thay thế).
async function setCommandMessage(id, message) {
  await getSupabase().from('engine_commands')
    .update({ message: String(message).slice(0, 500) })
    .eq('id', id).eq('status', 'running')
}

async function setAccountLogin(accountUuid, status) {
  const patch = { login_status: status }
  if (status === 'ok') patch.last_login_at = nowISO()
  await getSupabase().from('engine_accounts').update(patch).eq('id', accountUuid)
}

// Nạp config + accounts (từ DB) cho 1 network; trả { config, account } cho account chỉ định.
async function loadForAccount(acct) {
  const [config] = await loadConfigs(acct.network_id)
  config.accounts = await loadAccounts(config)
  const account = config.accounts.find((a) => a.id === acct.account_id)
  return { config, account }
}

async function handleLogin(acct, force) {
  const { config, account } = await loadForAccount(acct)
  if (!account) return { ok: false, message: `Account ${acct.account_id} không còn trong network ${acct.network_id}` }
  // force = đăng nhập lại: xoá phiên cũ để trang login luôn hiện (đổi/làm mới tài khoản).
  if (force) {
    try { clearProfile(account.id); log.info('Đã xoá phiên cũ — buộc đăng nhập lại.', account.id) }
    catch (e) { log.warn(`Không xoá được profile: ${e.message}`, account.id) }
  }
  log.info('Đang chờ bạn đăng nhập trong cửa sổ vừa mở… (tự nhận khi trang tải được dữ liệu, tối đa 5 phút).', account.id)
  const r = await loginAccount(config, account, (page) => waitForLoginByCapture(page, config))
  await setAccountLogin(acct.id, r.ok ? 'ok' : 'needs_login')
  return r
}

// kind: 'revenue' (lệnh fetch — P&L) | 'breakdown' (lệnh fetch_breakdown — dữ liệu tối ưu camp).
// 2 pipeline độc lập, chung Chrome profile (đăng nhập 1 lần dùng cho cả hai).
async function handleFetch(acct, kind = 'revenue') {
  const { config } = await loadForAccount(acct)
  try { await upsertNetwork(config.network_id, config.network_name) } catch {}
  const results = await runNetwork(config, false, acct.account_id, kind)
  const failed = results.filter((r) => r.status === 'failed')
  if (failed.length) {
    // Mất phiên là trạng thái CHUNG của profile Chrome — kind nào phát hiện cũng đánh dấu.
    if (failed.some((f) => f.errorType === 'NO_CAPTURE')) await setAccountLogin(acct.id, 'needs_login')
    return { ok: false, message: `Fetch${kind === 'breakdown' ? ' breakdown' : ''} lỗi: ${failed.map((f) => f.errorType).join(', ')}` }
  }
  if (results.length && results.every((r) => r.status === 'skipped')) {
    return { ok: true, message: `Bỏ qua: ${results[0]?.reason ?? 'không có report phù hợp'}` }
  }
  const rows = results.reduce((s, r) => s + (r.rows ?? 0), 0)
  return { ok: true, message: `Fetch OK: ${rows} dòng${kind === 'breakdown' ? ' breakdown' : ''}` }
}

// Dò: KHÔNG cần config (dùng để cấu hình network mới). Mở dashboard bằng profile
// của account (đăng nhập nếu chưa), bắt mọi XHR JSON, lưu vào engine_discoveries.
async function getCommandState(id) {
  const { data } = await getSupabase().from('engine_commands').select('signal, status').eq('id', id).maybeSingle()
  return { signal: data?.signal ?? null, status: data?.status ?? null }
}

// "Báo cáo thật": mảng >=3 dòng, >=3 dòng có token NGÀY và >=3 dòng có token SỐ/tiền.
function isReportRows(rows) {
  if (!Array.isArray(rows) || rows.length < 3) return false
  const dateLike = (s) => /\d{4}-\d{2}-\d{2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}/.test(String(s))
  const numLike = (s) => /\d[.,]\d|\d\s*(?:usd|eur|€|\$|₫)/i.test(String(s))
  let d = 0, n = 0
  for (const r of rows) {
    if (r && typeof r === 'object') {
      const vals = Object.values(r).map(String)
      if (vals.some(dateLike)) d++
      if (vals.some(numLike)) n++
    }
  }
  return d >= 3 && n >= 3
}
// Có mảng báo-cáo-thật trong các payload JSON đã bắt không?
function hasReportInCaptured(captured) {
  for (const c of captured) {
    const stack = [c.payload]
    while (stack.length) {
      const node = stack.pop()
      if (Array.isArray(node)) { if (isReportRows(node)) return true }
      else if (node && typeof node === 'object') { for (const k of Object.keys(node)) stack.push(node[k]) }
    }
  }
  return false
}

async function handleDiscover(acct, cmd) {
  // discover_url (tùy chọn): dò TRANG khác dashboard (vd trang Payout cho nguồn 'confirmed').
  const target = cmd.discover_url || acct.dashboard_url
  if (!target) return { ok: false, message: 'Account chưa có URL dashboard (và không có discover_url)' }
  const context = await openContext(acct.account_id)
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(target, { waitUntil: 'load', timeout: 60000 }).catch(() => {})
    // Auto-scan quét nhiều trang → nới cap + dedupe XHR lặp (boilerplate SPA mỗi trang).
    const { captured, detach } = attachJsonCapture(
      context,
      cmd.discover_scan ? { maxResponses: 120, maxBytes: 6_000_000, dedupe: true } : undefined
    )
    await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {}) // ép bắn lại XHR nếu đã đăng nhập sẵn
    // Thao tác trước khi đọc (vd click "Payment history") — TRƯỚC vòng chờ để bắt kịp dữ liệu vừa hiện.
    await runActions(page, cmd.discover_actions, acct.account_id)
    const initialUrl = page.url() // trang gốc trước đăng nhập — để chuẩn hóa page_url về '{base}'
    log.info(
      cmd.discover_scan
        ? 'Đang dò: chỉ cần ĐĂNG NHẬP — engine sẽ tự quét các trang báo cáo sau khi bấm "Phân tích" hoặc tự thấy dữ liệu (chờ tối đa 5 phút)…'
        : 'Đang dò: ĐĂNG NHẬP + mở TRANG BÁO CÁO. Engine tự phân tích khi thấy dữ liệu, hoặc bấm "Phân tích" (chờ tối đa 5 phút)…',
      acct.account_id
    )

    // Giữ browser mở đến khi: user bấm "Phân tích", HOẶC engine tự thấy "báo cáo thật"
    // (settle 5s rồi finish), HOẶC hết timeout.
    const deadline = Date.now() + 5 * 60 * 1000
    let settleDeadline = 0
    let superseded = false
    let exitReason = 'timeout' // 'analyze' | 'auto' | 'timeout' — scan chỉ chạy khi đã xác nhận đăng nhập
    while (Date.now() < deadline) {
      const st = await getCommandState(cmd.id)
      if (st.signal === 'analyze') { exitReason = 'analyze'; break }
      if (st.status !== 'running') { superseded = true; break } // bị "Dò lại" thay thế → bỏ dở
      if (settleDeadline === 0) {
        let found = hasReportInCaptured(captured)
        if (!found) {
          for (const p of context.pages()) {
            let tabs = []
            try { tabs = await extractTables(p) } catch { /* trang bận */ }
            if (tabs.some((t) => isReportRows(t.rows))) { found = true; break }
          }
        }
        if (found) {
          log.info('Đã thấy dữ liệu báo cáo — tự phân tích sau ~5s (hoặc bấm "Phân tích" để nhanh hơn).', acct.account_id)
          settleDeadline = Date.now() + 5000
        }
      }
      if (settleDeadline && Date.now() >= settleDeadline) { exitReason = 'auto'; break }
      await new Promise((r) => setTimeout(r, 3000))
    }

    // Auto-scan: đăng nhập đã xác nhận (analyze/auto — timeout thì quét trang login vô nghĩa)
    // → tự ghé các link menu "giống trang báo cáo" cùng origin, hứng XHR + bảng của từng trang.
    // rootUrls gồm cả URL landing SAU đăng nhập của mọi tab → không quét lại trang gốc.
    let scanInfo = null
    const rootUrls = new Set([target, initialUrl, ...context.pages().map((p) => p.url())].map(normalizeScanUrl))
    if (cmd.discover_scan && !superseded && exitReason !== 'timeout') {
      scanInfo = await scanReportPages(context, page, captured, {
        rootUrls,
        accountId: acct.account_id,
        onProgress: (m) => setCommandMessage(cmd.id, m),
        shouldAbort: async () => (await getCommandState(cmd.id)).status !== 'running',
      })
    }
    detach()
    if (superseded) return { ok: false, message: 'Lệnh dò bị thay thế bởi lần "Dò lại" mới.' }

    // Chụp bảng HTML (dashboard render server-side như Localrent — không có API JSON).
    // Scan mode đã chụp từng trang trong scanReportPages → không chụp lại.
    if (!scanInfo) {
      for (const p of context.pages()) {
        try {
          for (const t of await extractTables(p)) {
            // visible: bảng đang hiển thị (tab bị ẩn → false) — detect ưu tiên bảng do action click ra.
            captured.push({ url: `${p.url()}#table${t.table_index}`, kind: 'table', table_index: t.table_index, visible: t.visible !== false, page_url: p.url(), payload: { rows: t.rows, headers: t.headers } })
          }
        } catch { /* trang đóng/không đọc được — bỏ qua */ }
      }
    }

    // Chuẩn hóa page_url: entry của TRANG GỐC (dashboard/discover_url) → null để detect giữ
    // semantics '{base}'/sourceUrl như cũ; trang KHÁC (user tự điều hướng hoặc scan ghé) giữ
    // nguyên — đó chính là URL ổn định mà sync cần mở lại (detect đặt vào report.url).
    for (const c of captured) {
      if (c.page_url && rootUrls.has(normalizeScanUrl(c.page_url))) c.page_url = null
    }
    log.info(`Dò xong: ${captured.length} mục (JSON + bảng HTML)${scanInfo ? ` · tự quét ${scanInfo.visited}/${scanInfo.found} trang, ${scanInfo.tabsClicked} tab` : ''}.`, acct.account_id)

    // Bắt được bảng/mảng dữ liệu ⇒ đã đăng nhập trong lúc dò → đánh dấu "đã kết nối"
    // (bớt bước bấm "Kết nối" riêng cho network mới).
    const looksLoggedIn = captured.some(
      (c) => c.kind === 'table' || (c.payload && typeof c.payload === 'object' &&
        Object.values(c.payload).some((v) => Array.isArray(v) && v.length >= 3 && v.every((x) => x && typeof x === 'object')))
    )
    if (looksLoggedIn) await setAccountLogin(acct.id, 'ok')

    const { error } = await getSupabase()
      .from('engine_discoveries')
      // source_url: chỉ lưu khi dò TRANG chỉ định (payout) → detect đặt report.url = url này.
      // actions: thao tác đã click lúc dò → detect tách bản dò 'confirmed' (có click) khỏi 'pending'.
      .insert({ network_id: acct.network_id, account_id: acct.id, captured, source_url: cmd.discover_url ?? null, actions: cmd.discover_actions ?? null })
    if (error) return { ok: false, message: `Lưu discovery lỗi: ${error.message}` }
    return {
      ok: captured.length > 0,
      message: captured.length > 0 ? `Bắt được ${captured.length} response JSON` : 'Không bắt được JSON — dashboard có thể render HTML (cần cách khác)',
    }
  } finally {
    await context.close().catch(() => {})
  }
}

async function getAccountRow(accountUuid) {
  const { data } = await getSupabase()
    .from('engine_accounts')
    .select('id, network_id, account_id, label, dashboard_url, login_url, project_id')
    .eq('id', accountUuid).single()
  return data
}

async function execute(cmd) {
  // Lock THEO ACCOUNT (không phải toàn cục): các profile khác vẫn chạy song song; chỉ CÙNG account
  // (cross-process với fetch-all.js) mới phải chờ. Trong 1 worker, inFlight đã chặn trùng account.
  if (!acquireLock(cmd.account_id)) {
    log.info(`Account ${cmd.account_id} đang bận (lock) — hoãn lệnh, thử lại sau.`)
    await getSupabase().from('engine_commands').update({ status: 'pending', started_at: null }).eq('id', cmd.id)
    return
  }
  try {
    const acct = cmd.account_id ? await getAccountRow(cmd.account_id) : null
    if (!['fetch', 'login', 'discover', 'fetch_breakdown'].includes(cmd.type)) {
      await finish(cmd.id, 'error', `Loại lệnh không hỗ trợ: ${cmd.type}`); return
    }
    if (!acct) { await finish(cmd.id, 'error', 'Không tìm thấy account của lệnh'); return }

    log.info(`▶ Lệnh ${cmd.type}${cmd.force ? ' (force)' : ''} cho account ${acct.account_id} (${acct.network_id})`, acct.account_id)
    const r = cmd.type === 'login' ? await handleLogin(acct, cmd.force)
      : cmd.type === 'discover' ? await handleDiscover(acct, cmd)
      : await handleFetch(acct, cmd.type === 'fetch_breakdown' ? 'breakdown' : 'revenue')
    await finish(cmd.id, r.ok ? 'done' : 'error', r.message)
    // Vừa sync xong doanh thu/breakdown → hẹn ping Optimizer v2 (khi worker rảnh).
    if (r.ok && (cmd.type === 'fetch' || cmd.type === 'fetch_breakdown')) noteSyncedForAnalyze()
    log.info(`${r.ok ? '✓' : '✗'} Lệnh ${cmd.type} ${acct.account_id}: ${r.message}`, acct.account_id)
  } catch (err) {
    await finish(cmd.id, 'error', err.message)
    log.error(`Lệnh ${cmd.id} lỗi: ${err.message}`)
  } finally {
    releaseLock(cmd.account_id)
  }
}

// Auto-sync theo lịch: nếu bật + tới hạn → xếp lệnh fetch cho mọi account đã kết nối.
// Kiểm tra tối đa mỗi AUTO_CHECK_MS để khỏi hỏi DB liên tục.
const AUTO_CHECK_MS = 60_000
let lastAutoCheck = 0
async function maybeAutoSync() {
  if (Date.now() - lastAutoCheck < AUTO_CHECK_MS) return
  lastAutoCheck = Date.now()
  const sb = getSupabase()
  const { data: s } = await sb.from('engine_settings').select('*').eq('id', 1).maybeSingle()
  if (!s || !s.auto_sync_enabled) return
  const last = s.last_auto_sync_at ? Date.parse(s.last_auto_sync_at) : 0
  if (Date.now() - last < (Number(s.interval_hours) || 6) * 3600_000) return

  // Chiếm lượt: cập nhật mốc NGAY để tick sau không xếp trùng.
  await sb.from('engine_settings').update({ last_auto_sync_at: new Date().toISOString() }).eq('id', 1)

  // Network nào đủ điều kiện chạy pipeline TỐI ƯU: đang bật (cột breakdown_enabled) + config
  // có report kind='breakdown'. Query thẳng bảng config (KHÔNG loadConfigs — 1 config hỏng
  // sẽ throw và giết cả tick auto-sync).
  const { data: cfgs } = await sb.from('engine_network_configs')
    .select('network_id, enabled, breakdown_enabled, config')
  const bdEligible = new Set(
    (cfgs ?? [])
      .filter((c) => c.enabled !== false && c.breakdown_enabled !== false &&
        Array.isArray(c.config?.reports) && c.config.reports.some((r) => r?.kind === 'breakdown'))
      .map((c) => c.network_id)
  )

  const { data: accts } = await sb.from('engine_accounts')
    .select('id, network_id, account_id').eq('enabled', true).eq('login_status', 'ok')
  let queued = 0
  for (const a of accts ?? []) {
    // 2 lệnh RIÊNG mỗi chu kỳ: fetch (doanh thu) + fetch_breakdown (tối ưu, nếu eligible).
    const types = ['fetch', ...(bdEligible.has(a.network_id) ? ['fetch_breakdown'] : [])]
    for (const type of types) {
      const { data: dup } = await sb.from('engine_commands').select('id')
        .eq('account_id', a.id).eq('type', type).in('status', ['pending', 'running']).limit(1)
      if (dup && dup.length) continue
      await sb.from('engine_commands').insert({ type, account_id: a.id, network_id: a.network_id })
      queued++
    }
  }
  if (queued) log.info(`Auto-sync: đã xếp ${queued} lệnh (fetch + fetch_breakdown) cho các account đã kết nối.`)
}

// ── Ping Optimizer v2 (app Next.js) ─────────────────────────────────────────
// Sau khi worker sync xong doanh thu → gọi POST /api/optimize/analyze để app
// chạy phân tích (đột biến / đề xuất / phiếu test) trên dữ liệu VỪA thu. Ngoài
// ra ping dự phòng mỗi ANALYZE_FALLBACK_HOURS (mặc định 6h) phòng khi webhook
// Google Ads không chạy. App tự chống chạy trùng bằng claim lock 15 phút — ping
// thừa vô hại. Cần APP_URL + ANALYZE_SECRET trong engine/.env (thiếu = tắt).
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '')
const ANALYZE_SECRET = (process.env.ANALYZE_SECRET || '').trim()
const ANALYZE_MIN_GAP_MS = 10 * 60_000
const ANALYZE_FALLBACK_MS = (Number(process.env.ANALYZE_FALLBACK_HOURS) || 6) * 3600_000
// Mốc = lúc khởi động (không ping ngay khi boot — chưa có dữ liệu gì mới để phân tích);
// ping thật sự bắn sau mỗi chu kỳ sync doanh thu, fallback mỗi ANALYZE_FALLBACK_HOURS.
let lastAnalyzePing = Date.now()
let syncedSinceAnalyze = false
function noteSyncedForAnalyze() { syncedSinceAnalyze = true }
async function maybeNotifyAnalyze(idle) {
  if (!APP_URL || !ANALYZE_SECRET) return
  const now = Date.now()
  const due = (idle && syncedSinceAnalyze && now - lastAnalyzePing > ANALYZE_MIN_GAP_MS)
    || (now - lastAnalyzePing > ANALYZE_FALLBACK_MS)
  if (!due) return
  lastAnalyzePing = now
  syncedSinceAnalyze = false
  try {
    const res = await fetch(`${APP_URL}/api/optimize/analyze`, {
      method: 'POST',
      headers: { 'x-analyze-secret': ANALYZE_SECRET, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (res.status === 404) {
      log.warn('Optimizer: app chưa có route /api/optimize/analyze (bản Optimizer v2 chưa deploy lên Vercel?) — sẽ thử lại ở chu kỳ sau.')
    } else if (res.status === 403 || res.status === 401) {
      log.warn('Optimizer: app từ chối ping (ANALYZE_SECRET hai bên không khớp?) — kiểm tra env trên Vercel và engine/.env.')
    } else {
      log.info(`Optimizer: ping phân tích → HTTP ${res.status}`)
    }
  } catch (e) {
    log.warn(`Optimizer: ping phân tích lỗi: ${e.message}`)
  }
}

async function main() {
  const logFile = initLogFile()
  // CHỈ 1 worker được chạy trên máy này. Thiết kế (inFlight, lastAutoCheck) đều in-memory
  // per-process → nhiều worker = auto-sync xếp lệnh TRÙNG + 2 tiến trình mở CÙNG profile Chrome
  // ("already in use"). Phải khóa TRƯỚC bước dọn lệnh mồ côi bên dưới (nếu không worker thứ 2
  // sẽ đặt 'running' → 'error', giết lệnh đang chạy của worker 1). Khóa tự thu hồi nếu worker
  // cũ đã chết (PID không còn) → crash/kill xong khởi động lại không bị kẹt.
  if (!acquireLock('__worker__')) {
    log.error('Đã có worker khác đang chạy trên máy này — thoát để tránh trùng lệnh và lỗi "profile already in use". Đóng worker kia trước rồi chạy lại.')
    process.exit(1)
  }
  log.info(`Worker khởi động. Poll engine_commands mỗi ${POLL_MS / 1000}s. Log: ${logFile}`)
  // Dọn lệnh mồ côi: worker mới = không có lệnh nào đang thực sự chạy → 'running' cũ là rác.
  try {
    const { data } = await getSupabase().from('engine_commands')
      .update({ status: 'error', message: 'Worker khởi động lại', finished_at: nowISO() })
      .eq('status', 'running').select('id')
    if (data?.length) log.info(`Dọn ${data.length} lệnh mồ côi (running → error).`)
  } catch (e) { log.warn(`Không dọn được lệnh mồ côi: ${e.message}`) }
  let stopping = false
  let sigints = 0
  process.on('SIGINT', () => {
    sigints++
    // Ctrl+C lần 2: đóng các cửa sổ Chrome đang mở (không để mồ côi khóa profile) RỒI thoát.
    if (sigints >= 2) {
      log.warn('Buộc thoát — đóng các cửa sổ Chrome đang mở…')
      closeAllContexts().catch(() => {}).finally(() => { releaseAllLocks(); process.exit(130) })
      return
    }
    stopping = true
    log.info('Đang dừng — chờ các lệnh đang chạy xong… (Ctrl+C lần nữa để đóng Chrome + thoát ngay).')
  })
  const inFlight = new Map() // account_id → Promise (lệnh đang chạy)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // Heartbeat ~30s → engine_settings.worker_last_seen_at để UI biết worker đang chạy.
  let lastBeat = 0
  const HEARTBEAT_MS = 30_000
  const beat = async () => {
    if (Date.now() - lastBeat < HEARTBEAT_MS) return
    lastBeat = Date.now()
    try {
      await getSupabase().from('engine_settings')
        .update({ worker_last_seen_at: nowISO() }).eq('id', 1)
    } catch (e) { log.warn(`Heartbeat lỗi: ${e.message}`) }
  }

  while (!stopping) {
    try {
      await beat()
      await maybeAutoSync().catch((e) => log.warn(`auto-sync lỗi: ${e.message}`))
      await maybeNotifyAnalyze(inFlight.size === 0).catch((e) => log.warn(`analyze ping lỗi: ${e.message}`))
      // Nạp đầy tối đa MAX_CONCURRENT lệnh song song. Mỗi account chỉ 1 lệnh cùng lúc (chung profile)
      // → loại account đang chạy khỏi lượt claim.
      while (inFlight.size < MAX_CONCURRENT) {
        const cmd = await claimNext([...inFlight.keys()])
        if (!cmd) break
        const acctId = cmd.account_id
        const p = execute(cmd)
          .catch((e) => log.error(`Lệnh ${cmd.id} lỗi: ${e.message}`))
          .finally(() => inFlight.delete(acctId))
        inFlight.set(acctId, p)
      }
      // Rỗng → poll; đang chạy → thức khi 1 lệnh xong HOẶC hết poll (để nạp lệnh mới sớm).
      if (inFlight.size === 0) await sleep(POLL_MS)
      else await Promise.race([...inFlight.values(), sleep(POLL_MS)])
    } catch (err) {
      log.error(`Vòng lặp worker lỗi: ${err.message}`)
      await sleep(POLL_MS)
    }
  }
  // Dừng êm: chờ mọi lệnh đang chạy hoàn tất rồi mới thoát (không cắt ngang khi đang ghi DB).
  if (inFlight.size) log.info(`Chờ ${inFlight.size} lệnh đang chạy hoàn tất…`)
  await Promise.all(inFlight.values()).catch(() => {})
  await closeAllContexts()   // đóng nốt cửa sổ Chrome nếu còn (không để mồ côi)
  releaseAllLocks()
  log.info('Worker đã dừng.')
}

main().catch((err) => {
  console.error(err.message)
  closeAllContexts().catch(() => {}).finally(() => { releaseAllLocks(); process.exit(1) })
})
