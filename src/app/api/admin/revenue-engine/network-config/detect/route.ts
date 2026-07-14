import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getCallerProfile } from '@/lib/require-role'
import { normalizeCountry, normalizeDevice, extractCountryFromText, extractDeviceFromText } from '@/lib/normalize-geo'

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
  // Ngày linh hoạt (./- + dấu cách): gán day/month theo order; năm 2 số → 20YY (vd "02.07.26").
  const gen = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/)
  if (gen) {
    const first = gen[1].padStart(2, '0'), second = gen[2].padStart(2, '0')
    const dd = order === 'MDY' ? second : first
    const mm = order === 'MDY' ? first : second
    const yyyy = gen[3].length === 2 ? `20${gen[3]}` : gen[3]
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`
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
// File tĩnh của website (manifest/favicon/ảnh/css/js/font...) — KHÔNG bao giờ là dữ liệu
// doanh thu. Đã từng nhận nhầm /assets/favicon/manifest.json (mảng icons có density/src)
// thành "report thiết bị" → ghi doanh thu giả. Chỉ áp cho nguồn XHR (bảng DOM dùng URL trang).
const STATIC_ASSET = /favicon|\.webmanifest|manifest\.json|\.(png|jpe?g|gif|svg|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|txt|xml)(\?|#|$)/i
function isStaticAssetUrl(url: string): boolean {
  try { const u = new URL(url); return STATIC_ASSET.test(u.pathname) } catch { return STATIC_ASSET.test(url) }
}

function pickRevenueField(rows: Row[], dateField: string | null): string | null {
  // Loại cột ngày (dateField + cột date-like khác, vd col_2 trùng "Created"): ngày parse ra
  // số khổng lồ (20260613102049) dễ bị nhầm là doanh thu.
  const isDateCol = (k: string) => rows.filter((r) => isDateLike(r[k])).length / rows.length >= 0.6
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k !== dateField && !isDateCol(k))
  // Cột "số": phần lớn giá trị parse ra số (0.6 — chừa dòng tổng/header lẫn trong bảng).
  const numeric = keys.filter((k) => rows.filter((r) => toNum(r[k]) !== null).length / rows.length >= 0.6)
  if (numeric.length === 0) return null

  const frac = (k: string) => rows.filter((r) => /\d\.\d/.test(String(r[k] ?? ''))).length / rows.length
  const hasSym = (k: string) => rows.some((r) => MONEY_SYM.test(String(r[k] ?? '')))
  const looksId = (k: string) =>
    // Cột tên rõ là doanh thu (commission/amount/revenue…) KHÔNG bao giờ là ID — kể cả toàn số nguyên
    // (vd total_commission=640,4770 tính bằng cents) → tránh loại nhầm.
    !REV_NAME.test(k) && (ID_NAME.test(k) ||
      // toàn số nguyên, không ký hiệu tiền, không thập phân → giống ID
      (!hasSym(k) && frac(k) < 0.1 && rows.every((r) => { const v = String(r[k] ?? '').trim(); return v === '' || /^\d+$/.test(v.replace(/[^0-9]/g, '')) && !/\./.test(v) })))

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

// ── Auto-detect BREAKDOWN (quốc gia/thiết bị/giờ/sub-id) ─────────────────────
// Nhận diện cột dimension trong 1 mảng ứng viên — cho report kind='breakdown'
// (Engine ghi vào revenue_breakdown để Tối Ưu Camp join ROI theo segment).

// link_value/sub_value: nhiều network affiliate (Tolt, Rewardful…) truyền sub-id qua link param.
const SUB_ID_NAME = /sub_?id|aff_?sub|^s[1-5]$|^sid\d?$|click_?id|custom\d?$|link_value|sub_?value/i
const TXN_NAME = /txn|transaction|conversion_?id|order_?id|^id$|uuid/i
const TIME_NAME = /time|created|_at$|^at$|date/i

interface BreakdownDims {
  country_field: string | null
  country_extract: boolean   // true = cột text hỗn hợp, trích tên nước nhúng (không phải cột mã sạch)
  device_field: string | null
  device_extract: boolean
  time_field: string | null
  time_formats: string[] | null
  sub_id_field: string | null
  txn_field: string | null
}

// skip = cột KHÔNG xét làm dimension (thường là date + revenue của report doanh thu).
// dateField được truyền RIÊNG: country/device/sub_id/txn vẫn bỏ qua nó, nhưng conversion_time
// ĐƯỢC xét cột ngày (suy giờ từ chính cột ngày — vd Tolt chỉ có created_at, không có cột giờ riêng).
function detectBreakdownDims(rows: Row[], skip: (string | null)[], dateField: string | null = null): BreakdownDims {
  const keys = Object.keys(rows[0] ?? {}).filter((k) => !skip.includes(k))
  // conversion_time xét thêm dateField (nếu dateField nằm trong skip).
  const timeKeys = dateField && !keys.includes(dateField) ? [dateField, ...keys] : keys
  const nonEmpty = (k: string) => rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')

  // country: ≥60% giá trị (không rỗng) chuẩn hóa được về alpha-2, ≥2 nước khác nhau.
  let country: string | null = null, countryScore = 0, countryExtract = false
  for (const k of keys) {
    const vals = nonEmpty(k)
    if (vals.length < Math.max(2, rows.length * 0.3)) continue
    const normed = vals.map((v) => normalizeCountry(v))
    const okRate = normed.filter(Boolean).length / vals.length
    if (okRate < 0.6) continue
    if (new Set(normed.filter(Boolean)).size < 2) continue // cột hằng ("US" toàn bảng) vẫn nhận? — cần ≥2 để chắc là cột geo
    const score = okRate + (/country|geo|nation|land|qu[oố]c\s*gia/i.test(k) ? 0.5 : 0)
    if (score > countryScore) { countryScore = score; country = k }
  }
  // Fallback TRÍCH: cột sạch trượt → thử tên nước NHÚNG trong text hỗn hợp (vd Meta Data
  // "Warsaw, Poland desktop") — ≥60% dòng trích được nước + ≥2 nước distinct.
  if (!country) {
    for (const k of keys) {
      const vals = nonEmpty(k)
      if (vals.length < Math.max(2, rows.length * 0.3)) continue
      const ex = vals.map((v) => extractCountryFromText(v))
      const okRate = ex.filter(Boolean).length / vals.length
      if (okRate < 0.6 || new Set(ex.filter(Boolean)).size < 2) continue
      const score = okRate + (/country|geo|meta|location/i.test(k) ? 0.3 : 0)
      if (score > countryScore) { countryScore = score; country = k; countryExtract = true }
    }
  }

  // device: ≥60% giá trị chuẩn hóa vào mobile/desktop/tablet, ≤8 giá trị distinct.
  let device: string | null = null, deviceScore = 0, deviceExtract = false
  for (const k of keys) {
    if (k === country && !countryExtract) continue // cột country sạch không chứa device; cột trích hỗn hợp thì cho phép
    const vals = nonEmpty(k)
    if (vals.length < Math.max(2, rows.length * 0.3)) continue
    if (new Set(vals.map((v) => String(v).toLowerCase())).size > 8) continue
    const normed = vals.map((v) => normalizeDevice(v))
    const okRate = normed.filter((d) => d === 'mobile' || d === 'desktop' || d === 'tablet').length / vals.length
    if (okRate < 0.6) continue
    const score = okRate + (/device|platform|^os$|user_?agent/i.test(k) ? 0.5 : 0)
    if (score > deviceScore) { deviceScore = score; device = k }
  }
  // Fallback TRÍCH thiết bị nhúng trong text (vd Meta Data "...desktop, ENG"). Cho phép cùng cột country trích.
  if (!device) {
    for (const k of keys) {
      const vals = nonEmpty(k)
      if (vals.length < Math.max(2, rows.length * 0.3)) continue
      const ex = vals.map((v) => extractDeviceFromText(v))
      const okRate = ex.filter(Boolean).length / vals.length
      if (okRate < 0.6) continue
      const score = okRate + (/device|platform|meta|user_?agent/i.test(k) ? 0.3 : 0)
      if (score > deviceScore) { deviceScore = score; device = k; deviceExtract = true }
    }
  }

  // conversion_time: chuỗi ngày CÓ GIỜ (hh:mm / ISO T) hoặc epoch (10/13 chữ số) tên gợi ý time.
  let time: string | null = null, timeFormats: string[] | null = null, timeScore = 0
  for (const k of timeKeys) {
    const vals = nonEmpty(k).map((v) => String(v).trim())
    if (vals.length < Math.max(2, rows.length * 0.3)) continue
    const strTime = vals.filter((s) => /\d{1,2}:\d{2}/.test(s) && isDateLike(s)).length / vals.length
    const unixSec = vals.filter((s) => /^\d{10}$/.test(s)).length / vals.length
    const unixMs = vals.filter((s) => /^\d{13}$/.test(s)).length / vals.length
    let fmts: string[] | null = null
    let rate = 0
    if (strTime >= 0.6) { fmts = ['iso', 'YYYY-MM-DD HH:mm:ss']; rate = strTime }
    else if (unixSec >= 0.6 && TIME_NAME.test(k)) { fmts = ['unix']; rate = unixSec }
    else if (unixMs >= 0.6 && TIME_NAME.test(k)) { fmts = ['unix_ms']; rate = unixMs }
    if (!fmts) continue
    const score = rate + (TIME_NAME.test(k) ? 0.5 : 0)
    if (score > timeScore) { timeScore = score; time = k; timeFormats = fmts }
  }

  // sub_id: theo TÊN cột (giá trị có thể còn rỗng khi user chưa truyền sub-id — vẫn map sẵn).
  const subId = keys.find((k) => SUB_ID_NAME.test(k)) ?? null

  // transaction_id: tên gợi ý + ≥90% giá trị distinct (ID duy nhất mỗi chuyển đổi).
  let txn: string | null = null
  for (const k of keys) {
    if (!TXN_NAME.test(k) || k === subId) continue
    const vals = nonEmpty(k).map((v) => String(v))
    if (vals.length >= 3 && new Set(vals).size / vals.length >= 0.9) { txn = k; break }
  }

  return { country_field: country, country_extract: countryExtract, device_field: device, device_extract: deviceExtract, time_field: time, time_formats: timeFormats, sub_id_field: subId, txn_field: txn }
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
  // Nguồn cần phân tích: mỗi thẻ (Tiền màn hình/Thực nhận) đọc ĐÚNG bản dò của mình theo source_url.
  const reqSourceUrl: string | null = body?.source_url ? String(body.source_url).trim() : null
  const reqRevenueType: 'pending' | 'confirmed' | undefined =
    body?.revenue_type === 'confirmed' || body?.revenue_type === 'pending' ? body.revenue_type : undefined
  // Thẻ có "Bấm trước khi đọc" (action) → nguồn nằm sau 1 cú click (vd tab "Payment history").
  const hasAction = !!body?.has_action

  // Chọn bản dò khớp nguồn: có source_url → khớp đúng; không → bản dò dashboard (source_url NULL).
  // Cùng source_url có thể có 2 bản dò (pending không click / confirmed có click) → tách theo `actions`:
  // thẻ có action lấy bản dò CÓ actions; thẻ không action lấy bản KHÔNG actions. Fallback: mới nhất.
  let q = supabaseAdmin
    .from('engine_discoveries').select('captured, source_url, created_at, actions')
    .eq('network_id', network_id)
  q = reqSourceUrl ? q.eq('source_url', reqSourceUrl) : q.is('source_url', null)
  const { data: discs } = await q.order('created_at', { ascending: false }).limit(5)
  const discRows = (discs ?? []) as { captured?: unknown; source_url?: string | null; actions?: unknown[] | null }[]
  const discHasActions = (d: { actions?: unknown[] | null }) => Array.isArray(d.actions) && d.actions.length > 0
  const disc =
    discRows.find((d) => (hasAction ? discHasActions(d) : !discHasActions(d))) ?? discRows[0]
  if (!disc?.captured) return NextResponse.json({ needDiscover: true, error: 'Chưa có dữ liệu dò cho nguồn này.' }, { status: 404 })
  const sourceUrl = reqSourceUrl ?? (disc.source_url || null)

  // Divisor từ report DOANH THU đã lưu (map theo tên cột revenue) — để report breakdown kế thừa
  // đúng đơn vị. VD Tolt total_commission là CENTS, report doanh thu đã đặt divisor=100; breakdown
  // đọc cùng total_commission phải chia 100 (không detect route nào tự biết cents từ integer trần).
  const { data: existingCfg } = await supabaseAdmin
    .from('engine_network_configs').select('config').eq('network_id', network_id).maybeSingle()
  const revenueDivisorByField = new Map<string, number>()
  for (const r of (existingCfg?.config?.reports ?? []) as { kind?: string; mapping?: { revenue?: { path?: string; divisor?: number } } }[]) {
    if (r.kind === 'breakdown') continue
    const path = r.mapping?.revenue?.path
    const div = Number(r.mapping?.revenue?.divisor)
    if (path && div > 0 && !revenueDivisorByField.has(path)) revenueDivisorByField.set(path, div)
  }

  // page_url: TRANG chứa nguồn (auto-scan quét nhiều trang trong 1 lần dò) — null với trang
  // gốc/dashboard (giữ semantics '{base}') và với bản dò cũ (trước khi có auto-scan).
  // via_tab: tab con (Location/Device...) mà auto-scan click để hiện dataset này — detect gắn
  // vào report.actions để sync tự click lại tab đó. req_url: URL request đầy đủ (kèm query
  // page/page_size) — dùng để lấy ĐỦ dữ liệu phân trang (vd customers) qua goto trực tiếp.
  const captured = disc.captured as { url: string; page_url?: string | null; via_tab?: string | null; req_url?: string | null; payload: unknown; kind?: string; table_index?: number; visible?: boolean }[]

  // Gom mọi mảng ứng viên (kèm url + nguồn: xhr | table).
  const candidates: { url: string; page_url: string | null; via_tab: string | null; req_url: string | null; path: string; arr: Row[]; kind: string; table_index: number | null; headers?: string[]; visible?: boolean }[] = []
  for (const cap of captured) {
    if (isTrackerUrl(cap.url)) continue // bỏ nhiễu tracker/support (bảng DOM host dashboard nên không dính)
    if ((cap.kind ?? 'xhr') !== 'table' && isStaticAssetUrl(cap.url)) continue // bỏ file tĩnh (manifest/favicon/js...)
    const found: { path: string; arr: Row[] }[] = []
    findArrays(cap.payload, '', found)
    // Bảng HTML: mang header theo mọi candidate để dựng nhãn cột (col_N → tên header) khi map.
    const capHeaders = cap.kind === 'table' ? (cap.payload as { headers?: string[] } | null)?.headers : undefined
    // visible: bảng đang hiển thị (tab bị ẩn → false) — ưu tiên khi thẻ có action click.
    const capVisible = cap.kind === 'table' ? cap.visible !== false : undefined
    for (const f of found) candidates.push({ url: cap.url, page_url: cap.page_url ?? null, via_tab: cap.via_tab ?? null, req_url: cap.req_url ?? null, ...f, kind: cap.kind ?? 'xhr', table_index: cap.table_index ?? null, headers: Array.isArray(capHeaders) ? capHeaders : undefined, visible: capVisible })
    // Bảng DOM RỖNG (0 dòng) nhưng có header → vẫn cho cấu hình theo tên cột (vd trang payout chưa có khoản nào).
    const tablePayload = cap.payload as { rows?: unknown[]; headers?: string[] } | null
    if (cap.kind === 'table' && found.length === 0 && Array.isArray(tablePayload?.headers) && tablePayload!.headers.length >= 2) {
      candidates.push({ url: cap.url, page_url: cap.page_url ?? null, via_tab: cap.via_tab ?? null, req_url: cap.req_url ?? null, path: 'rows', arr: [], kind: 'table', table_index: cap.table_index ?? null, headers: tablePayload!.headers, visible: capVisible })
    }
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
    // Doanh thu ĐÁNG TIN = có ký hiệu tiền HOẶC tên gợi ý doanh thu (amount/commission/payout…).
    // Trọng số +2 (mạnh) để nguồn "tiền thật" ($203) thắng nguồn "số đếm" (vd push/list 100 dòng,
    // field 'text'/'counter') dù nguồn nhiễu nhiều dòng hơn.
    const revHasSym = !!revenueField && MONEY_SYM.test(c.arr.map((r) => String(r[revenueField] ?? '')).join(' '))
    const revConfident = !!revenueField && (revHasSym || REV_NAME.test(revenueField))
    // +1 nếu XHR có doanh thu đáng tin (dữ liệu cấu trúc, bắt ổn định lúc sync) — bảng DOM dễ vỡ.
    const xhrBonus = c.kind === 'xhr' && revConfident ? 1 : 0
    // Nguồn doanh thu (time-series/ledger) LUÔN có cột ngày. Không có ngày → gần như chắc chắn
    // là mảng rác/config (vd form fields "question") → điểm rất thấp, không thể thắng nguồn có ngày.
    const score = dateField
      ? 3 + (revenueField ? 2 : 0) + (revConfident ? 2 : 0) + xhrBonus + Math.min(c.arr.length, 100) / 100
      : (revenueField ? 0.5 : 0.1) + Math.min(c.arr.length, 100) / 1000
    return { ...c, dateField, revenueField, score }
  }).sort((a, b) => b.score - a.score)

  // Nguồn DÙNG ĐƯỢC = có cột ngày HOẶC bảng rỗng-có-header (map tay). Nếu toàn rác không-ngày
  // (vd trang chỉ có form config) và user chưa tự chọn → báo "chưa nhận ra", KHÔNG auto lấy rác.
  let usable = scored.filter((c) => c.dateField || c.arr.length === 0)
  // Thẻ có action (vd click "Payment history"): nguồn đúng là BẢNG ĐANG HIỂN THỊ sau click (tab kia bị ẩn).
  // Giới hạn vào bảng visible để bảng payout (kể cả RỖNG 0 dòng) thắng bảng Commission "nhiều dữ liệu".
  if (hasAction) {
    const vis = usable.filter((c) => c.kind === 'table' && c.visible === true)
    if (vis.length) usable = vis
  }
  const hasOverride = ov.rows_path !== undefined && ov.rows_path !== null
  if (usable.length === 0 && !hasOverride) {
    return NextResponse.json({
      noAuto: true, draft: null, preview: [], fields: [], chosen: null, candidates: [],
      capturedSummary: captured.slice(0, 40).map((c) => ({ url: c.url, shape: shape(c.payload) })),
    })
  }

  let chosen = usable[0] ?? scored[0]
  // Khớp nguồn theo override. Nhiều candidate có thể CÙNG rows_path (vd 'data' của cả purchase
  // XHR lẫn push/list) → phải định danh chính xác: url đầy đủ (đổi thủ công) → url_pattern (reload
  // XHR) → table_index (reload bảng) → cuối cùng mới lấy phần tử đầu cùng path.
  if (ov.rows_path !== undefined && ov.rows_path !== null) {
    const byPath = candidates.filter((c) => c.path === ov.rows_path)
    const match =
      (ov.url ? byPath.find((c) => c.url === ov.url) : undefined)
      ?? (ov.url_pattern ? byPath.find((c) => c.url.includes(String(ov.url_pattern))) : undefined)
      ?? (ov.table_index !== undefined && ov.table_index !== null ? byPath.find((c) => c.table_index === ov.table_index) : undefined)
      ?? byPath[0]
    if (match) { const df = pickDateField(match.arr); chosen = { ...match, dateField: df, revenueField: pickRevenueField(match.arr, df), score: 0 } }
  }

  const rows = chosen.arr
  // Bảng HTML lưu mỗi cột 2 key (col_N + tên header). Dựng nhãn (col_N → header) cho dropdown dễ đọc,
  // và map ngược (header → col_N) để chuẩn hoá field đoán về col_N (path mapping ổn định, tránh dấu chấm/ký tự lạ).
  const tblHeaders = chosen.kind === 'table' ? (chosen.headers ?? []) : []
  const fieldLabels: Record<string, string> = {}
  const headerToCol: Record<string, string> = {}
  tblHeaders.forEach((h, i) => {
    if (!h) return
    fieldLabels[`col_${i}`] = h
    if (!(h in headerToCol)) headerToCol[h] = `col_${i}`
  })
  const toColKey = (f: string | null | undefined) => (f && headerToCol[f]) || f || null
  let dateField = toColKey(ov.date_field ?? chosen.dateField)
  let revenueField = toColKey(ov.revenue_field ?? chosen.revenueField)
  const currencyField = toColKey(ov.currency_field ?? pickCurrencyField(rows))
  // Bảng RỖNG (0 dòng, vd payout chưa có khoản): KHÔNG có giá trị để đoán cột theo dữ liệu → đoán
  // theo TÊN HEADER để user khỏi phải chọn tay (khi có dữ liệu sẽ map đúng). Chỉ đoán khi còn trống.
  if (rows.length === 0 && tblHeaders.length) {
    const byName = (re: RegExp) => { const i = tblHeaders.findIndex((h) => re.test(h || '')); return i >= 0 ? `col_${i}` : null }
    if (!dateField) dateField = byName(/date|created|ng[aà]y|day|time/i)
    if (!revenueField) revenueField = byName(REV_NAME)
  }
  // Chia giá trị (vd 100 nếu doanh thu là cents) — áp cả preview lẫn draft để preview = engine.
  const divisor = Number(ov.divisor) > 0 ? Number(ov.divisor) : 1
  // Danh sách cột cho dropdown. Bảng HTML → chỉ giữ col_N (bỏ key tên-header trùng), nhãn lấy từ fieldLabels;
  // bảng rỗng (0 dòng) → sinh col_N từ header để map tay nhất quán. Nguồn XHR/JSON → giữ nguyên key.
  const headerSet = new Set(tblHeaders.filter(Boolean))
  const fields = chosen.kind === 'table'
    ? (rows.length ? Object.keys(rows[0]).filter((k) => !headerSet.has(k)) : tblHeaders.map((_, i) => `col_${i}`))
    : (rows.length ? Object.keys(rows[0]) : (chosen.headers ?? []))

  // url_pattern: mặc định = pathname (ổn định qua các lần sync đổi ngày). NHƯNG nếu NHIỀU response cùng
  // pathname (vd Tolt: /reports-chart?chart=commissions vs ?chart=clicks) → pathname khớp NHẦM nhiều dataset
  // khác schema → thêm 1 token query phân biệt (bỏ param NGÀY vì đổi mỗi lần sync) để khớp đúng 1 nguồn.
  const DATE_KEYS = new Set(['date', 'date_from', 'date_to', 'from', 'to', 'start', 'end', 'start_date', 'end_date', 'since', 'until', 'period', 'day', 'month', 'year', 'timestamp', 'ts', 'time'])
  const patternFor = (capUrl: string): string => {
    try {
      const u = new URL(capUrl)
      let p = u.pathname
      const samePath = captured.filter((c) => { try { return new URL(c.url).pathname === u.pathname } catch { return false } })
      if (samePath.length > 1 && u.search) {
        const distinct = [...u.searchParams.entries()].find(([k, v]) => v && !DATE_KEYS.has(k.toLowerCase()) && !/^\d+$/.test(v))
        if (distinct) p = `${distinct[0]}=${distinct[1]}` // vd chart=commissions-chart
      }
      return p
    } catch { return capUrl }
  }
  const urlPattern = patternFor(chosen.url)

  // Preview: gộp doanh thu theo ngày (parse tiền + thứ tự ngày theo định dạng đã nhận diện).
  const numFmt = numFormat(rows, revenueField)
  const dateInfo = detectDateOrder(rows, dateField)
  const byDate = new Map<string, number>()
  let datedRows = 0 // số dòng có ngày hợp lệ → so với số ngày distinct để biết mức-đơn hay day-total
  if (dateField && revenueField) {
    for (const r of rows) {
      const d = normDate(r[dateField], dateInfo.order); const rev = parseMoney(r[revenueField], numFmt)
      if (d) datedRows++
      if (d && rev !== null) byDate.set(d, (byDate.get(d) ?? 0) + rev / divisor)
    }
  }
  const preview = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, revenue]) => ({ date, revenue }))

  const currencyGuess = (currencyField
    ? String((rows.find((r) => r[currencyField]) ?? {})[currencyField] ?? '')
    : symbolCurrency(rows, revenueField)
  ).trim()

  // Loại doanh thu hiệu lực: theo override; nếu chưa override → suy từ nguồn đã dò
  // (dò trang chỉ định = Payout → 'confirmed'; dò dashboard → 'pending').
  // Loại: ưu tiên loại của THẺ gọi (reqRevenueType), rồi override field, rồi suy từ nguồn.
  const rt: 'pending' | 'confirmed' =
    reqRevenueType
      ?? (ov.revenue_type === 'confirmed' || ov.revenue_type === 'pending' ? ov.revenue_type : (sourceUrl ? 'confirmed' : 'pending'))

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
      name: rt === 'confirmed' ? 'payout' : 'revenue',
      // Trang nguồn: page_url (trang auto-scan ghé được / user tự điều hướng đến) →
      // source_url (dò trang chỉ định) → '{base}' (dashboard). Bản dò cũ không có
      // page_url → null → hành vi y hệt trước.
      url: chosen.page_url ?? sourceUrl ?? '{base}',
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
        offer_name: { path: '__const__', required: false, default: rt === 'confirmed' ? 'payout' : network_id },
        revenue: { path: revenueField, divisor, decimal_separator: numFmt.decimal, thousands_separator: numFmt.thousands },
        currency: currencyField ? { path: currencyField, required: false, default: currencyGuess || 'USD' } : { path: '__const__', required: false, default: currencyGuess || 'USD' },
      },
      // offer_id/offer_name là hằng số → khoá gộp = 1 dòng/ngày. Vì preview LUÔN cộng mọi
      // dòng theo ngày, engine phải 'sum' để khớp (preview = engine) KHI dữ liệu mức-đơn
      // (nhiều dòng/ngày). Chỉ nguồn day-total (~1 dòng/ngày) mới để 'last' (đề phòng
      // pagination lặp dòng tổng). Bảng HTML luôn mức-đơn → 'sum'.
      duplicate_strategy: chosen.kind === 'table' || datedRows > byDate.size * 1.2 ? 'sum' : 'last',
      // Loại doanh thu ghi vào P&L: 'pending' (tiền màn hình) | 'confirmed' (thực nhận/payout).
      revenue_type: rt,
      // Nguồn cấu hình lúc RỖNG (0 dòng) → min_mapped_rows=0: sync 0 dòng vẫn hợp lệ, có dữ liệu tự map.
      validation: { min_mapped_rows: rows.length === 0 ? 0 : 1, max_invalid_row_ratio: 0.2 },
    }],
  }

  // ── Auto-detect report BREAKDOWN (quốc gia/thiết bị/giờ/sub-id) ────────────
  // Quét MỌI ứng viên (không chỉ nguồn doanh thu đã chọn): nguồn có revenue + (ngày hoặc
  // timestamp) + ≥1 dimension → sinh sẵn draft report kind='breakdown' để wizard thêm 1-click.
  // Nhãn trang từ page_url ('/reports/conversions') — hiển thị nguồn nằm ở TRANG nào.
  const pageLabel = (pu: string | null | undefined): string | null => {
    if (!pu) return null
    try {
      const u = new URL(pu)
      return u.pathname + u.hash
    } catch { return null }
  }

  interface BdReport {
    name: string
    detected: boolean
    source: { url: string; rows_path: string; rows: number; page: string | null; via_tab: string | null }
    dims: { country: string | null; device: string | null; time: string | null; sub_id: string | null; transaction_id: string | null }
    preview: { country: string; revenue: number }[]
    draft_report: Record<string, unknown>
  }
  type BdCand = (typeof scored)[number] & { dims: BreakdownDims; dimCount: number }

  // Dựng 1 report breakdown từ 1 candidate (đã có dims). name phân biệt để PUT merge giữ
  // nhiều report (breakdown_geo/breakdown_device/breakdown) cùng lúc, không đè nhau.
  const buildBreakdownReport = (c: BdCand, name: string): BdReport => {
    const dims = c.dims
    const bdNumFmt = numFormat(c.arr, c.revenueField)
    const bdDateInfo = detectDateOrder(c.arr, c.dateField)
    // divisor: ưu tiên kế thừa từ report DOANH THU đã lưu cùng tên cột (chuẩn nhất — biết cents);
    // rồi tới report doanh thu đang detect nếu cùng cột; cuối cùng 1 (bảng HTML có ký hiệu tiền → đơn vị chính).
    const inheritedDiv = c.revenueField ? revenueDivisorByField.get(c.revenueField) : undefined
    const bdDivisor = inheritedDiv
      ?? (((c.url === chosen.url && c.path === chosen.path) || c.revenueField === revenueField) ? divisor : 1)
    let bdDated = 0
    const bdDates = new Set<string>()
    if (c.dateField) {
      for (const r of c.arr) { const d = normDate(r[c.dateField!], bdDateInfo.order); if (d) { bdDated++; bdDates.add(d) } }
    }
    const perConversion = !!dims.txn_field || !!dims.time_field || bdDated > bdDates.size * 1.2
    // Nguồn tổng-theo-kỳ: không có cột ngày lẫn timestamp → engine gán ngày = cuối cửa sổ sync.
    const isSnapshot = !c.dateField && !dims.time_field
    const byCountry = new Map<string, number>()
    if (dims.country_field) {
      for (const r of c.arr) {
        const cc = dims.country_extract ? extractCountryFromText(r[dims.country_field]) : normalizeCountry(r[dims.country_field])
        const rev = parseMoney(r[c.revenueField!], bdNumFmt)
        if (cc && rev !== null) byCountry.set(cc, (byCountry.get(cc) ?? 0) + rev / bdDivisor)
      }
    }
    const bdPreview = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([country, revenue]) => ({ country, revenue: Math.round(revenue * 100) / 100 }))
    const bdCurrencyField = pickCurrencyField(c.arr)

    // Nguồn PHÂN TRANG (req_url có page & page_size, vd customers page_size=10): dùng URL API
    // TRỰC TIẾP với page_size lớn + token {page}, engine lật trang lấy ĐỦ (thay vì chỉ trang SPA
    // đầu). Chỉ áp cho XHR có sẵn cấu trúc phân trang trong query.
    let paginatedUrl: string | null = null
    if (c.kind !== 'table' && c.req_url) {
      try {
        const u = new URL(c.req_url)
        if (u.searchParams.has('page') && u.searchParams.has('page_size')) {
          const ps = Number(u.searchParams.get('page_size')) || 0
          u.searchParams.set('page_size', String(ps >= 50 ? ps : 50))
          u.searchParams.set('page', '{page}')
          paginatedUrl = decodeURIComponent(u.toString()) // {page} không bị encode
        }
      } catch { /* req_url không parse được → bỏ qua */ }
    }

    return {
      name,
      detected: true,
      source: { url: c.url, rows_path: c.path, rows: c.arr.length, page: pageLabel(c.page_url), via_tab: c.via_tab },
      dims: {
        country: dims.country_field, device: dims.device_field, time: dims.time_field,
        sub_id: dims.sub_id_field, transaction_id: dims.txn_field,
      },
      preview: bdPreview,
      draft_report: {
        name,
        kind: 'breakdown',
        // Nguồn phân trang → URL API trực tiếp (goto thẳng, không qua trang SPA); ngược lại trang
        // chứa nguồn (page_url) hoặc {base}.
        url: paginatedUrl ?? c.page_url ?? sourceUrl ?? '{base}',
        url_date_format: 'YYYY-MM-DD',
        ...(c.kind === 'table'
          ? { mode: 'html_table', table_index: c.table_index ?? 0 }
          : { capture: { url_pattern: patternFor(c.url), pattern_type: 'substring' } }),
        wait: { strategy: 'networkidle', navigation_timeout_ms: 60000, post_load_wait_ms: 5000, capture_settle_ms: 4000 },
        rows_path: c.path,
        // Phân trang: engine lật {page}=1,2,... lấy đủ (max 20 trang). Không dùng chung với tab click.
        ...(paginatedUrl ? { paginate: { max_pages: 20 } } : {}),
        // via_tab (tab SPA Location/Device) → sync tự click tab rồi mới hứng — CHỈ khi không phân trang.
        ...(!paginatedUrl && c.via_tab ? { actions: [{ type: 'click', text: c.via_tab }] } : {}),
        // Nguồn tổng-theo-kỳ không cột ngày → engine gán ngày cuối cửa sổ (aggregate, không per-ngày).
        ...(isSnapshot ? { date_mode: 'window_end' } : {}),
        mapping: {
          ...(c.dateField
            ? { date: { path: c.dateField, order: bdDateInfo.order, required: false, formats: ['YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DDTHH:mm:ss', 'DD.MM.YYYY', 'D.M.YYYY', 'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'] } }
            : {}),
          revenue: { path: c.revenueField, divisor: bdDivisor, decimal_separator: bdNumFmt.decimal, thousands_separator: bdNumFmt.thousands },
          offer_name: { path: '__const__', required: false, default: '' },
          currency: bdCurrencyField
            ? { path: bdCurrencyField, required: false, default: currencyGuess || 'USD' }
            : { path: '__const__', required: false, default: currencyGuess || 'USD' },
          ...(perConversion ? { conversions: { path: '__const__', required: false, default: 1 } } : {}),
        },
        dimensions: {
          // extract:true → cột text hỗn hợp (Meta Data), engine trích nước/thiết bị nhúng lúc sync.
          ...(dims.country_field ? { country: { path: dims.country_field, normalize: 'country', ...(dims.country_extract ? { extract: true } : {}) } } : {}),
          ...(dims.device_field ? { device: { path: dims.device_field, normalize: 'device', ...(dims.device_extract ? { extract: true } : {}) } } : {}),
          ...(dims.time_field ? { conversion_time: { path: dims.time_field, formats: dims.time_formats ?? ['iso'] } } : {}),
          ...(dims.sub_id_field ? { sub_id: { path: dims.sub_id_field } } : {}),
          ...(dims.txn_field ? { transaction_id: { path: dims.txn_field } } : {}),
        },
        revenue_type: 'pending',
        duplicate_strategy: perConversion ? 'sum' : 'last',
        validation: { min_mapped_rows: 0, max_invalid_row_ratio: 0.2 },
      },
    }
  }

  let breakdown: BdReport | null = null
  const breakdownReports: BdReport[] = []
  const bdDimPages = new Set<string>() // trang (page_url) có nguồn mang dimension breakdown — cho tóm tắt `pages`
  {
    // Gom mọi candidate breakdown khả dụng (có revenue + ≥1 dimension).
    const bdCands: BdCand[] = []
    for (const c of scored) {
      if (!c.revenueField || c.arr.length < 3) continue
      const tableDupKeys = c.kind === 'table' ? Object.keys(c.arr[0] ?? {}).filter((k) => !/^col_\d+$/.test(k)) : []
      const dims = detectBreakdownDims(c.arr, [c.dateField, c.revenueField, ...tableDupKeys], c.dateField)
      const dimCount = [dims.country_field, dims.device_field, dims.time_field, dims.sub_id_field].filter(Boolean).length
      if (dimCount === 0) continue
      if (c.page_url) bdDimPages.add(c.page_url)
      bdCands.push({ ...c, dims, dimCount })
    }
    // Ưu tiên candidate nhiều dimension + nhiều dòng.
    bdCands.sort((a, b) => b.dimCount - a.dimCount || b.arr.length - a.arr.length)

    // Greedy theo ĐỘ PHỦ dimension: mỗi report chỉ được emit nếu đóng góp country/device/time
    // CHƯA covered (1 candidate có cả country+device → 1 report; geo & device khác tab → 2 report).
    const covered = { country: false, device: false, time: false }
    for (const c of bdCands) {
      const addsCountry = !!c.dims.country_field && !covered.country
      const addsDevice = !!c.dims.device_field && !covered.device
      const addsTime = !!(c.dims.time_field || c.dateField) && !covered.time && (!!c.dims.time_field || !!c.dims.sub_id_field)
      if (!addsCountry && !addsDevice && !addsTime) continue
      const name = addsCountry ? 'breakdown_geo' : addsDevice ? 'breakdown_device' : 'breakdown'
      breakdownReports.push(buildBreakdownReport(c, name))
      if (c.dims.country_field) covered.country = true
      if (c.dims.device_field) covered.device = true
      if (c.dims.time_field || c.dateField) covered.time = true
    }
    breakdown = breakdownReports[0] ?? null
  }

  // ── MANUAL (Phase 2): user chỉ CỘT quốc gia/thiết bị khi auto không nhận (cột lạ/mã nội bộ) ──
  // Base = nguồn có doanh thu + ngày, nhiều dòng nhất (để lấy revenue/date; dimension do user chỉ).
  const manualBase = scored.find((c) => c.revenueField && c.arr.length >= 3 && c.dateField)
    ?? scored.find((c) => c.revenueField && c.arr.length >= 3) ?? null
  const mCountry = body?.breakdown_manual?.country_field ? String(body.breakdown_manual.country_field) : null
  const mDevice = body?.breakdown_manual?.device_field ? String(body.breakdown_manual.device_field) : null
  if ((mCountry || mDevice) && manualBase) {
    const tableDupKeys = manualBase.kind === 'table' ? Object.keys(manualBase.arr[0] ?? {}).filter((k) => !/^col_\d+$/.test(k)) : []
    const auto = detectBreakdownDims(manualBase.arr, [manualBase.dateField, manualBase.revenueField, ...tableDupKeys], manualBase.dateField)
    const forced: BreakdownDims = {
      ...auto,
      country_field: mCountry ?? auto.country_field, country_extract: mCountry ? true : auto.country_extract,
      device_field: mDevice ?? auto.device_field, device_extract: mDevice ? true : auto.device_extract,
    }
    const dimCount = [forced.country_field, forced.device_field, forced.time_field, forced.sub_id_field].filter(Boolean).length
    if (dimCount > 0) {
      const rep = buildBreakdownReport({ ...manualBase, dims: forced, dimCount }, forced.country_field ? 'breakdown_geo' : 'breakdown_device')
      breakdownReports.length = 0 // manual THAY THẾ auto
      breakdownReports.push(rep)
      breakdown = rep
    }
  }
  // Danh sách cột của base (để dialog cho user chọn khi chỉnh tay). Bảng HTML: col_N + nhãn header.
  const manualColumns = manualBase && manualBase.arr.length
    ? Object.keys(manualBase.arr[0])
        .filter((f) => manualBase.kind !== 'table' || /^col_\d+$/.test(f))
        .map((f) => ({ field: f, label: fieldLabels[f] ?? f, sample: String(manualBase.arr[0][f] ?? '').slice(0, 48) }))
    : []

  // Tóm tắt theo TRANG (auto-scan ghé nhiều trang trong 1 lần dò) — UI hiện "Đã quét N trang".
  const pagesMap = new Map<string, { candidates: number; hasDate: boolean; hasRevenue: boolean; hasBreakdownDims: boolean }>()
  for (const c of scored) {
    if (!c.page_url) continue // trang gốc/dashboard (page_url null) không liệt kê
    const e = pagesMap.get(c.page_url) ?? { candidates: 0, hasDate: false, hasRevenue: false, hasBreakdownDims: false }
    e.candidates++
    if (c.dateField) e.hasDate = true
    if (c.revenueField) e.hasRevenue = true
    if (bdDimPages.has(c.page_url)) e.hasBreakdownDims = true
    pagesMap.set(c.page_url, e)
  }
  const pages = [...pagesMap.entries()].map(([page_url, v]) => ({ page_url, page: pageLabel(page_url), ...v }))

  // Cảnh báo độ tin thấp — nhắc user kiểm tra trước khi lưu.
  const warnings: string[] = []
  if (scored.filter((c) => c.dateField && c.revenueField).length >= 2)
    warnings.push('Có nhiều nguồn hợp lệ (ngày + tiền) — kiểm tra chọn đúng bảng ở "Nguồn".')
  if (!currencyGuess)
    warnings.push('Không nhận ra tiền tệ — tạm dùng USD. Kiểm tra/đổi ở "Field tiền tệ".')
  if (dateInfo.ambiguous)
    warnings.push('Ngày dạng số/số/năm không rõ DD/MM hay MM/DD — đối chiếu preview với dashboard.')
  if (revenueField && !MONEY_SYM.test(rows.map((r) => String(r[revenueField] ?? '')).join(' ')) && !REV_NAME.test(fieldLabels[revenueField] ?? revenueField))
    warnings.push('Cột doanh thu đoán theo giá trị lớn nhất — kiểm tra đúng cột.')

  return NextResponse.json({
    draft,
    preview,
    fields,
    field_labels: fieldLabels,   // col_N → tên header (dropdown hiển thị nhãn, value vẫn col_N)
    warnings,
    breakdown,                 // report breakdown đầu tiên (backward compat) — null nếu không có
    breakdown_reports: breakdownReports,   // TẤT CẢ report breakdown dò được (geo/device/giờ, mỗi tab 1 report)
    manual_columns: manualColumns,   // cột của nguồn để user CHỈ TAY cột quốc gia/thiết bị khi auto bó
    revenue_type: rt,          // loại doanh thu hiệu lực (tự khớp nguồn đã dò) → panel phản ánh nút
    source_url: sourceUrl,     // trang đã dò (payout) — null nếu dò dashboard
    divisor,                   // chia giá trị (cents→đơn vị chính) → panel phản ánh ô ÷
    pages,                     // các trang auto-scan đã ghé + trang đó có gì (ngày/tiền/dimension)
    chosen: { url: chosen.url, rows_path: chosen.path, date_field: dateField, revenue_field: revenueField, currency_field: currencyField, page: pageLabel(chosen.page_url) },
    candidates: scored.map((c) => {
      // Nhãn cột ngày/doanh thu trong dropdown "Nguồn": đổi col_N → tên header cho dễ đọc.
      const label = (f: string | null) => {
        const m = c.kind === 'table' && c.headers && f?.match(/^col_(\d+)$/)
        return (m && c.headers![+m[1]]) || f
      }
      return {
      url: c.url, rows_path: c.path, rows: c.arr.length,
      page: pageLabel(c.page_url), // trang chứa nguồn (auto-scan) — null = trang gốc/dashboard
      hasDate: !!c.dateField, hasRevenue: !!c.revenueField,
      date_field: label(c.dateField), revenue_field: label(c.revenueField),
      currency: c.revenueField ? symbolCurrency(c.arr, c.revenueField) : '',
      // bảng rỗng: kèm vài header để user nhận ra đúng bảng (vd "Created At, Final payout amount…").
      headers: c.arr.length === 0 ? (c.headers ?? []).slice(0, 4) : undefined,
      }
    }),
  })
}
