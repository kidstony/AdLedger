import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const LOCK_PATH = path.join(ENGINE_DIR, '.lock')
const STALE_MS = 2 * 60 * 60 * 1000 // lock cũ hơn 2h coi như tiến trình trước đã chết

let owned = false

// true = lấy được lock; false = có tiến trình khác đang chạy
export function acquireLock() {
  try {
    fs.writeFileSync(LOCK_PATH, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' })
    owned = true
    return true
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    // Lock đã tồn tại — thu hồi nếu (a) tiến trình chủ đã chết, hoặc (b) quá cũ (>2h).
    let ownerDead = false
    try {
      const pid = parseInt(fs.readFileSync(LOCK_PATH, 'utf8').trim().split(/\s+/)[0], 10)
      if (Number.isFinite(pid)) {
        try { process.kill(pid, 0) } // còn sống → không throw
        catch (e) { if (e.code === 'ESRCH') ownerDead = true } // tiến trình không tồn tại → mồ côi
      }
    } catch { /* đọc lock lỗi → dựa vào tuổi */ }
    const age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs
    if (ownerDead || age > STALE_MS) {
      fs.writeFileSync(LOCK_PATH, `${process.pid} ${new Date().toISOString()}`)
      owned = true
      return true
    }
    return false
  }
}

// Chỉ xóa lock nếu chính tiến trình này giữ — không phá lock của tiến trình khác
export function releaseLock() {
  if (!owned) return
  owned = false
  try {
    fs.unlinkSync(LOCK_PATH)
  } catch {
    // đã bị xóa thì thôi
  }
}
