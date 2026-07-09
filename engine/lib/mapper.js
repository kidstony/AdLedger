import { getPath } from './extract.js'
import { parseDate } from './dates.js'

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

// Map 1 dòng raw → schema chung. Trả { row } hoặc { error }.
function mapRow(raw, mapping) {
  const out = { raw_payload: raw }

  for (const [field, spec] of Object.entries(mapping)) {
    if (field.startsWith('_')) continue // key chú thích trong config

    let value = getPath(raw, spec.path)
    if (value === undefined || value === null || value === '') {
      value = spec.default
    }

    if (field === 'date') {
      const rawVal = value
      value = parseDate(value, spec.formats ?? [], spec.order ?? 'DMY')
      if (!value) return { error: `date không parse được: ${JSON.stringify(rawVal)} (path=${spec.path})` }
    } else if (field === 'revenue') {
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

// Map toàn bộ raw rows → { mapped, invalid, errorSamples }
export function mapRows(rawRows, mapping) {
  const mapped = []
  const errorSamples = []
  let invalid = 0

  for (const raw of rawRows) {
    if (raw == null || typeof raw !== 'object') {
      invalid++
      continue
    }
    const result = mapRow(raw, mapping)
    if (result.error) {
      invalid++
      if (errorSamples.length < 5) errorSamples.push(result.error)
    } else {
      mapped.push(result.row)
    }
  }
  return { mapped, invalid, errorSamples }
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

// Áp project_mapping rồi gộp SUM theo (project, ngày) cho affiliate_revenue.
// Trả [{ project_id, date, amount }] — amount đã nhân fx_to_usd, làm tròn 2 số lẻ.
export function toPnlRows(rows, projectMapping, fxToUsd = 1) {
  const resolveProject = (row) => {
    for (const rule of projectMapping.rules ?? []) {
      const value = String(row[rule.match_field] ?? '')
      if (new RegExp(rule.pattern).test(value)) return rule.project_id
    }
    return projectMapping.default_project_id
  }

  const byKey = new Map()
  for (const row of rows) {
    const projectId = resolveProject(row)
    const key = `${projectId}|${row.date}`
    byKey.set(key, (byKey.get(key) ?? 0) + row.revenue * fxToUsd)
  }

  return [...byKey.entries()].map(([key, amount]) => {
    const [project_id, date] = key.split('|')
    return { project_id, date, amount: Math.round(amount * 100) / 100 }
  })
}
