// Bắt MỌI response JSON của trang (kể cả qua các lần điều hướng khi user đăng nhập
// + mở trang báo cáo), gom [{url, payload}]. Dừng sau khi thấy response "giống bảng
// dữ liệu" + settle, hoặc hết timeout. Mảng bị cắt bớt để hạn chế kích thước lưu DB.
const MAX_RESPONSES = 40
const MAX_ROWS_PER_ARRAY = 2000 // preview phản ánh gần đủ cửa sổ (sync vốn không cap)
const MAX_POST_DATA = 4000       // cắt body request để nhẹ DB

function truncateArrays(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ROWS_PER_ARRAY).map((v) => truncateArrays(v, depth + 1))
  }
  if (value && typeof value === 'object' && depth < 6) {
    const out = {}
    for (const k of Object.keys(value)) out[k] = truncateArrays(value[k], depth + 1)
    return out
  }
  return value
}

// Gom 1 mục capture kèm THÔNG TIN REQUEST (method/url đầy đủ/body) để lộ cách network
// gửi kỳ ngày (GET query? POST body?) — dùng khi cấu hình backfill theo cửa sổ.
async function buildEntry(res) {
  const req = res.request()
  let post = null
  try { post = req.postData(); if (post && post.length > MAX_POST_DATA) post = post.slice(0, MAX_POST_DATA) } catch { /* no body */ }
  // page_url: TRANG nào bắn response này (auto-scan quét nhiều trang → detect biết nguồn
  // nằm ở trang nào để đặt report.url). frame() THROW với service-worker/early-navigation.
  let page_url = null
  try { page_url = res.frame().url() } catch { /* service worker / điều hướng sớm — không có frame */ }
  return {
    url: res.url(),
    page_url,
    payload: truncateArrays(await res.json()),
    method: req.method(),
    req_url: req.url(),   // URL request (kèm query string, nơi hay chứa date_from/date_to)
    post_data: post,      // body (nếu POST) — nơi khác hay chứa kỳ ngày
  }
}

// Có mảng gồm >=3 object (giống bảng dữ liệu) ở đâu đó trong payload không?
function hasDataArray(value, depth = 0) {
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) return true
    return value.some((v) => hasDataArray(v, depth + 1))
  }
  if (value && typeof value === 'object' && depth < 6) {
    return Object.values(value).some((v) => hasDataArray(v, depth + 1))
  }
  return false
}

// Gắn listener bắt MỌI response JSON (xhr/fetch/content-type json) trên mọi page +
// page mới của context. KHÔNG tự dừng — trả { captured, detach } để bên gọi quyết định
// khi nào kết thúc (vd chờ user bấm "Phân tích"). Tránh đóng sớm trong lúc đăng nhập.
// opts (auto-scan quét nhiều trang cần nới): maxResponses = cap số entry; maxBytes = cap
// tổng kích thước payload (bảo vệ insert jsonb 1 dòng); dedupe = bỏ request lặp
// (XHR boilerplate SPA như /api/me bắn lại mỗi trang, không đốt cap).
// Mặc định giữ NGUYÊN hành vi cũ.
export function attachJsonCapture(context, { maxResponses = MAX_RESPONSES, maxBytes = Infinity, dedupe = false } = {}) {
  const captured = []
  const seen = dedupe ? new Set() : null
  let totalBytes = 0
  const onResp = async (res) => {
    const rt = res.request().resourceType()
    const ct = res.headers()['content-type'] || ''
    if (rt !== 'xhr' && rt !== 'fetch' && !ct.includes('json')) return
    if (captured.length >= maxResponses || totalBytes > maxBytes) return
    try {
      const entry = await buildEntry(res)
      const len = JSON.stringify(entry.payload).length
      if (seen) {
        // Key gồm cả kích thước response: tab Location/Device của cùng endpoint (vd Tolt
        // /api/data/reports) có URL Y HỆT nhưng body khác → length khác → KHÔNG dedupe nhầm.
        // Boilerplate SPA lặp thật (cùng response) → cùng length → vẫn dedupe.
        const key = `${entry.method} ${entry.req_url} ${entry.post_data ?? ''} ${len}`
        if (seen.has(key)) return
        seen.add(key)
      }
      captured.push(entry)
      totalBytes += len
    } catch { /* không phải JSON — bỏ qua */ }
  }
  const attach = (p) => p.on('response', onResp)
  for (const p of context.pages()) attach(p)
  context.on('page', attach)
  const detach = () => {
    context.off('page', attach)
    for (const p of context.pages()) p.off('response', onResp)
  }
  return { captured, detach }
}

export function discoverCapture(context, { timeoutMs = 120000, idleMs = 8000, settleMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const captured = []
    let done = false
    let settleTimer = null
    let idleTimer = null
    const finish = () => {
      if (done) return
      done = true
      context.off('page', attach)
      clearTimeout(hardTimer)
      clearTimeout(settleTimer)
      clearTimeout(idleTimer)
      resolve(captured)
    }
    const bumpIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(finish, idleMs) // không có response mới trong idleMs → xong
    }
    const onResp = async (res) => {
      if (done) return
      const rt = res.request().resourceType()
      const ct = res.headers()['content-type'] || ''
      if (rt !== 'xhr' && rt !== 'fetch' && !ct.includes('json')) return
      try {
        const entry = await buildEntry(res)
        captured.push(entry)
        bumpIdle()
        if (captured.length >= MAX_RESPONSES) return finish()
        if (hasDataArray(entry.payload)) {
          clearTimeout(settleTimer)
          settleTimer = setTimeout(finish, settleMs) // gom thêm XHR liên quan rồi kết thúc
        }
      } catch { /* không phải JSON hợp lệ — bỏ qua */ }
    }
    const attach = (p) => p.on('response', onResp)
    for (const p of context.pages()) attach(p)
    context.on('page', attach)
    const hardTimer = setTimeout(finish, timeoutMs)
  })
}
