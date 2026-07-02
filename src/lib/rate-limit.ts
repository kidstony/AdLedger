const requestMap = new Map<string, number[]>()

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const times = (requestMap.get(key) ?? []).filter(t => now - t < windowMs)
  if (times.length >= limit) return false
  requestMap.set(key, [...times, now])
  return true
}
