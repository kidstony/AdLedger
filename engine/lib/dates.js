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
//
// Regex tìm Ở BẤT KỲ ĐÂU trong chuỗi (không neo đầu): bảng HTML responsive hay nhét
// cả NHÃN CỘT vào ô ("Date of accomplishment 14.7.2026 16:53:55" — RebelsFunding).
// Guard (?<!\d)/(?!\d) để không cắn giữa số dài. TUYỆT ĐỐI không thả chuỗi số kiểu
// "10.7.2026" xuống dayjs/V8 lenient: V8 đọc month-first → ĐẢO ngày↔tháng.
export function parseDate(value, formats = [], order = 'DMY') {
  if (value === null || value === undefined || value === '') return null
  const str = String(value).trim()

  // Ngày ISO (year-first, không mơ hồ): "2026-06-09", "…2026-06-09 00:00:00Z", kể cả có
  // chữ đằng trước. Khớp normDate của detect (preview = engine).
  const iso = str.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // Ngày linh hoạt (separator ./-, cho phép dấu cách): "06.07.2026", "9. 7. 2026",
  // "06/07/2026", "6-7-2026", "02.07.26" (năm 2 số → 20YY). Gán day/month theo `order`.
  const gen = str.match(/(?<!\d)(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/)
  if (gen) {
    const first = gen[1].padStart(2, '0'), second = gen[2].padStart(2, '0')
    const dd = order === 'MDY' ? second : first
    const mm = order === 'MDY' ? first : second
    const yyyy = gen[3].length === 2 ? `20${gen[3]}` : gen[3]
    if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) return `${yyyy}-${mm}-${dd}`
  }

  for (const fmt of formats) {
    if (fmt === 'unix' || fmt === 'unix_ms') {
      const num = Number(value)
      if (!Number.isFinite(num)) continue
      const d = fmt === 'unix' ? dayjs.unix(num) : dayjs(num)
      if (d.isValid()) return d.format('YYYY-MM-DD')
    } else if (fmt === 'iso') {
      // Chuỗi ISO thật đã bị regex trên bắt; 'iso' ở đây chỉ còn vai trò "cho phép
      // lenient" ở nhánh cuối hàm (tên tháng chữ "Jul 14, 2026"...).
      continue
    } else {
      const d = dayjs(str, fmt, true)
      if (d.isValid()) return d.format('YYYY-MM-DD')
    }
  }

  // Nước cuối (formats rỗng hoặc có 'iso'): tên tháng bằng chữ v.v. Chuỗi SỐ mơ hồ
  // đã bị các nhánh trên bắt trước → không còn cửa cho V8 đọc đảo tháng.
  if (formats.length === 0 || formats.includes('iso')) {
    const d = dayjs(str)
    if (d.isValid()) return d.format('YYYY-MM-DD')
  }
  return null
}

// Parse timestamp chuyển đổi → { date: 'YYYY-MM-DD', hour: 0-23 } | null
// (dimensions.conversion_time của report breakdown — cần cả giờ, không chỉ ngày).
// tz = múi giờ dữ liệu nguồn: giá trị tuyệt đối (epoch, ISO có offset/Z) được đổi về tz
// để lấy giờ đúng; chuỗi không offset coi như đã ở giờ nguồn → giữ nguyên. Không khai tz
// mà giá trị tuyệt đối → dùng UTC (deterministic, không phụ thuộc máy chạy worker).
// order: 'DMY'|'MDY' — cho nhánh regex linh hoạt (chuỗi "14.7.2026 16:53" trong ô có nhãn).
export function parseDateTime(value, formats = [], tz = null, order = 'DMY') {
  if (value === null || value === undefined || value === '') return null
  const str = String(value).trim()

  let d = null
  let absolute = false // giá trị là thời điểm tuyệt đối (cần đổi múi giờ)?
  for (const fmt of formats) {
    if (fmt === 'unix' || fmt === 'unix_ms') {
      const num = Number(str)
      if (!Number.isFinite(num)) continue
      d = fmt === 'unix' ? dayjs.unix(num) : dayjs(num)
      absolute = true
    } else if (fmt === 'iso') {
      // Guard: chỉ nhận chuỗi THẬT SỰ ISO (bắt đầu YYYY-MM-DD). Không thả chuỗi khác
      // xuống dayjs/V8 lenient ở đây — "10.7.2026" sẽ bị V8 đọc month-first (đảo
      // ngày↔tháng); chuỗi đó để các nhánh regex bên dưới xử lý đúng theo `order`.
      if (!/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(str)) continue
      d = dayjs(str)
      absolute = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str)
    } else {
      d = dayjs(str, fmt, true)
    }
    if (d && d.isValid()) break
    d = null
  }

  // ISO datetime Ở BẤT KỲ ĐÂU trong chuỗi (ô có nhãn đằng trước): "…2026-07-14 9:05[:33][Z]".
  if (!d) {
    const m = str.match(/(?<!\d)(\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)/)
    if (m) {
      const t = dayjs(m[1])
      if (t.isValid()) {
        d = t
        absolute = !!m[2]
      }
    }
  }
  // Ngày linh hoạt KÈM GIỜ, tìm unanchored: "Date of accomplishment 14.7.2026 16:53:55"
  // (RebelsFunding — bảng nhét nhãn cột vào ô). Chỉ nhận khi CÓ giờ — ô chỉ-có-ngày là
  // việc của mapping.date/parseDate, không bịa hour=0.
  if (!d) {
    const m = str.match(/(?<!\d)(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})(?!\d)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
    if (m) {
      const first = m[1].padStart(2, '0'), second = m[2].padStart(2, '0')
      const dd = order === 'MDY' ? second : first
      const mm = order === 'MDY' ? first : second
      const hour = +m[4]
      if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31 && hour >= 0 && hour <= 23) {
        // Giờ nguồn giữ nguyên (chuỗi không offset = đã ở múi giờ nguồn — như doc đầu hàm).
        return { date: `${m[3]}-${mm}-${dd}`, hour }
      }
    }
  }
  // Nước cuối (formats rỗng hoặc có 'iso'): nguồn dùng tên tháng chữ ("Jul 14, 2026 10:00").
  // Chuỗi số mơ hồ đã bị các nhánh trên bắt trước → hết cửa đọc đảo tháng.
  if (!d && (formats.length === 0 || formats.includes('iso'))) {
    const t = dayjs(str)
    if (t.isValid()) {
      d = t
      absolute = /(?:Z|[+-]\d{2}:?\d{2})$/.test(str)
    }
  }
  if (!d) return null

  if (absolute) d = d.tz(tz ?? 'UTC')
  return { date: d.format('YYYY-MM-DD'), hour: d.hour() }
}
