import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

// Cửa sổ trailing N ngày tính theo timezone của network: [hôm nay - days, hôm nay]
export function dateWindow(days = 30, tz = null) {
  const now = tz ? dayjs().tz(tz) : dayjs()
  return {
    from: now.subtract(days, 'day').startOf('day'),
    to: now.endOf('day'),
    fromISO: now.subtract(days, 'day').format('YYYY-MM-DD'),
    toISO: now.format('YYYY-MM-DD'),
  }
}

// Render {base}/{start_date}/{end_date} trong URL theo url_date_format
// {base} = dashboard_url của account (Tolt & network kiểu template). Hỗ trợ token
// dayjs (YYYY-MM-DD, MM/DD/YYYY...) và 2 từ khóa: unix, unix_ms
export function renderUrl(urlTemplate, window, format = 'YYYY-MM-DD', base = '') {
  const render = (d) => {
    if (format === 'unix') return String(d.unix())
    if (format === 'unix_ms') return String(d.valueOf())
    return d.format(format)
  }
  return urlTemplate
    .replaceAll('{base}', (base ?? '').replace(/\/+$/, '')) // bỏ '/' cuối để tránh '//'
    .replaceAll('{start_date}', encodeURIComponent(render(window.from)))
    .replaceAll('{end_date}', encodeURIComponent(render(window.to)))
}

// Parse ngày từ payload network → 'YYYY-MM-DD' | null
// formats: mảng token dayjs, thử lần lượt; hỗ trợ từ khóa unix/unix_ms/iso
// order: 'DMY' (ngày-trước, mặc định) | 'MDY' (tháng-trước, kiểu Mỹ) — cho nhánh regex linh hoạt.
export function parseDate(value, formats = [], order = 'DMY') {
  if (value === null || value === undefined || value === '') return null

  // Tiền tố ngày ISO (year-first, không mơ hồ): "2026-06-09", "2026-06-09 00:00:00",
  // "2026-06-09T00:00:00Z"… → lấy luôn phần ngày. Khớp normDate của detect (preview =
  // engine). Chuỗi ngày-trước ("06.07.2026") không khớp → rơi vào formats bên dưới.
  const isoPrefix = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]|$)/)
  if (isoPrefix) return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`

  // Ngày linh hoạt (separator ./-, cho phép dấu cách): "06.07.2026", "9. 7. 2026",
  // "06/07/2026", "6-7-2026". Gán day/month theo `order` (DMY mặc định, MDY = kiểu Mỹ).
  const gen = String(value).trim().match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/)
  if (gen) {
    const first = gen[1].padStart(2, '0'), second = gen[2].padStart(2, '0')
    const dd = order === 'MDY' ? second : first
    const mm = order === 'MDY' ? first : second
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${gen[3]}-${mm}-${dd}`
  }

  for (const fmt of formats) {
    if (fmt === 'unix' || fmt === 'unix_ms') {
      const num = Number(value)
      if (!Number.isFinite(num)) continue
      const d = fmt === 'unix' ? dayjs.unix(num) : dayjs(num)
      if (d.isValid()) return d.format('YYYY-MM-DD')
    } else if (fmt === 'iso') {
      const d = dayjs(String(value))
      if (d.isValid()) return d.format('YYYY-MM-DD')
    } else {
      const d = dayjs(String(value).trim(), fmt, true)
      if (d.isValid()) return d.format('YYYY-MM-DD')
    }
  }

  // Không khai formats: thử ISO chung
  if (formats.length === 0) {
    const d = dayjs(String(value))
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  return null
}
