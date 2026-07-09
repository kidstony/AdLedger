import { NextResponse } from 'next/server'
import { getCallerProfile } from '@/lib/require-role'

// Lấy tỷ giá <from>→USD phía SERVER (tránh CORS khi panel gọi frankfurter trực tiếp).
// Chỉ để hiển thị preview quy đổi; conversion khi sync do engine/lib/fx.js lo.
const ALLOWED = ['super_admin', 'manager']

async function fetchJson(url: string, timeoutMs = 8000) {
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

export async function GET(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const from = String(new URL(req.url).searchParams.get('from') ?? 'USD').toUpperCase()
  if (!/^[A-Z]{3}$/.test(from)) return NextResponse.json({ rate: null })
  if (from === 'USD') return NextResponse.json({ rate: 1 })

  // Nguồn chính: frankfurter.dev; dự phòng: open.er-api.com (đều free, no key).
  try {
    const d = await fetchJson(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=USD`)
    const rate = d?.rates?.USD
    if (typeof rate === 'number' && rate > 0) return NextResponse.json({ rate })
  } catch { /* thử dự phòng */ }
  try {
    const d = await fetchJson(`https://open.er-api.com/v6/latest/${from}`)
    const rate = d?.rates?.USD
    if (typeof rate === 'number' && rate > 0) return NextResponse.json({ rate })
  } catch { /* hết nguồn */ }

  return NextResponse.json({ rate: null })
}
