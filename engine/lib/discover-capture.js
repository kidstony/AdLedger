// Bắt MỌI response JSON của trang (kể cả qua các lần điều hướng khi user đăng nhập
// + mở trang báo cáo), gom [{url, payload}]. Dừng sau khi thấy response "giống bảng
// dữ liệu" + settle, hoặc hết timeout. Mảng bị cắt bớt để hạn chế kích thước lưu DB.
const MAX_RESPONSES = 40
const MAX_ROWS_PER_ARRAY = 300

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

// Nhận CONTEXT (bắt trên mọi tab, kể cả tab mới do login/SPA mở). Kết thúc khi:
// (a) thấy mảng dữ liệu + settle; (b) idle: đã bắt ≥1 response, không có cái mới
// trong idleMs; (c) hết timeoutMs.
// Gắn listener bắt MỌI response JSON (xhr/fetch/content-type json) trên mọi page +
// page mới của context. KHÔNG tự dừng — trả { captured, detach } để bên gọi quyết định
// khi nào kết thúc (vd chờ user bấm "Phân tích"). Tránh đóng sớm trong lúc đăng nhập.
export function attachJsonCapture(context) {
  const captured = []
  const onResp = async (res) => {
    const rt = res.request().resourceType()
    const ct = res.headers()['content-type'] || ''
    if (rt !== 'xhr' && rt !== 'fetch' && !ct.includes('json')) return
    if (captured.length >= MAX_RESPONSES) return
    try {
      const payload = await res.json()
      captured.push({ url: res.url(), payload: truncateArrays(payload) })
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
        const payload = await res.json()
        captured.push({ url: res.url(), payload: truncateArrays(payload) })
        bumpIdle()
        if (captured.length >= MAX_RESPONSES) return finish()
        if (hasDataArray(payload)) {
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
