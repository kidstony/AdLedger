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

// Render {start_date}/{end_date} trong URL theo url_date_format
// Hỗ trợ token dayjs (YYYY-MM-DD, MM/DD/YYYY...) và 2 từ khóa: unix, unix_ms
export function renderUrl(urlTemplate, window, format = 'YYYY-MM-DD') {
  const render = (d) => {
    if (format === 'unix') return String(d.unix())
    if (format === 'unix_ms') return String(d.valueOf())
    return d.format(format)
  }
  return urlTemplate
    .replaceAll('{start_date}', encodeURIComponent(render(window.from)))
    .replaceAll('{end_date}', encodeURIComponent(render(window.to)))
}

// Parse ngày từ payload network → 'YYYY-MM-DD' | null
// formats: mảng token dayjs, thử lần lượt; hỗ trợ từ khóa unix/unix_ms/iso
export function parseDate(value, formats = []) {
  if (value === null || value === undefined || value === '') return null

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
