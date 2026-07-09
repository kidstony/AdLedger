// Worker nền: poll bảng engine_commands, thực thi login/fetch do admin đẩy vào.
// Chạy trên máy luôn bật (Windows này). Đăng nhập mở Chrome có giao diện ở máy này.
//   node worker.js
import { getSupabase, upsertNetwork } from './lib/db.js'
import { initLogFile, log } from './lib/logger.js'
import { acquireLock, releaseLock } from './lib/lockfile.js'
import { loadConfigs } from './lib/config.js'
import { loadAccounts } from './lib/accounts.js'
import { runNetwork } from './lib/run-network.js'
import { loginAccount, waitForLoginByCapture } from './lib/login-account.js'
import { clearProfile, openContext } from './lib/browser.js'
import { attachJsonCapture } from './lib/discover-capture.js'
import { extractTables } from './lib/html-table.js'

const POLL_MS = 5000

const nowISO = () => new Date().toISOString()

// Lấy 1 lệnh pending cũ nhất và đánh dấu running (chống double-claim bằng điều kiện still-pending).
async function claimNext() {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('engine_commands')
    .select('*')
    .eq('status', 'pending')
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

async function handleFetch(acct) {
  const { config } = await loadForAccount(acct)
  try { await upsertNetwork(config.network_id, config.network_name) } catch {}
  const results = await runNetwork(config, false, acct.account_id)
  const failed = results.filter((r) => r.status === 'failed')
  if (failed.length) {
    if (failed.some((f) => f.errorType === 'NO_CAPTURE')) await setAccountLogin(acct.id, 'needs_login')
    return { ok: false, message: `Fetch lỗi: ${failed.map((f) => f.errorType).join(', ')}` }
  }
  const rows = results.reduce((s, r) => s + (r.rows ?? 0), 0)
  return { ok: true, message: `Fetch OK: ${rows} dòng` }
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
  if (!acct.dashboard_url) return { ok: false, message: 'Account chưa có URL dashboard' }
  const context = await openContext(acct.account_id)
  try {
    const page = context.pages()[0] ?? (await context.newPage())
    await page.goto(acct.dashboard_url, { waitUntil: 'load', timeout: 60000 }).catch(() => {})
    const { captured, detach } = attachJsonCapture(context)
    page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => {}) // ép bắn lại XHR nếu đã đăng nhập sẵn
    log.info('Đang dò: ĐĂNG NHẬP + mở TRANG BÁO CÁO. Engine tự phân tích khi thấy dữ liệu, hoặc bấm "Phân tích" (chờ tối đa 5 phút)…', acct.account_id)

    // Giữ browser mở đến khi: user bấm "Phân tích", HOẶC engine tự thấy "báo cáo thật"
    // (settle 5s rồi finish), HOẶC hết timeout.
    const deadline = Date.now() + 5 * 60 * 1000
    let settleDeadline = 0
    let superseded = false
    while (Date.now() < deadline) {
      const st = await getCommandState(cmd.id)
      if (st.signal === 'analyze') break
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
      if (settleDeadline && Date.now() >= settleDeadline) break
      await new Promise((r) => setTimeout(r, 3000))
    }
    detach()
    if (superseded) return { ok: false, message: 'Lệnh dò bị thay thế bởi lần "Dò lại" mới.' }

    // Chụp bảng HTML (dashboard render server-side như Localrent — không có API JSON).
    for (const p of context.pages()) {
      try {
        for (const t of await extractTables(p)) {
          captured.push({ url: `${p.url()}#table${t.table_index}`, kind: 'table', table_index: t.table_index, payload: { rows: t.rows } })
        }
      } catch { /* trang đóng/không đọc được — bỏ qua */ }
    }
    log.info(`Dò xong: ${captured.length} mục (JSON + bảng HTML).`, acct.account_id)

    // Bắt được bảng/mảng dữ liệu ⇒ đã đăng nhập trong lúc dò → đánh dấu "đã kết nối"
    // (bớt bước bấm "Kết nối" riêng cho network mới).
    const looksLoggedIn = captured.some(
      (c) => c.kind === 'table' || (c.payload && typeof c.payload === 'object' &&
        Object.values(c.payload).some((v) => Array.isArray(v) && v.length >= 3 && v.every((x) => x && typeof x === 'object')))
    )
    if (looksLoggedIn) await setAccountLogin(acct.id, 'ok')

    const { error } = await getSupabase()
      .from('engine_discoveries')
      .insert({ network_id: acct.network_id, account_id: acct.id, captured })
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
  // Lock theo từng lệnh: nhường lịch fetch-all.js (Task Scheduler) chạy xen kẽ.
  if (!acquireLock()) {
    log.info('Engine đang bận (lock) — hoãn lệnh, thử lại sau.')
    await getSupabase().from('engine_commands').update({ status: 'pending', started_at: null }).eq('id', cmd.id)
    return
  }
  try {
    const acct = cmd.account_id ? await getAccountRow(cmd.account_id) : null
    if (!['fetch', 'login', 'discover'].includes(cmd.type)) {
      await finish(cmd.id, 'error', `Loại lệnh không hỗ trợ: ${cmd.type}`); return
    }
    if (!acct) { await finish(cmd.id, 'error', 'Không tìm thấy account của lệnh'); return }

    log.info(`▶ Lệnh ${cmd.type}${cmd.force ? ' (force)' : ''} cho account ${acct.account_id} (${acct.network_id})`, acct.account_id)
    const r = cmd.type === 'login' ? await handleLogin(acct, cmd.force)
      : cmd.type === 'discover' ? await handleDiscover(acct, cmd)
      : await handleFetch(acct)
    await finish(cmd.id, r.ok ? 'done' : 'error', r.message)
    log.info(`${r.ok ? '✓' : '✗'} Lệnh ${cmd.type} ${acct.account_id}: ${r.message}`, acct.account_id)
  } catch (err) {
    await finish(cmd.id, 'error', err.message)
    log.error(`Lệnh ${cmd.id} lỗi: ${err.message}`)
  } finally {
    releaseLock()
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

  const { data: accts } = await sb.from('engine_accounts')
    .select('id, network_id, account_id').eq('enabled', true).eq('login_status', 'ok')
  let queued = 0
  for (const a of accts ?? []) {
    const { data: dup } = await sb.from('engine_commands').select('id')
      .eq('account_id', a.id).eq('type', 'fetch').in('status', ['pending', 'running']).limit(1)
    if (dup && dup.length) continue
    await sb.from('engine_commands').insert({ type: 'fetch', account_id: a.id, network_id: a.network_id })
    queued++
  }
  if (queued) log.info(`Auto-sync: đã xếp ${queued} lệnh fetch cho các account đã kết nối.`)
}

async function main() {
  const logFile = initLogFile()
  log.info(`Worker khởi động. Poll engine_commands mỗi ${POLL_MS / 1000}s. Log: ${logFile}`)
  // Dọn lệnh mồ côi: worker mới = không có lệnh nào đang thực sự chạy → 'running' cũ là rác.
  try {
    const { data } = await getSupabase().from('engine_commands')
      .update({ status: 'error', message: 'Worker khởi động lại', finished_at: nowISO() })
      .eq('status', 'running').select('id')
    if (data?.length) log.info(`Dọn ${data.length} lệnh mồ côi (running → error).`)
  } catch (e) { log.warn(`Không dọn được lệnh mồ côi: ${e.message}`) }
  let stopping = false
  process.on('SIGINT', () => { stopping = true; releaseLock(); process.exit(130) })

  while (!stopping) {
    try {
      await maybeAutoSync().catch((e) => log.warn(`auto-sync lỗi: ${e.message}`))
      const cmd = await claimNext()
      if (cmd) await execute(cmd)
      else await new Promise((r) => setTimeout(r, POLL_MS))
    } catch (err) {
      log.error(`Vòng lặp worker lỗi: ${err.message}`)
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }
}

main().catch((err) => {
  console.error(err.message)
  releaseLock()
  process.exit(1)
})
