// Logic chạy fetch 1 network / 1 account — tách từ fetch-all.js để worker.js dùng lại.
import { log } from './logger.js'
import { openContext } from './browser.js'
import { captureReports } from './capture.js'
import { extractRows } from './extract.js'
import { mapRows, dedupeRows, toPnlRows } from './mapper.js'
import { insertRun, updateRun, upsertRevenueRaw, upsertAffiliateRevenue } from './db.js'
import { openAlert, closeAlerts } from './alerts.js'
import { dateWindow } from './dates.js'
import { getRateToUsd } from './fx.js'

// Tỷ giá về USD: có fx_auto_from → lấy động (throw nếu fail); ngược lại dùng fx_to_usd tĩnh
async function resolveFxRate(config) {
  if (config.fx_auto_from) return getRateToUsd(config.fx_auto_from)
  return config.fx_to_usd
}

async function fail(networkId, runId, dryRun, errorType, message, counts = {}) {
  log.error(`${errorType}: ${message}`, networkId)
  if (dryRun) return
  try {
    await updateRun(runId, { status: 'failed', error_type: errorType, error_message: message, ...counts })
    await openAlert(networkId, errorType, message, runId)
  } catch (err) {
    log.error(`Không ghi được trạng thái fail vào DB: ${err.message}`, networkId)
  }
}

// Chạy hết các tài khoản của 1 network (mỗi tài khoản 1 profile + 1 project_id riêng).
// accountFilter (tùy chọn) = chỉ chạy đúng 1 account.id.
export async function runNetwork(config, dryRun, accountFilter = null) {
  const accounts = accountFilter
    ? config.accounts.filter((a) => a.id === accountFilter)
    : config.accounts
  if (accounts.length === 0) {
    log.warn(`Không có account "${accountFilter}" trong network ${config.network_id}`, config.network_id)
    return []
  }
  const results = []
  for (const account of accounts) {
    if (config.accounts.length > 1 || accountFilter) {
      log.info(`--- tài khoản: ${account.label} (${account.id}) → dự án ${account.project_id} ---`, account.id)
    }
    const r = await runAccount(config, account, dryRun)
    results.push({ account: account.id, ...r })
  }
  return results
}

export async function runAccount(config, account, dryRun) {
  const networkId = config.network_id
  const tag = account.id // nhãn log + khóa alert theo tài khoản
  let runId = null
  let context = null
  let result = null

  if (!dryRun) {
    // Không tạo được run row = không có DB → dừng tài khoản này ngay (throw lên main)
    const w = dateWindow(config.window_days, config.timezone)
    runId = await insertRun(networkId, account.id, w.fromISO, w.toISO)
  }

  // ---- 1. Mở browser + hứng response ----
  try {
    context = await openContext(account.id)
    const page = context.pages()[0] ?? (await context.newPage())
    result = await captureReports(page, config, account.dashboard_url)
  } catch (err) {
    await fail(tag, runId, dryRun, 'NO_CAPTURE', `Lỗi browser/navigation: ${err.message.split('\n')[0]}`)
    return { status: 'failed', errorType: 'NO_CAPTURE' }
  } finally {
    if (context) await context.close().catch(() => {})
  }

  const { captured, loginSignal, finalUrl } = result
  log.info(`hứng được ${captured.length} response JSON khớp pattern`, tag)

  if (captured.length === 0) {
    const reason = loginSignal
      ? `Mất phiên đăng nhập (${loginSignal}) — chạy: node login.js --network=${networkId} --account=${account.id}`
      : `Không hứng được response nào khớp pattern (URL cuối: ${finalUrl}). Network có thể đã đổi endpoint — kiểm tra lại capture.url_pattern trong config.`
    await fail(tag, runId, dryRun, 'NO_CAPTURE', reason)
    return { status: 'failed', errorType: 'NO_CAPTURE' }
  }

  // ---- 2. Extract + map + dedupe ----
  const reportByName = new Map(config.reports.map((r) => [r.name, r]))
  let allMapped = []
  let totalInvalid = 0
  const allErrorSamples = []

  for (const { report: reportName, payload } of captured) {
    const report = reportByName.get(reportName)
    const rawRows = extractRows(payload, report.rows_path)
    const { mapped, invalid, errorSamples } = mapRows(rawRows, report.mapping)
    allMapped.push(...mapped)
    totalInvalid += invalid
    allErrorSamples.push(...errorSamples)
  }

  const total = allMapped.length + totalInvalid
  const invalidRatio = total === 0 ? 1 : totalInvalid / total
  const validation = config.reports[0].validation
  const counts = { records_captured: captured.length, records_mapped: allMapped.length }

  if (allMapped.length < validation.min_mapped_rows || invalidRatio > validation.max_invalid_row_ratio) {
    const message =
      `Map được ${allMapped.length}/${total} dòng (lỗi ${totalInvalid}). ` +
      `Network có thể đã đổi cấu trúc dữ liệu — kiểm tra rows_path/mapping. ` +
      `Lỗi mẫu: ${allErrorSamples.slice(0, 3).join(' | ') || '(không có)'}`
    await fail(tag, runId, dryRun, 'MAPPING_FAILED', message, counts)
    return { status: 'failed', errorType: 'MAPPING_FAILED' }
  }

  const batch = dedupeRows(allMapped, config.reports[0].duplicate_strategy, networkId)
  counts.records_mapped = batch.length
  log.info(`map OK: ${allMapped.length} dòng thô → ${batch.length} dòng sau gộp (${totalInvalid} dòng lỗi bỏ qua)`, tag)

  // project_mapping riêng cho tài khoản: default = project_id của account, giữ rules offer-level chung
  const accountPm = { default_project_id: account.project_id, rules: config.project_mapping.rules }

  // ---- 3. Dry-run: in kết quả rồi dừng ----
  if (dryRun) {
    await printDryRun(tag, batch, config, accountPm)
    return { status: 'dry-run', rows: batch.length }
  }

  // ---- 4. Ghi DB ----
  try {
    // Lấy tỷ giá TRƯỚC khi ghi để đóng băng revenue_usd vào revenue_raw (khớp P&L).
    // Fail (nguồn tỷ giá chết) → fail-soft: vẫn ghi raw với revenue_usd/fx_rate = null,
    // run vẫn success; chạy lại sau để điền USD + đồng bộ P&L.
    let rate
    try {
      rate = await resolveFxRate(config)
    } catch (err) {
      log.warn(`Không lấy được tỷ giá: ${err.message}. Ghi revenue_raw không có USD, bỏ qua P&L lần này; chạy lại sau.`, tag)
    }

    const rawRows = batch.map((r) => ({
      ...r,
      account_id: account.id,
      account_label: account.label,
      project_id: account.project_id,
      fx_rate: rate ?? null,
      revenue_usd: rate !== undefined ? Math.round(r.revenue * rate * 100) / 100 : null,
    }))
    const upserted = await upsertRevenueRaw(rawRows, runId)
    counts.records_upserted = upserted

    let pnlCount = 0
    if (config.sync_pnl && rate !== undefined) {
      const pnlRows = toPnlRows(batch, accountPm, rate)
      pnlCount = await upsertAffiliateRevenue(pnlRows)
      log.info(`đồng bộ P&L: ${pnlCount} dòng (project, ngày) → affiliate_revenue [pending] (fx=${rate}, dự án ${account.project_id})`, tag)
    }

    await updateRun(runId, { status: 'success', ...counts })
    await closeAlerts(tag)
    log.info(`✓ thành công: ${upserted} dòng revenue_raw${config.sync_pnl ? `, ${pnlCount} dòng P&L` : ''}`, tag)
    return { status: 'success', rows: upserted }
  } catch (err) {
    await fail(tag, runId, dryRun, 'DB_ERROR', err.message, counts)
    return { status: 'failed', errorType: 'DB_ERROR' }
  }
}

async function printDryRun(networkId, batch, config, projectMapping) {
  const byDate = new Map()
  for (const row of batch) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.revenue)
  }
  const dates = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  log.info(`--- DRY RUN (không ghi DB) ---`, networkId)
  log.info(`tổng ${batch.length} dòng, ${dates.length} ngày`, networkId)
  for (const [date, revenue] of dates) {
    log.info(`  ${date}: ${revenue.toFixed(2)}`, networkId)
  }
  log.info(`5 dòng mẫu:`, networkId)
  for (const row of batch.slice(0, 5)) {
    log.info(
      `  ${row.date} | ${row.offer_id} | ${row.offer_name} | ${row.revenue} ${row.currency} | status=${row.status ?? '-'}`,
      networkId
    )
  }
  if (config.sync_pnl) {
    let rate = config.fx_to_usd
    try {
      rate = await resolveFxRate(config)
    } catch (err) {
      log.warn(`Không lấy được tỷ giá (${err.message}); dry-run tạm hiển thị fx=${rate}`, networkId)
    }
    const pnlRows = toPnlRows(batch, projectMapping, rate)
    log.info(`sẽ đồng bộ P&L thành ${pnlRows.length} dòng (project, ngày) [fx=${rate}]:`, networkId)
    for (const row of pnlRows.slice(0, 5)) {
      log.info(`  ${row.project_id} | ${row.date} | $${row.amount}`, networkId)
    }
  }
}
