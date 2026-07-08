// Đăng nhập lần đầu vào 1 network (việc tay duy nhất của hệ thống):
//   node login.js --network=x
// Mở cửa sổ Chrome với profile riêng của network → bạn đăng nhập tay (captcha/2FA ok)
// → nhấn Enter ở terminal → engine đóng browser để lưu cookie, rồi tự chạy thử
// bước hứng dữ liệu để xác nhận session OK.
import readline from 'node:readline'
import { parseArgs } from './lib/args.js'
import { initLogFile, log } from './lib/logger.js'
import { loadConfigs } from './lib/config.js'
import { openContext } from './lib/browser.js'
import { captureReports } from './lib/capture.js'
import { loadAccounts } from './lib/accounts.js'

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(promptText, () => {
    rl.close()
    resolve()
  }))
}

// Đăng nhập 1 tài khoản (1 profile) rồi smoke-test session.
async function loginAccount(config, account) {
  const loginUrl = config.login_url ?? config.reports[0].url.replace(/\{start_date\}|\{end_date\}/g, '')

  log.info(`Mở cửa sổ đăng nhập cho ${config.network_name} — tài khoản ${account.label} (${account.id})...`, account.id)
  let context = await openContext(account.id)
  let page = context.pages()[0] ?? (await context.newPage())
  await page.goto(loginUrl, { waitUntil: 'load', timeout: 60000 }).catch(() => {})

  await waitForEnter(
    `\n👉 Đăng nhập tài khoản "${account.label}" (${config.network_name}) trong cửa sổ Chrome vừa mở.\n` +
      `   Xong xuôi (đã thấy trang báo cáo) thì quay lại đây nhấn Enter... `
  )

  await context.close() // flush cookie vào profile
  log.info('Đã lưu phiên đăng nhập. Chạy thử bước hứng dữ liệu...', account.id)

  // Smoke test: mở lại bằng cookie vừa lưu, thử hứng response
  context = await openContext(account.id)
  page = context.pages()[0] ?? (await context.newPage())
  try {
    const { captured, loginSignal } = await captureReports(page, config)
    if (captured.length > 0) {
      log.info(`✓ Session OK — hứng được ${captured.length} response.`, account.id)
    } else if (loginSignal) {
      log.error(`✗ Vẫn chưa đăng nhập được (${loginSignal}). Chạy lại: node login.js --network=${config.network_id} --account=${account.id}`, account.id)
    } else {
      log.warn(
        `Session có vẻ OK nhưng không hứng được response nào khớp "${config.reports[0].capture.url_pattern}". ` +
          `Kiểm tra lại capture.url_pattern trong config (xem DevTools → Network).`,
        account.id
      )
    }
  } finally {
    await context.close().catch(() => {})
  }
}

async function main() {
  const args = parseArgs()
  if (!args.network) {
    console.error('Dùng: node login.js --network=<network_id> [--account=<account_id>]')
    process.exit(1)
  }

  initLogFile()
  const [config] = loadConfigs(args.network)
  // Nguồn account: DB (quản lý qua UI); fallback file config.
  config.accounts = await loadAccounts(config)

  // --account → chỉ đăng nhập 1 tài khoản; không có → lặp qua mọi account của network.
  const accounts = args.account
    ? config.accounts.filter((a) => a.id === args.account)
    : config.accounts
  if (accounts.length === 0) {
    console.error(`Không có account "${args.account}" trong network ${config.network_id}. Có: ${config.accounts.map((a) => a.id).join(', ')}`)
    process.exit(1)
  }

  for (const account of accounts) {
    await loginAccount(config, account)
  }
  log.info(`Xong. Có thể chạy: node fetch-all.js --network=${config.network_id} --dry-run`, config.network_id)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
