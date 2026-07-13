import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const LOCKS_DIR = path.join(ENGINE_DIR, '.locks')
const STALE_MS = 2 * 60 * 60 * 1000 // lock cũ hơn 2h coi như tiến trình trước đã chết

// Lock THEO KHÓA (mỗi account 1 khóa) + TÁI NHẬP trong cùng tiến trình: cho nhiều profile chạy
// song song, chỉ CÙNG-MỘT-account mới phải chờ nhau. owned = số lần khóa lồng nhau của tiến trình
// này (execute() khóa account → runNetwork khóa lại cùng account = không tự kẹt).
const owned = new Map() // key → count

// Tên file an toàn cho khóa (account.id là uuid/slug — vẫn sanitize cho chắc).
function lockPath(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(LOCKS_DIR, `${safe}.lock`)
}

// true = lấy được lock; false = tiến trình KHÁC đang giữ khóa này
export function acquireLock(key = 'global') {
  // Đã sở hữu trong tiến trình này → tái nhập (không đụng file).
  const cur = owned.get(key)
  if (cur) { owned.set(key, cur + 1); return true }

  fs.mkdirSync(LOCKS_DIR, { recursive: true })
  const LOCK_PATH = lockPath(key)
  try {
    fs.writeFileSync(LOCK_PATH, `${process.pid} ${new Date().toISOString()}`, { flag: 'wx' })
    owned.set(key, 1)
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
      owned.set(key, 1)
      return true
    }
    return false
  }
}

// Chỉ xóa lock nếu chính tiến trình này giữ — không phá lock của tiến trình khác.
// Giảm số lần khóa lồng nhau; về 0 mới xóa file.
export function releaseLock(key = 'global') {
  const cur = owned.get(key)
  if (!cur) return
  if (cur > 1) { owned.set(key, cur - 1); return }
  owned.delete(key)
  try {
    fs.unlinkSync(lockPath(key))
  } catch {
    // đã bị xóa thì thôi
  }
}

// Dọn mọi khóa tiến trình này còn giữ (dùng khi thoát/SIGINT).
export function releaseAllLocks() {
  for (const key of [...owned.keys()]) {
    owned.delete(key)
    try { fs.unlinkSync(lockPath(key)) } catch { /* thôi */ }
  }
}
