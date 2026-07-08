import { log } from './logger.js'

// Cache tỷ giá trong 1 lần chạy (nhiều network cùng EUR → chỉ gọi API 1 lần)
const cache = new Map()

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

// Trả tỷ giá <currency> → USD (số nhân). USD → 1. Throw nếu cả 2 nguồn fail.
export async function getRateToUsd(currency) {
  const cur = String(currency || 'USD').toUpperCase()
  if (cur === 'USD') return 1
  if (cache.has(cur)) return cache.get(cur)

  // Nguồn chính: frankfurter.dev (ECB, free, no key)
  try {
    const data = await fetchJson(`https://api.frankfurter.dev/v1/latest?base=${cur}&symbols=USD`)
    const rate = data?.rates?.USD
    if (typeof rate === 'number' && rate > 0) {
      log.info(`tỷ giá ${cur}→USD = ${rate} (frankfurter.dev, ${data.date})`)
      cache.set(cur, rate)
      return rate
    }
  } catch (err) {
    log.warn(`frankfurter.dev lỗi (${err.message}), thử nguồn dự phòng...`)
  }

  // Dự phòng: open.er-api.com (free, no key)
  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${cur}`)
    const rate = data?.rates?.USD
    if (typeof rate === 'number' && rate > 0) {
      log.info(`tỷ giá ${cur}→USD = ${rate} (open.er-api.com)`)
      cache.set(cur, rate)
      return rate
    }
  } catch (err) {
    log.warn(`open.er-api.com lỗi (${err.message})`)
  }

  throw new Error(`Không lấy được tỷ giá ${cur}→USD từ cả 2 nguồn`)
}
