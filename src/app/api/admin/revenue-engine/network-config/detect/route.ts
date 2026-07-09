import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'

// Auto-detect config từ engine_discoveries: tìm mảng "giống bảng doanh thu", đoán
// field date/revenue/currency, trả draft config (cấu trúc như configs/*.json) + preview
// (ngày → doanh thu). Nhận override field để user chỉnh rồi xem lại preview.
const ALLOWED = ['super_admin', 'manager']

type Row = Record<string, unknown>

// Chỉ coi là ngày khi có NĂM 4 chữ số (ISO YYYY-MM-DD hoặc DD.MM.YYYY / DD/MM/YYYY /
// DD-MM-YYYY). Loại chuỗi kiểu "17 Jul" (không năm) để không thắng nhầm cột.
function isDateLike(v: unknown): boolean {
  return normDate(v) !== null
}
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''))
    return v.trim() !== '' && Number.isFinite(n) ? n : null
  }
  return null
}

// Nhận diện định dạng số của 1 cột: dấu phẩy thập phân (châu Âu "3,22") vs dấu chấm.
function numFormat(rows: Row[], field: string | null): { decimal: ',' | '.'; thousands: ',' | '.' } {
  if (!field) return { decimal: '.', thousands: ',' }
  const s = rows.map((r) => String(r[field] ?? '')).join(' ')
  // Có "…,dd" (phẩy + 1-2 chữ số, không phải nhóm nghìn 3 số) và không có ".dd" → decimal ','
  const commaDec = /\d,\d{1,2}(?!\d)/.test(s)
  const dotDec = /\d\.\d{1,2}(?!\d)/.test(s)
  if (commaDec && !dotDec) return { decimal: ',', thousands: '.' }
  return { decimal: '.', thousands: ',' }
}
// Parse tiền theo định dạng đã nhận diện.
function parseMoney(v: unknown, fmt: { decimal: string; thousands: string }): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.replace(new RegExp(`[^0-9\\-${fmt.thousands === '.' ? '\\.' : ','}${fmt.decimal === '.' ? '\\.' : ','}]`, 'g'), '')
  s = s.split(fmt.thousands).join('')
  if (fmt.decimal !== '.') s = s.replace(fmt.decimal, '.')
  const n = Number(s)
  return s !== '' && Number.isFinite(n) ? n : null
}
function normDate(v: unknown, order: 'DMY' | 'MDY' = 'DMY'): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  // ISO / YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  // YYYY.MM.DD
  const ymd = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`
  // Ngày linh hoạt (./- + dấu cách): gán day/month theo order.
  const gen = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/)
  if (gen) {
    const first = gen[1].padStart(2, '0'), second = gen[2].padStart(2, '0')
    const dd = order === 'MDY' ? second : first
    const mm = order === 'MDY' ? first : second
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${gen[3]}-${mm}-${dd}`
  }
  // Có năm 4 chữ số + parse được (vd "Jul 6, 2026")
  if (/\d{4}/.test(s)) { const d = Date.parse(s); if (!Number.isNaN(d)) return new Date(d).toISOString().slice(0, 10) }
  return null
}

// Nhận diện thứ tự ngày từ cột: có phần-1 > 12 → DMY; phần-2 > 12 → MDY; toàn ≤12 → mơ hồ (mặc định DMY).
function detectDateOrder(rows: Row[], field: string | null): { order: 'DMY' | 'MDY'; ambiguous: boolean } {
  if (!field) return { order: 'DMY', ambiguous: false }
  let firstGt12 = false, secondGt12 = false, sawGen = false
  for (const r of rows) {
    const s = String(r[field] ?? '').trim()
    if (/^\d{4}[-./]/.test(s)) continue // ISO/year-first — không mơ hồ
    const m = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/)
    if (!m) continue
    sawGen = true
    if (+m[1] > 12) firstGt12 = true
    if (+m[2] > 12) secondGt12 = true
  }
  if (firstGt12) return { order: 'DMY', ambiguous: false }
  if (secondGt12) return { order: 'MDY', ambiguous: false }
  return { order: 'DMY', ambiguous: sawGen }
}

// Duyệt payload tìm mọi mảng object (>=3 dòng) kèm dot-path.
function findArrays(node: unknown, path: string, out: { path: string; arr: Row[] }[], depth = 0) {
  if (Array.isArray(node)) {
    if (node.length >= 3 && node.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      out.push({ path, arr: node as Row[] })
    }
    return
  }
  if (node && typeof node === 'object' && depth < 6) {
    for (const k of Object.keys(node as Row)) findArrays((node as Row)[k], path ? `${path}.${k}` : k, out, depth + 1)
  }
}

function pickDateField(rows: Row[]): string | null {
  const keys = Object.keys(rows[0] ?? {})
  let best: string | null = null, bestScore = -1
  for (const k of keys) {
    const rate = rows.filter((r) => isDateLike(r[k])).length / rows.length
    if (rate < 0.6) continue
    // Thưởng cột có tên gợi ý ngày (vd "Created date") → tránh chọn nhầm "Rent date".
    const nameBonus = /date|created|ng[aà]y|day/i.test(k) ? 0.5 : 0
    const score = rate + nameBonus
    if (score > bestScore) { bestScore = score; best = k }
  }
  return best
}
// Đoán tiền tệ từ ký hiệu trong ô doanh thu (khi không có cột currency riêng).
function symbolCurrency(rows: Row[], field: string | null): string {
  if (!field) return ''
  const s = rows.map((r) => String(r[field] ?? '')).join(' ')
  if (/€|eur/i.test(s)) return 'EUR'
  if (/\$|usd/i.test(s)) return 'USD'
  if (/₫|đ|vnd/i.test(s)) return 'VND'
  if (/£|gbp/i.test(s)) return 'GBP'
  return ''
}
const REV_NAME = /comm?iss?ion|revenue|amount|earn|payout|profit|bonus|income|hoa\s*h[oôơ]ng|doanh\s*thu|thu\s*nh[aậ]p/i
const ID_NAME = /^id$|order|number|mã|s[oố]\b|invoice|txn|transaction/i
const MONEY_SYM = /[€$₫£]|eur|usd|vnd|gbp/i
// Domain tracker/support — bỏ khỏi ứng viên (nhiễu, không phải dữ liệu doanh thu).
const TRACKER_HOST = /intercom\.io|sentry\.io|nr-data\.net|yandex|google-analytics|googletagmanager|doubleclick|facebook|hotjar|segment\.(io|com)|mixpanel|amplitude|clarity\.ms|cloudflareinsights|analytics|gstatic|gtag/i
function isTrackerUrl(url: string): boolean {
  try { return TRACKER_HOST.test(new URL(url).host) } catch { return false }
}

function pickRevenueField(rows: Row[], dateField: string | null): string | null {
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== dateField)
  // Cột "số": phần lớn giá trị parse ra số (0.6 — chừa dòng tổng/header lẫn trong bảng).
  const numeric = keys.filter((k) => rows.filter((r) => toNum(r[k]) !== null).length / rows.length >= 0.6)
  if (numeric.length === 0) return null

  const frac = (k: string) => rows.filter((r) => /\d\.\d/.test(String(r[k] ?? ''))).length / rows.length
  const hasSym = (k: string) => rows.some((r) => MONEY_SYM.test(String(r[k] ?? '')))
  const looksId = (k: string) => ID_NAME.test(k) ||
    // toàn số nguyên, không ký hiệu tiền, không thập phân → giống ID
    (!hasSym(k) && frac(k) < 0.1 && rows.every((r) => { const v = String(r[k] ?? '').trim(); return v === '' || /^\d+$/.test(v.replace(/[^0-9]/g, '')) && !/\./.test(v) }))

  const score = (k: string) => {
    if (looksId(k)) return -1
    let s = 0
    if (hasSym(k)) s += 100          // có ký hiệu tiền → chắc chắn nhất
    if (REV_NAME.test(k)) s += 50    // tên gợi ý doanh thu (bắt cả "Comission")
    if (frac(k) >= 0.5) s += 20      // có phần thập phân
    return s
  }
  const ranked = numeric.map((k) => ({ k, s: score(k) })).sort((a, b) => b.s - a.s)
  const top = ranked[0]
  if (top && top.s > 0) return top.k
  // Không cột nào rõ là tiền → lấy tổng lớn nhất trong các cột KHÔNG phải ID.
  const nonId = numeric.filter((k) => !looksId(k))
  if (nonId.length === 0) return null
  return nonId.sort((a, b) =>
    rows.reduce((s, r) => s + Math.abs(toNum(r[b]) ?? 0), 0) - rows.reduce((s, r) => s + Math.abs(toNum(r[a]) ?? 0), 0)
  )[0]
}
function pickCurrencyField(rows: Row[]): string | null {
  return Object.keys(rows[0] ?? {}).find((k) => /^currency$|^cur$|currency/i.test(k)) ?? null
}

// Mô tả gọn hình dạng JSON (để chẩn đoán khi auto-detect không ra bảng).
function shape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return `[${value.length}]${value.length ? ` of ${shape(value[0], depth + 1)}` : ''}`
  if (value && typeof value === 'object') {
    if (depth > 2) return '{…}'
    const keys = Object.keys(value as Row).slice(0, 12)
    return `{ ${keys.map((k) => `${k}: ${shape((value as Row)[k], depth + 1)}`).join(', ')} }`
  }
  if (typeof value === 'string') return `"${value.slice(0, 24)}"`
  return String(value)
}

export async function POST(req: Request) {
  const caller = await getCallerProfile(req)
  if (!caller || !ALLOWED.includes(caller.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const network_id = String(body?.network_id ?? '').trim()
  if (!network_id) return NextResponse.json({ error: 'Thiếu network_id' }, { status: 400 })

  const { data: disc } = await supabaseAdmin
    .from('engine_discoveries').select('captured, source_url, created_at')
    .eq('network_id', network_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!disc?.captured) return NextResponse.json({ error: 'Chưa có dữ liệu dò. Bấm "Cấu hình tự động" và đăng nhập trước.' }, { status: 404 })
  // source_url: trang đã dò (payout) khác dashboard → report.url = url này; NULL → giữ {base}.
  const sourceUrl = (disc as { source_url?: string | null }).source_url || null

  const captured = disc.captured as { url: string; payload: unknown; kind?: string; table_index?: number }[]

  // Gom mọi mảng ứng viên (kèm url + nguồn: xhr | table).
  const candidates: { url: string; path: string; arr: Row[]; kind: string; table_index: number | null }[] = []
  for (const cap of captured) {
    if (isTrackerUrl(cap.url)) continue // bỏ nhiễu tracker/support (bảng DOM host dashboard nên không dính)
    const found: { path: string; arr: Row[] }[] = []
    findArrays(cap.payload, '', found)
    for (const f of found) candidates.push({ url: cap.url, ...f, kind: cap.kind ?? 'xhr', table_index: cap.table_index ?? null })
  }
  if (candidates.length === 0) {
    // Không tự nhận ra bảng → trả danh sách đã bắt để chẩn đoán (không để panel trống).
    return NextResponse.json({
      noAuto: true,
      draft: null,
      preview: [],
      fields: [],
      chosen: null,
      candidates: [],
      capturedSummary: captured.slice(0, 40).map((c) => ({ url: c.url, shape: shape(c.payload) })),
    })
  }

  // Override từ user (nếu có)
  const ov = body?.override ?? {}
  // Chọn candidate: ưu tiên có date field + revenue field, rồi nhiều dòng nhất.
  const scored = candidates.map((c) => {
    const dateField = pickDateField(c.arr)
    const revenueField = pickRevenueField(c.arr, dateField)
    // +0.5 nếu cột doanh thu có ký hiệu tiền → nguồn "tiền thật" thắng nguồn số đếm.
    const revHasSym = !!revenueField && MONEY_SYM.test(c.arr.map((r) => String(r[revenueField] ?? '')).join(' '))
    return { ...c, dateField, revenueField, score: (dateField ? 2 : 0) + (revenueField ? 2 : 0) + (revHasSym ? 0.5 : 0) + Math.min(c.arr.length, 100) / 100 }
  }).sort((a, b) => b.score - a.score)

  let chosen = scored[0]
  if (ov.url && ov.rows_path !== undefined) {
    const match = candidates.find((c) => c.url === ov.url && c.path === ov.rows_path)
    if (match) chosen = { ...match, dateField: pickDateField(match.arr), revenueField: pickRevenueField(match.arr, null), score: 0 }
  }

  const rows = chosen.arr
  const dateField = ov.date_field ?? chosen.dateField
  const revenueField = ov.revenue_field ?? chosen.revenueField
  const currencyField = ov.currency_field ?? pickCurrencyField(rows)
  const fields = Object.keys(rows[0] ?? {})

  // url_pattern: pathname của response (ổn định; user có thể chỉnh).
  let urlPattern = chosen.url
  try { urlPattern = new URL(chosen.url).pathname } catch {}

  // Preview: gộp doanh thu theo ngày (parse tiền + thứ tự ngày theo định dạng đã nhận diện).
  const numFmt = numFormat(rows, revenueField)
  const dateInfo = detectDateOrder(rows, dateField)
  const byDate = new Map<string, number>()
  let datedRows = 0 // số dòng có ngày hợp lệ → so với số ngày distinct để biết mức-đơn hay day-total
  if (dateField && revenueField) {
    for (const r of rows) {
      const d = normDate(r[dateField], dateInfo.order); const rev = parseMoney(r[revenueField], numFmt)
      if (d) datedRows++
      if (d && rev !== null) byDate.set(d, (byDate.get(d) ?? 0) + rev)
    }
  }
  const preview = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, revenue]) => ({ date, revenue }))

  const currencyGuess = (currencyField
    ? String((rows.find((r) => r[currencyField]) ?? {})[currencyField] ?? '')
    : symbolCurrency(rows, revenueField)
  ).trim()

  const draft = {
    network_id,
    network_name: network_id,
    enabled: true,
    window_days: 30,
    timezone: 'Asia/Ho_Chi_Minh',
    sync_pnl: true,
    project_mapping: {},
    fx_to_usd: 1,
    fx_auto_from: currencyGuess && currencyGuess.toUpperCase() !== 'USD' ? currencyGuess.toUpperCase() : null,
    login_check: { logged_out_url_patterns: ['/login', '/signin', '/auth', '/sign-in'], logged_out_selectors: ["input[type='password']"] },
    login_url: '{base}',
    reports: [{
      // Tên phân biệt theo loại (đỡ trùng khi 1 network có cả 2 nguồn); engine khớp theo INDEX.
      name: ov.revenue_type === 'confirmed' ? 'payout' : 'revenue',
      // Trang nguồn: {base} (dashboard) mặc định; source_url (payout) nếu dò trang chỉ định.
      url: sourceUrl ?? '{base}',
      url_date_format: 'YYYY-MM-DD',
      ...(chosen.kind === 'table'
        ? { mode: 'html_table', table_index: chosen.table_index ?? 0 }
        : { capture: { url_pattern: urlPattern, pattern_type: 'substring' } }),
      wait: { strategy: 'networkidle', navigation_timeout_ms: 60000, post_load_wait_ms: 5000, capture_settle_ms: 4000 },
      rows_path: chosen.path,
      mapping: {
        // KHÔNG để 'iso' đầu: dayjs parse lỏng "06.07.2026" thành MM.DD (7 June) trước
        // khi tới DD.MM.YYYY. Ưu tiên ISO strict rồi ngày-trước (kiểu châu Âu).
        date: { path: dateField, order: dateInfo.order, formats: ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss', 'DD.MM.YYYY', 'D.M.YYYY', 'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'] },
        offer_id: { path: '__const__', required: false, default: '' },
        // offer_name RIÊNG cho confirmed (payout) để khoá revenue_raw không đụng report pending.
        offer_name: { path: '__const__', required: false, default: ov.revenue_type === 'confirmed' ? 'payout' : network_id },
        revenue: { path: revenueField, divisor: 1, decimal_separator: numFmt.decimal, thousands_separator: numFmt.thousands },
        currency: currencyField ? { path: currencyField, required: false, default: currencyGuess || 'USD' } : { path: '__const__', required: false, default: currencyGuess || 'USD' },
      },
      // offer_id/offer_name là hằng số → khoá gộp = 1 dòng/ngày. Vì preview LUÔN cộng mọi
      // dòng theo ngày, engine phải 'sum' để khớp (preview = engine) KHI dữ liệu mức-đơn
      // (nhiều dòng/ngày). Chỉ nguồn day-total (~1 dòng/ngày) mới để 'last' (đề phòng
      // pagination lặp dòng tổng). Bảng HTML luôn mức-đơn → 'sum'.
      duplicate_strategy: chosen.kind === 'table' || datedRows > byDate.size * 1.2 ? 'sum' : 'last',
      // Loại doanh thu ghi vào P&L: 'pending' (tiền màn hình) | 'confirmed' (thực nhận/payout).
      revenue_type: ov.revenue_type === 'confirmed' ? 'confirmed' : 'pending',
      validation: { min_mapped_rows: 1, max_invalid_row_ratio: 0.2 },
    }],
  }

  // Cảnh báo độ tin thấp — nhắc user kiểm tra trước khi lưu.
  const warnings: string[] = []
  if (scored.filter((c) => c.dateField && c.revenueField).length >= 2)
    warnings.push('Có nhiều nguồn hợp lệ (ngày + tiền) — kiểm tra chọn đúng bảng ở "Nguồn".')
  if (!currencyGuess)
    warnings.push('Không nhận ra tiền tệ — tạm dùng USD. Kiểm tra/đổi ở "Field tiền tệ".')
  if (dateInfo.ambiguous)
    warnings.push('Ngày dạng số/số/năm không rõ DD/MM hay MM/DD — đối chiếu preview với dashboard.')
  if (revenueField && !MONEY_SYM.test(rows.map((r) => String(r[revenueField] ?? '')).join(' ')) && !REV_NAME.test(revenueField))
    warnings.push('Cột doanh thu đoán theo giá trị lớn nhất — kiểm tra đúng cột.')

  return NextResponse.json({
    draft,
    preview,
    fields,
    warnings,
    chosen: { url: chosen.url, rows_path: chosen.path, date_field: dateField, revenue_field: revenueField, currency_field: currencyField },
    candidates: scored.map((c) => ({
      url: c.url, rows_path: c.path, rows: c.arr.length,
      hasDate: !!c.dateField, hasRevenue: !!c.revenueField,
      date_field: c.dateField, revenue_field: c.revenueField,
      currency: c.revenueField ? symbolCurrency(c.arr, c.revenueField) : '',
    })),
  })
}
