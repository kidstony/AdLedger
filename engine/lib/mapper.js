import { getPath } from './extract.js'
import { parseDate, parseDateTime } from './dates.js'
import { normalizeCountry, normalizeDevice, extractCountryFromText, extractDeviceFromText } from './normalize.js'

// Parse số tiền: nhận number hoặc chuỗi có ký hiệu tiền/separator ("$1,234.56", "1.234,56 ₫")
export function parseAmount(value, spec = {}) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value / (spec.divisor ?? 1) : null
  }

  let s = String(value).trim()
  const thousands = spec.thousands_separator ?? ','
  const decimal = spec.decimal_separator ?? '.'
  // Bỏ mọi thứ không phải số/separator/dấu âm (ký hiệu tiền tệ, khoảng trắng...)
  s = s.replace(new RegExp(`[^0-9\\-${escapeRegex(thousands)}${escapeRegex(decimal)}]`, 'g'), '')
  s = s.split(thousands).join('')
  if (decimal !== '.') s = s.replace(decimal, '.')

  const num = Number(s)
  if (!Number.isFinite(num)) return null
  return num / (spec.divisor ?? 1)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Ô "trống" theo nghĩa bảng scrape: undefined/null/'' hoặc ký tự thay thế phổ biến
// ('-', '–', '—', 'n/a'...) mà các dashboard hay điền vào ô chưa có dữ liệu.
const BLANK_PLACEHOLDERS = new Set(['', '-', '–', '—', 'n/a', 'na', 'null', 'none'])
function isBlankCell(v) {
  if (v === undefined || v === null) return true
  return BLANK_PLACEHOLDERS.has(String(v).trim().toLowerCase())
}

// Map 1 dòng raw → schema chung. Trả { row } | { error } | { skip }.
// skip ≠ error: ô NGUỒN TRỐNG (dòng phụ/tổng của bảng HTML, click chưa chuyển đổi...)
// là chuyện bình thường của dữ liệu thật → bỏ qua dòng, KHÔNG tính vào tỷ lệ lỗi
// (trước đây đếm là lỗi → vượt max_invalid_row_ratio → vứt oan cả report).
// Ô CÓ nội dung mà parse không ra mới là lỗi thật (network đổi cấu trúc).
function mapRow(raw, mapping) {
  const out = { raw_payload: raw }

  for (const [field, spec] of Object.entries(mapping)) {
    if (field.startsWith('_')) continue // key chú thích trong config

    let value = getPath(raw, spec.path)
    if (value === undefined || value === null || value === '') {
      value = spec.default
    }

    if (field === 'date') {
      if (isBlankCell(value)) {
        return { skip: `ô ngày trống (path=${spec.path})` }
      }
      const rawVal = value
      value = parseDate(value, spec.formats ?? [], spec.order ?? 'DMY')
      if (!value) return { error: `date không parse được: ${JSON.stringify(rawVal)} (path=${spec.path})` }
    } else if (field === 'revenue') {
      if (isBlankCell(value)) {
        return { skip: `ô tiền trống (path=${spec.path})` }
      }
      const rawVal = value
      value = parseAmount(value, spec)
      if (value === null) return { error: `revenue không parse được: ${JSON.stringify(rawVal)} (path=${spec.path})` }
    } else if (field === 'clicks' || field === 'conversions') {
      value = value === undefined ? null : Number(value)
      if (value !== null && !Number.isFinite(value)) value = null
    } else if (spec.value_map && value !== undefined) {
      value = spec.value_map[String(value).toLowerCase()] ?? spec.default ?? String(value)
    }

    if ((value === undefined || value === null) && spec.required !== false && field !== 'clicks' && field !== 'conversions') {
      return { error: `thiếu field bắt buộc "${field}" (path=${spec.path})` }
    }

    out[field] = value === undefined ? null : value
  }

  out.offer_id = out.offer_id != null ? String(out.offer_id) : ''
  out.offer_name = out.offer_name != null ? String(out.offer_name) : ''
  out.currency = out.currency ?? 'USD'
  return { row: out }
}

// Map toàn bộ raw rows → { mapped, invalid, skipped, errorSamples }
// skipped = dòng ô nguồn trống (không phải dữ liệu) — đứng NGOÀI tỷ lệ lỗi validate.
export function mapRows(rawRows, mapping) {
  const mapped = []
  const errorSamples = []
  let invalid = 0
  let skipped = 0

  for (const raw of rawRows) {
    if (raw == null || typeof raw !== 'object') {
      invalid++
      continue
    }
    const result = mapRow(raw, mapping)
    if (result.skip) {
      skipped++
    } else if (result.error) {
      invalid++
      if (errorSamples.length < 5) errorSamples.push(result.error)
    } else {
      mapped.push(result.row)
    }
  }
  return { mapped, invalid, skipped, errorSamples }
}

// Dedupe/aggregate theo khóa upsert (network+date+offer).
// 'last' = dòng sau đè dòng trước; 'sum' = cộng dồn revenue/clicks/conversions.
export function dedupeRows(rows, strategy, networkId) {
  const byKey = new Map()
  for (const row of rows) {
    const key = `${networkId}|${row.date}|${row.offer_id}|${row.offer_name}`
    const existing = byKey.get(key)
    if (!existing || strategy === 'last') {
      byKey.set(key, { ...row, network_id: networkId })
    } else {
      existing.revenue += row.revenue
      if (row.clicks != null) existing.clicks = (existing.clicks ?? 0) + row.clicks
      if (row.conversions != null) existing.conversions = (existing.conversions ?? 0) + row.conversions
      existing.raw_payload = row.raw_payload // giữ payload dòng mới nhất làm mẫu
    }
  }
  return [...byKey.values()]
}

// Gán project cho 1 dòng theo project_mapping: rules (regex offer_id/offer_name) → default.
// Dùng chung cho P&L (toPnlRows) và revenue_breakdown.
export function resolveProject(row, projectMapping) {
  for (const rule of projectMapping.rules ?? []) {
    const value = String(row[rule.match_field] ?? '')
    if (new RegExp(rule.pattern).test(value)) return rule.project_id
  }
  return projectMapping.default_project_id
}

// Áp project_mapping rồi gộp SUM theo (project, ngày) cho affiliate_revenue.
// Trả [{ project_id, date, amount }] — amount đã nhân fx_to_usd, làm tròn 2 số lẻ.
// fx: SỐ (tỷ giá cố định) HOẶC HÀM (currency)=>number — quy đổi USD theo tiền tệ TỪNG DÒNG
// (mỗi dự án/nguồn có thể khác tiền tệ → không ép 1 tỷ giá).
export function toPnlRows(rows, projectMapping, fx = 1) {
  const rateOf = typeof fx === 'function' ? fx : () => fx
  const byKey = new Map()
  for (const row of rows) {
    const projectId = resolveProject(row, projectMapping)
    const key = `${projectId}|${row.date}`
    byKey.set(key, (byKey.get(key) ?? 0) + row.revenue * (Number(rateOf(row.currency)) || 0))
  }

  return [...byKey.entries()].map(([key, amount]) => {
    const [project_id, date] = key.split('|')
    return { project_id, date, amount: Math.round(amount * 100) / 100 }
  })
}

// ============================================================
// Report kind='breakdown' — doanh thu theo chiều (quốc gia/thiết bị/giờ/sub-id)
// ============================================================

// Map field tùy chọn từ mapping (offer/currency/clicks/conversions) — không fail dòng.
function mapOptional(raw, spec) {
  if (!spec?.path) return undefined
  let value = getPath(raw, spec.path)
  if (value === undefined || value === null || value === '') value = spec.default
  if (spec.value_map && value !== undefined && value !== null) {
    value = spec.value_map[String(value).toLowerCase()] ?? spec.default ?? String(value)
  }
  return value
}

// Map 1 dòng raw của report breakdown → { row } | { error } | { skip }.
// Khác mapRow (revenue): mọi dimension TÙY CHỌN → sentinel ('' / hour=-1);
// date có thể suy từ dimensions.conversion_time khi report không có cột ngày riêng.
// skip ≠ error: ô nguồn TRỐNG (dòng phụ của bảng, click chưa chuyển đổi nên chưa có
// ngày hoàn thành...) → bỏ qua dòng, không tính vào tỷ lệ lỗi validate.
function mapBreakdownRow(raw, mapping, dimensions, tz, windowEndDate = null) {
  const out = { raw_payload: raw }

  // revenue — bắt buộc. Ô trống (và không có default) = dòng không phải dữ liệu → skip.
  let rev = getPath(raw, mapping.revenue.path)
  if (isBlankCell(rev)) rev = mapping.revenue.default
  if (isBlankCell(rev)) {
    return { skip: `ô tiền trống (path=${mapping.revenue.path})` }
  }
  const revParsed = parseAmount(rev, mapping.revenue)
  if (revParsed === null) return { error: `revenue không parse được: ${JSON.stringify(rev)} (path=${mapping.revenue.path})` }
  out.revenue = revParsed

  // date từ mapping.date (nếu khai) — fallback suy từ conversion_time bên dưới.
  // Theo dõi ô nguồn có NỘI DUNG hay không để phân biệt skip (trống) vs error (sai).
  let date = null
  let dateCellEmpty = true
  if (mapping.date?.path) {
    const v = getPath(raw, mapping.date.path)
    if (!isBlankCell(v)) dateCellEmpty = false
    date = parseDate(v, mapping.date.formats ?? [], mapping.date.order ?? 'DMY')
  }

  // conversion_time → hour (0-23) + date fallback. Múi giờ: spec.timezone → config.timezone → UTC (giá trị tuyệt đối).
  out.hour = -1
  const ct = dimensions.conversion_time
  let ctCellEmpty = true
  if (ct?.path) {
    const v = getPath(raw, ct.path)
    if (!isBlankCell(v)) ctCellEmpty = false
    // order (DMY/MDY) cho chuỗi kiểu "14.7.2026 16:53" — mượn order của mapping.date nếu ct không khai.
    const dt = parseDateTime(v, ct.formats ?? [], ct.timezone ?? tz ?? null, ct.order ?? mapping.date?.order ?? 'DMY')
    if (dt) {
      out.hour = dt.hour
      if (!date) date = dt.date
    }
  }
  // date_mode='window_end': nguồn tổng-theo-kỳ (Location/Device không có cột ngày) → gán ngày cuối cửa sổ.
  if (!date && windowEndDate) date = windowEndDate
  if (!date) {
    if (dateCellEmpty && ctCellEmpty) {
      return { skip: 'ô ngày trống (vd click chưa chuyển đổi / dòng phụ của bảng)' }
    }
    return { error: `không có ngày: mapping.date${mapping.date?.path ? `(${mapping.date.path})` : ''} và conversion_time${ct?.path ? `(${ct.path})` : ''} đều không parse được` }
  }
  out.date = date

  // dimensions còn lại — thiếu/không nhận diện được → sentinel, dòng vẫn hợp lệ.
  // extract:true → cột TEXT HỖN HỢP (vd "Warsaw, Poland desktop") → trích nước/thiết bị nhúng.
  out.country = dimensions.country?.path
    ? (dimensions.country.extract
        ? extractCountryFromText(getPath(raw, dimensions.country.path), dimensions.country.value_map ?? null)
        : normalizeCountry(getPath(raw, dimensions.country.path), dimensions.country.value_map ?? null))
    : ''
  out.device = dimensions.device?.path
    ? (dimensions.device.extract
        ? extractDeviceFromText(getPath(raw, dimensions.device.path), dimensions.device.value_map ?? null)
        : normalizeDevice(getPath(raw, dimensions.device.path), dimensions.device.value_map ?? null))
    : ''
  const subIdVal = dimensions.sub_id?.path ? getPath(raw, dimensions.sub_id.path) : null
  out.sub_id = subIdVal != null ? String(subIdVal) : ''
  const txnVal = dimensions.transaction_id?.path ? getPath(raw, dimensions.transaction_id.path) : null
  out.transaction_id = txnVal != null && txnVal !== '' ? String(txnVal) : null

  // mapping tùy chọn
  const offerId = mapOptional(raw, mapping.offer_id)
  const offerName = mapOptional(raw, mapping.offer_name)
  out.offer_id = offerId != null ? String(offerId) : ''
  out.offer_name = offerName != null ? String(offerName) : ''
  out.currency = mapOptional(raw, mapping.currency) ?? 'USD'
  for (const numField of ['clicks', 'conversions']) {
    let v = mapOptional(raw, mapping[numField])
    v = v === undefined || v === null ? null : Number(v)
    out[numField] = v !== null && Number.isFinite(v) ? v : null
  }

  return { row: out }
}

// Map toàn bộ raw rows của report breakdown → { mapped, invalid, skipped, errorSamples }
// skipped = dòng ô nguồn trống (không phải dữ liệu) — đứng NGOÀI tỷ lệ lỗi validate.
export function mapBreakdownRows(rawRows, mapping, dimensions, { timezone = null, windowEndDate = null } = {}) {
  const mapped = []
  const errorSamples = []
  let invalid = 0
  let skipped = 0
  for (const raw of rawRows) {
    if (raw == null || typeof raw !== 'object') {
      invalid++
      continue
    }
    const result = mapBreakdownRow(raw, mapping, dimensions ?? {}, timezone, windowEndDate)
    if (result.skip) {
      skipped++
    } else if (result.error) {
      invalid++
      if (errorSamples.length < 5) errorSamples.push(result.error)
    } else {
      mapped.push(result.row)
    }
  }
  return { mapped, invalid, skipped, errorSamples }
}

// Gộp rows breakdown về grain upsert (date × dims × offer):
// 1. Nguồn có transaction_id → dedupe trước (cùng chuyển đổi lặp lại qua pagination).
// 2. 'sum' (nguồn per-conversion) = cộng dồn; 'last' (nguồn đã tổng hợp sẵn) = dòng sau đè.
// Re-fetch cửa sổ trùng chỉ đè cùng cell trong DB → không sinh duplicate.
export function aggregateBreakdownRows(rows, strategy, networkId, reportName) {
  let input = rows
  if (rows.some((r) => r.transaction_id)) {
    const byTxn = new Map()
    const noTxn = []
    for (const r of rows) {
      if (r.transaction_id) byTxn.set(r.transaction_id, r)
      else noTxn.push(r)
    }
    input = [...byTxn.values(), ...noTxn]
  }

  const byKey = new Map()
  for (const row of input) {
    const key = [networkId, reportName, row.date, row.country, row.device, row.hour, row.sub_id, row.offer_id, row.offer_name].join('|')
    const existing = byKey.get(key)
    if (!existing || strategy === 'last') {
      byKey.set(key, { ...row, network_id: networkId, report: reportName })
    } else {
      existing.revenue += row.revenue
      if (row.clicks != null) existing.clicks = (existing.clicks ?? 0) + row.clicks
      if (row.conversions != null) existing.conversions = (existing.conversions ?? 0) + row.conversions
      existing.raw_payload = row.raw_payload // giữ payload dòng mới nhất làm mẫu
    }
  }
  // transaction_id chỉ dùng dedupe trong batch — không lưu DB
  return [...byKey.values()].map(({ transaction_id, ...r }) => r)
}

// sub_id → campaign_id Google (user truyền {campaignid} qua tracking link). Không khớp → null.
export function extractCampaignId(subId, subIdParse) {
  if (!subId || !subIdParse?.pattern) return null
  const m = String(subId).match(new RegExp(subIdParse.pattern))
  if (!m) return null
  return m[subIdParse.group ?? 1] ?? m[0] ?? null
}
