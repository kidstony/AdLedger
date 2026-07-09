// Đăng nhập lần đầu vào 1 network (việc tay duy nhất của hệ thống):
//   node login.js --network=x
// Mở cửa sổ Chrome với profile riêng của network → bạn đăng nhập tay (captcha/2FA ok)
// → nhấn Enter ở terminal → engine đóng browser để lưu cookie, rồi tự chạy thử
// bước hứng dữ liệu để xác nhận session OK.
import readline from 'node:readline'
import { parseArgs } from './lib/args.js'
import { initLogFile, log } from './lib/logger.js'
import { loadConfigs } from './lib/config.js'
import { loadAccounts } from './lib/accounts.js'
import { loginAccount } from './lib/login-account.js'

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(promptText, () => {
    rl.close()
    resolve()
  }))
}

async function main() {
  const args = parseArgs()
  if (!args.network) {
    console.error('Dùng: node login.js --network=<network_id> [--account=<account_id>]')
    process.exit(1)
  }

  initLogFile()
  const [config] = await loadConfigs(args.network)
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
    const r = await loginAccount(config, account, () => waitForEnter(
      `\n👉 Đăng nhập tài khoản "${account.label}" (${config.network_name}) trong cửa sổ Chrome vừa mở.\n` +
        `   Xong xuôi (đã thấy trang báo cáo) thì quay lại đây nhấn Enter... `
    ))
    if (!r.ok) log.error(`✗ ${account.id}: ${r.message}. Chạy lại: node login.js --network=${config.network_id} --account=${account.id}`, account.id)
  }
  log.info(`Xong. Có thể chạy: node fetch-all.js --network=${config.network_id} --dry-run`, config.network_id)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
