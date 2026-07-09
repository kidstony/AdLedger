// Revenue Fetch Engine — chạy tuần tự từng network, hứng JSON báo cáo, đổ về Supabase.
// Cách dùng:
//   node fetch-all.js                     # mọi network enabled trong configs/
//   node fetch-all.js --network=x         # chỉ 1 network (kể cả config _test)
//   node fetch-all.js --network=x --dry-run   # không chạm DB, in kết quả map
import { parseArgs } from './lib/args.js'
import { initLogFile, log } from './lib/logger.js'
import { acquireLock, releaseLock } from './lib/lockfile.js'
import { loadConfigs } from './lib/config.js'
import { upsertNetwork } from './lib/db.js'
import { loadAccounts } from './lib/accounts.js'
import { runNetwork } from './lib/run-network.js'

async function main() {
  const args = parseArgs()
  if (args._unknown.length > 0) {
    console.error(`Cờ không hỗ trợ: ${args._unknown.join(', ')}. Dùng: node fetch-all.js [--network=x] [--account=y] [--dry-run]`)
    process.exit(1)
  }

  const logFile = initLogFile()
  const configs = await loadConfigs(args.network) // fail fast nếu config lỗi

  if (!acquireLock()) {
    console.error('Engine đang chạy ở tiến trình khác (engine/.lock tồn tại). Thoát.')
    process.exit(1)
  }
  const cleanup = () => releaseLock()
  process.on('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.on('uncaughtException', (err) => {
    log.error(`Lỗi không bắt được: ${err.stack}`)
    cleanup()
    process.exit(1)
  })

  log.info(`Bắt đầu: ${configs.length} network${args.dryRun ? ' [DRY RUN]' : ''}. Log: ${logFile}`)

  const summary = []
  try {
    for (const config of configs) {
      log.info(`========== ${config.network_name} (${config.network_id}) ==========`)
      try {
        // Đăng ký network (fail-soft: bảng chưa tạo cũng không chặn lượt chạy).
        if (!args.dryRun) {
          try { await upsertNetwork(config.network_id, config.network_name) }
          catch (e) { log.warn(`Không đăng ký được network: ${e.message}`, config.network_id) }
        }
        // Nguồn account: DB (quản lý qua UI); fallback file config.
        config.accounts = await loadAccounts(config)
        const results = await runNetwork(config, args.dryRun, args.account)
        for (const r of results) {
          summary.push({ network: config.network_id, ...r })
        }
      } catch (err) {
        // Lỗi ngoài dự kiến (VD: insertRun fail) — không được chặn network sau
        log.error(`Lỗi ngoài dự kiến: ${err.message}`, config.network_id)
        summary.push({ network: config.network_id, status: 'failed', errorType: 'DB_ERROR' })
      }
    }
  } finally {
    cleanup()
  }

  log.info('========== TỔNG KẾT ==========')
  for (const s of summary) {
    const who = s.account && s.account !== s.network ? `${s.network}/${s.account}` : s.network
    log.info(`  ${who}: ${s.status}${s.rows != null ? ` (${s.rows} dòng)` : ''}${s.errorType ? ` [${s.errorType}]` : ''}`)
  }
  const failed = summary.filter((s) => s.status === 'failed').length
  process.exit(failed > 0 ? 2 : 0)
}

main().catch((err) => {
  console.error(err.message)
  releaseLock()
  process.exit(1)
})
