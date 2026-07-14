// Logic chạy fetch 1 network / 1 account — tách từ fetch-all.js để worker.js dùng lại.
import { log } from './logger.js'
import { openContext } from './browser.js'
import { captureReports } from './capture.js'
import { extractRows } from './extract.js'
import { mapRows, dedupeRows, toPnlRows, mapBreakdownRows, aggregateBreakdownRows, resolveProject, extractCampaignId } from './mapper.js'
import { insertRun, updateRun, upsertRevenueRaw, upsertAffiliateRevenue, hasRevenueRows, upsertRevenueBreakdown, hasBreakdownRows } from './db.js'
import { openAlert, closeAlerts } from './alerts.js'
import { dateWindow } from './dates.js'
import { getRateToUsd } from './fx.js'
import { acquireLock, releaseLock } from './lockfile.js'

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
// kind: 'revenue' (P&L — report thường) | 'breakdown' (dữ liệu tối ưu camp) — 2 PIPELINE
// ĐỘC LẬP: chạy lệnh riêng, run/alert riêng, lỗi bên này không che/không kéo bên kia.
export async function runNetwork(config, dryRun, accountFilter = null, kind = 'revenue') {
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
      log.info(`--- tài khoản: ${account.label} (${account.id}) [${kind}] → dự án ${account.project_id} ---`, account.id)
    }
    // Khóa THEO ACCOUNT (tái nhập): worker có thể đã khóa account này → không tự kẹt; nếu tiến
    // trình KHÁC (worker vs fetch-all.js) đang chạy đúng account → bỏ qua để không mở trùng profile.
    // dry-run không mở browser thật → không cần khóa.
    if (!dryRun && !acquireLock(account.id)) {
      log.warn(`Account "${account.id}" đang bận (tiến trình khác) — bỏ qua lượt này.`, account.id)
      results.push({ account: account.id, status: 'deferred', reason: 'account đang bận (lock)', kind })
      continue
    }
    try {
      const r = await runAccount(config, account, dryRun, kind)
      results.push({ account: account.id, ...r })
    } finally {
      if (!dryRun) releaseLock(account.id)
    }
  }
  return results
}

export async function runAccount(config, account, dryRun, kind = 'revenue') {
  const networkId = config.network_id
  const isBd = kind === 'breakdown'
  // Khóa alert + nhãn log RIÊNG từng pipeline: alert breakdown không bao giờ đóng/đè alert doanh thu.
  const tag = isBd ? `${account.id}:breakdown` : account.id
  let runId = null
  let context = null
  let result = null

  // Chỉ chạy report của pipeline này. Filter TRƯỚC capture (captureReports gắn report_index
  // theo VỊ TRÍ trong config.reports → phải dùng scoped config để index khớp).
  const reports = config.reports.filter((r) => (r.kind === 'breakdown') === isBd)
  if (isBd && config.breakdown_enabled === false) {
    log.info('breakdown đang TẮT cho network này — bỏ qua.', tag)
    return { status: 'skipped', reason: 'breakdown tắt cho network này', kind }
  }
  if (reports.length === 0) {
    return { status: 'skipped', reason: isBd ? 'không có report breakdown' : 'không có report doanh thu', kind }
  }
  const scoped = { ...config, reports }

  // Lần đầu pipeline này (bảng đích chưa có dòng nào của account) → backfill; lần sau → incremental.
  // Kiểm RIÊNG per kind: bật breakdown cho network sync lâu → run breakdown đầu tự backfill,
  // KHÔNG đụng cửa sổ của pipeline doanh thu. dry-run luôn dùng window_days.
  const firstRun =
    !dryRun &&
    (isBd ? !(await hasBreakdownRows(networkId, account.id)) : !(await hasRevenueRows(networkId, account.id)))
  const windowDays = firstRun ? config.backfill_days : config.window_days
  log.info(
    firstRun
      ? `lần đầu account "${account.id}" [${kind}]: backfill ${windowDays} ngày`
      : `incremental [${kind}]: ${windowDays} ngày`,
    tag
  )

  if (!dryRun) {
    // Không tạo được run row = không có DB → dừng tài khoản này ngay (throw lên main)
    const w = dateWindow(windowDays, config.timezone)
    runId = await insertRun(networkId, account.id, w.fromISO, w.toISO, kind)
  }

  // ---- 1. Mở browser + hứng response ----
  try {
    context = await openContext(account.id)
    const page = context.pages()[0] ?? (await context.newPage())
    result = await captureReports(page, scoped, account.dashboard_url, { windowDays })
  } catch (err) {
    await fail(tag, runId, dryRun, 'NO_CAPTURE', `Lỗi browser/navigation: ${err.message.split('\n')[0]}`)
    return { status: 'failed', errorType: 'NO_CAPTURE', kind }
  } finally {
    if (context) await context.close().catch(() => {})
  }

  const { captured, loginSignal, finalUrl, window } = result
  log.info(`hứng được ${captured.length} response JSON khớp pattern`, tag)

  if (captured.length === 0) {
    const reason = loginSignal
      ? `Mất phiên đăng nhập (${loginSignal}) — chạy: node login.js --network=${networkId} --account=${account.id}`
      : `Không hứng được response nào khớp pattern (URL cuối: ${finalUrl}). Network có thể đã đổi endpoint — kiểm tra lại capture.url_pattern trong config.`
    await fail(tag, runId, dryRun, 'NO_CAPTURE', reason)
    return { status: 'failed', errorType: 'NO_CAPTURE', kind }
  }

  // ---- 2. Extract + map + dedupe THEO TỪNG REPORT ----
  // Khớp captured→report bằng INDEX (không bằng name: 2 report có thể trùng name 'revenue').
  // Gom mọi payload cùng report_index (1 report có thể bắn nhiều response/trang).
  const payloadsByReport = new Map() // ri -> [{ payload, date }]  (date: ngày truy vấn cho report per_day)
  for (const cap of captured) {
    const ri = cap.report_index ?? 0
    if (!payloadsByReport.has(ri)) payloadsByReport.set(ri, [])
    payloadsByReport.get(ri).push({ payload: cap.payload, date: cap.date ?? null })
  }

  // Validate + ghi PER-REPORT (partial success): report lỗi → cảnh báo & bỏ qua, report
  // khác vẫn chạy; account chỉ fail khi KHÔNG report nào ok. Gắn _type để tách P&L.
  // kind='revenue' → batch (revenue_raw + P&L); kind='breakdown' → breakdownBatch
  // (revenue_breakdown, KHÔNG vào P&L — tránh double-count doanh thu).
  let batch = []
  let breakdownBatch = []
  let totalMapped = 0, totalInvalidAll = 0, totalSkippedAll = 0
  let anyOk = false // có report nào qua validate (kể cả 0 dòng khi min_mapped_rows=0)
  const failReasons = []
  for (const [ri, payloads] of payloadsByReport) {
    const report = scoped.reports[ri] // index khớp mảng ĐÃ lọc theo kind (đã truyền vào capture)
    if (!report) continue
    const isBreakdown = report.kind === 'breakdown'
    let mappedR = [], invalidR = 0, skippedR = 0, samplesR = []
    for (const { payload, date } of payloads) {
      const rawRows = extractRows(payload, report.rows_path)
      const { mapped, invalid, skipped, errorSamples } = isBreakdown
        ? mapBreakdownRows(rawRows, report.mapping, report.dimensions, {
            timezone: config.timezone,
            // per_day: ngày = NGÀY TRUY VẤN (bơm từ capture) → dữ liệu quốc gia × ngày thật.
            // Ngược lại, nguồn tổng-theo-kỳ (date_mode='window_end') → gán ngày cuối cửa sổ.
            windowEndDate: report.per_day ? date : (report.date_mode === 'window_end' ? window.toISO : null),
          })
        : mapRows(rawRows, report.mapping)
      mappedR.push(...mapped); invalidR += invalid; skippedR += skipped ?? 0; samplesR.push(...errorSamples)
    }
    totalMapped += mappedR.length; totalInvalidAll += invalidR; totalSkippedAll += skippedR
    // Dòng ô-trống (skippedR) là dòng phụ/tổng của bảng hoặc click chưa chuyển đổi —
    // KHÔNG tính vào tỷ lệ lỗi (trước đây tính → vượt ngưỡng → vứt oan cả report).
    const totalR = mappedR.length + invalidR
    // 0 dòng (totalR=0): coi tỷ lệ lỗi = OK (nguồn rỗng hợp lệ khi min_mapped_rows=0, vd payout chưa có khoản nào).
    const ratioOk = totalR === 0 ? true : invalidR / totalR <= report.validation.max_invalid_row_ratio
    const v = report.validation
    if (mappedR.length < v.min_mapped_rows || !ratioOk) {
      failReasons.push(`report "${report.name}" [${isBreakdown ? 'breakdown' : report.revenue_type}]: ${mappedR.length}/${totalR} (lỗi ${invalidR}${skippedR ? `, ${skippedR} dòng trống bỏ qua` : ''}) — ${samplesR.slice(0, 2).join(' | ') || '?'}`)
      log.warn(`bỏ qua report "${report.name}" [${isBreakdown ? 'breakdown' : report.revenue_type}]: map ${mappedR.length}/${totalR}, lỗi ${invalidR}${skippedR ? `, ${skippedR} dòng trống` : ''}. Mẫu: ${samplesR.slice(0, 2).join(' | ') || '(không có)'}`, tag)
      continue
    }
    anyOk = true // report qua validate (kể cả rỗng)
    if (isBreakdown) {
      const agg = aggregateBreakdownRows(mappedR, report.duplicate_strategy, networkId, report.name)
      for (const r of agg) r._type = report.revenue_type // 'pending' | 'confirmed'
      breakdownBatch.push(...agg)
    } else {
      const deduped = dedupeRows(mappedR, report.duplicate_strategy, networkId)
      for (const r of deduped) r._type = report.revenue_type // 'pending' | 'confirmed'
      batch.push(...deduped)
    }
  }

  const counts = { records_captured: captured.length, records_mapped: totalMapped }

  // Chỉ fail khi KHÔNG report nào qua validate. Report rỗng hợp lệ (0 dòng, min=0) → anyOk=true,
  // batch có thể rỗng → vẫn success (ghi 0 dòng), khi có dữ liệu tự vào.
  if (!anyOk) {
    const message =
      `Không report nào map được dữ liệu hợp lệ (map ${totalMapped}, lỗi ${totalInvalidAll}). ` +
      `Network có thể đã đổi cấu trúc — kiểm tra rows_path/mapping. ${failReasons.join(' ;; ') || ''}`
    await fail(tag, runId, dryRun, 'MAPPING_FAILED', message, counts)
    return { status: 'failed', errorType: 'MAPPING_FAILED', kind }
  }
  if (failReasons.length) log.warn(`${failReasons.length} report bị bỏ qua, ${isBd ? breakdownBatch.length : batch.length} dòng từ report ok vẫn được ghi.`, tag)

  counts.records_mapped = isBd ? breakdownBatch.length : batch.length
  log.info(
    `map OK [${kind}]: ${totalMapped} dòng thô → ${counts.records_mapped} dòng sau gộp (${totalInvalidAll} dòng lỗi${totalSkippedAll ? `, ${totalSkippedAll} dòng trống` : ''} bỏ qua)`,
    tag
  )

  // project_mapping riêng cho tài khoản: default = project_id của account, giữ rules offer-level chung
  const accountPm = { default_project_id: account.project_id, rules: config.project_mapping.rules }

  // ---- 3. Dry-run: in kết quả rồi dừng ----
  if (dryRun) {
    await printDryRun(tag, batch, breakdownBatch, config, accountPm, kind)
    return { status: 'dry-run', rows: batch.length + breakdownBatch.length, kind }
  }

  // ---- 4. Ghi DB (mỗi pipeline chỉ ghi bảng của mình) ----
  try {
    // Tỷ giá THEO TIỀN TỆ TỪNG DÒNG (không ép 1 tỷ giá cả network): mỗi dòng có currency riêng
    // (mapping.currency) → quy đổi bằng getRateToUsd(currency). USD→1, cache trong fx.js. Fail-soft
    // TỪNG currency: lấy tỷ giá lỗi → dòng currency đó revenue_usd/fx_rate=null, chạy lại sau.
    const activeBatch = isBd ? breakdownBatch : batch
    const curOf = (r) => String(r.currency || 'USD').toUpperCase()
    const rateByCur = new Map() // CUR → number | undefined
    await Promise.all([...new Set(activeBatch.map(curOf))].map(async (cur) => {
      try { rateByCur.set(cur, await getRateToUsd(cur)) }
      catch (err) { rateByCur.set(cur, undefined); log.warn(`Không lấy được tỷ giá ${cur}→USD: ${err.message}. Ghi không USD cho dòng ${cur}; chạy lại sau.`, tag) }
    }))
    const rateOf = (cur) => rateByCur.get(String(cur || 'USD').toUpperCase())
    const usdOfRow = (r) => { const rt = rateOf(r.currency); return rt !== undefined ? Math.round(r.revenue * rt * 100) / 100 : null }
    // Mọi currency trong batch đều có tỷ giá? → gate ghi P&L (giữ fail-soft: thiếu tỷ giá thì hoãn P&L).
    const allRatesOk = [...rateByCur.values()].every((v) => v !== undefined)

    let upserted = 0
    let breakdownUpserted = 0
    let pnlCount = 0

    if (isBd) {
      // Pipeline TỐI ƯU: chỉ ghi revenue_breakdown — không đụng revenue_raw/affiliate_revenue.
      const bdRows = breakdownBatch.map(({ _type, ...r }) => ({
        ...r,
        account_id: account.id,
        project_id: resolveProject(r, accountPm) ?? null,
        campaign_id: extractCampaignId(r.sub_id, config.sub_id_parse),
        fx_rate: rateOf(r.currency) ?? null,
        revenue_usd: usdOfRow(r),
        revenue_type: _type ?? 'pending',
      }))
      breakdownUpserted = await upsertRevenueBreakdown(bdRows, runId)
      counts.breakdown_upserted = breakdownUpserted
    } else {
      // Pipeline DOANH THU: revenue_raw + P&L — không đụng revenue_breakdown.
      const rawRows = batch.map(({ _type, ...r }) => ({
        ...r,
        account_id: account.id,
        account_label: account.label,
        project_id: account.project_id,
        fx_rate: rateOf(r.currency) ?? null,
        revenue_usd: usdOfRow(r),
        // Loại doanh thu để UI/summary KHÔNG cộng gộp pending (màn hình) + confirmed (payout).
        revenue_type: _type ?? 'pending',
      }))
      upserted = await upsertRevenueRaw(rawRows, runId)
      counts.records_upserted = upserted

      if (config.sync_pnl && allRatesOk) {
        // Tách theo loại: 'pending' (màn hình) và 'confirmed' (thực nhận/payout) ghi riêng.
        // Quy đổi USD theo tiền tệ TỪNG DÒNG (rateOf) — không ép 1 tỷ giá.
        for (const type of ['pending', 'confirmed']) {
          const rowsOfType = batch.filter((r) => (r._type ?? 'pending') === type)
          if (rowsOfType.length === 0) continue
          const pnlRows = toPnlRows(rowsOfType, accountPm, rateOf)
          const n = await upsertAffiliateRevenue(pnlRows, type)
          pnlCount += n
          log.info(`đồng bộ P&L: ${n} dòng (project, ngày) → affiliate_revenue [${type}] (dự án ${account.project_id})`, tag)
        }
      }
    }

    await updateRun(runId, { status: 'success', ...counts })
    await closeAlerts(tag)
    // Report bị BỎ (config thiếu cột lúc load, hoặc map lỗi lúc chạy) → mở lại 1 cảnh báo để hiện lên UI.
    // Lọc theo kind: skip của pipeline kia KHÔNG mở alert ở pipeline này.
    const loadSkips = (config._skipped_reports ?? [])
      .filter((s) => (s.kind ?? 'revenue') === kind)
      .map((s) => `report "${s.name}": ${s.reason}`)
    const allSkips = [...loadSkips, ...failReasons] // failReasons đã scoped theo kind (chỉ report của kind này chạy)
    if (allSkips.length) {
      await openAlert(tag, 'MAPPING_FAILED', `Bỏ ${allSkips.length} báo cáo (vẫn sync phần còn lại): ${allSkips.join(' ;; ')}`, runId)
    }
    log.info(
      isBd
        ? `✓ thành công [breakdown]: ${breakdownUpserted} dòng revenue_breakdown`
        : `✓ thành công: ${upserted} dòng revenue_raw${config.sync_pnl ? `, ${pnlCount} dòng P&L` : ''}`,
      tag
    )
    return { status: 'success', rows: isBd ? breakdownUpserted : upserted, kind }
  } catch (err) {
    await fail(tag, runId, dryRun, 'DB_ERROR', err.message, counts)
    return { status: 'failed', errorType: 'DB_ERROR', kind }
  }
}

async function printDryRun(networkId, batch, breakdownBatch, config, projectMapping, kind = 'revenue') {
  log.info(`--- DRY RUN [${kind}] (không ghi DB) ---`, networkId)

  if (kind === 'revenue') {
    const byDate = new Map()
    for (const row of batch) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.revenue)
    }
    const dates = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))

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

  // Tóm tắt breakdown: khoảng ngày, top quốc gia, tỉ lệ thiết bị — kiểm mapping trước khi ghi thật
  if (breakdownBatch.length) {
    const bdDates = [...new Set(breakdownBatch.map((r) => r.date))].sort()
    const byCountry = new Map()
    const byDevice = new Map()
    let withHour = 0, withSubId = 0
    for (const r of breakdownBatch) {
      if (r.country) byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + r.revenue)
      if (r.device) byDevice.set(r.device, (byDevice.get(r.device) ?? 0) + r.revenue)
      if (r.hour >= 0) withHour++
      if (r.sub_id) withSubId++
    }
    log.info(`--- BREAKDOWN: ${breakdownBatch.length} dòng, ${bdDates[0]} → ${bdDates[bdDates.length - 1]} ---`, networkId)
    const topCountries = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    if (topCountries.length) {
      log.info(`top quốc gia: ${topCountries.map(([c, v]) => `${c}=${v.toFixed(2)}`).join(', ')}`, networkId)
    }
    if (byDevice.size) {
      log.info(`thiết bị: ${[...byDevice.entries()].map(([d, v]) => `${d}=${v.toFixed(2)}`).join(', ')}`, networkId)
    }
    log.info(`có giờ: ${withHour}/${breakdownBatch.length} dòng, có sub_id: ${withSubId}/${breakdownBatch.length} dòng`, networkId)
    for (const row of breakdownBatch.slice(0, 5)) {
      log.info(`  ${row.date} | ${row.country || '-'} | ${row.device || '-'} | h=${row.hour >= 0 ? row.hour : '-'} | sub=${row.sub_id || '-'} | ${row.revenue} ${row.currency}`, networkId)
    }
  }
}
