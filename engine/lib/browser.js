import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { log } from './logger.js'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PROFILES_DIR = path.join(ENGINE_DIR, 'profiles')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Mọi context đang mở — để đóng sạch khi tắt worker (tránh cửa sổ Chrome mồ côi khóa profile).
const openContexts = new Set()
// Lỗi Chrome đang giữ profile (đóng-mở sát nhau / cửa sổ mồ côi) — thử lại chờ nhả khóa.
const PROFILE_BUSY_RE = /already in use|existing browser session|ProcessSingleton|SingletonLock/i

// Mỗi tài khoản 1 profile Chrome riêng — cookie đăng nhập sống vĩnh viễn ở đây.
// accountId = slug tài khoản (mặc định = network_id nếu config không khai accounts).
// headless: false bắt buộc (nhiều network chặn headless; cần cửa sổ để user đăng nhập).
export async function openContext(accountId) {
  const profileDir = path.join(PROFILES_DIR, accountId)
  fs.mkdirSync(profileDir, { recursive: true })
  const launch = () => chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1366, height: 850 },
    // Giảm dấu hiệu automation: nhiều site bảo mật/proxy (Cloudflare…) chặn khi thấy
    // navigator.webdriver / cờ --enable-automation → quay loading vô tận.
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  })

  let context = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { context = await launch(); break }
    catch (err) {
      if (PROFILE_BUSY_RE.test(err.message) && attempt < 3) {
        log.warn(`Profile "${accountId}" đang bận (Chrome đóng-mở sát / mồ côi?) — chờ ${attempt * 2}s rồi thử lại (${attempt}/2)…`, accountId)
        await sleep(attempt * 2000)
        continue
      }
      if (PROFILE_BUSY_RE.test(err.message)) {
        throw new Error(`Profile "${accountId}" đang bị một cửa sổ Chrome khác giữ — đóng cửa sổ Chrome của tài khoản này (hoặc kết thúc tiến trình Chrome) rồi thử lại.`)
      }
      throw err
    }
  }

  openContexts.add(context)
  context.on('close', () => openContexts.delete(context))
  // Ẩn navigator.webdriver còn sót lại (một số site vẫn đọc được).
  await context.addInitScript(() => {
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) } catch { /* noop */ }
  })
  return context
}

// Đóng mọi context đang mở (khi tắt worker) — không để cửa sổ Chrome mồ côi khóa profile.
export async function closeAllContexts() {
  const all = [...openContexts]
  openContexts.clear()
  await Promise.all(all.map((c) => c.close().catch(() => {})))
}

// Xoá profile (đăng xuất/hủy phiên) để buộc đăng nhập lại — dùng cho "Đăng nhập lại"
// hoặc khi đổi sang tài khoản khác trên cùng dashboard. Không mở context nào lúc gọi.
export function clearProfile(accountId) {
  const profileDir = path.join(PROFILES_DIR, accountId)
  fs.rmSync(profileDir, { recursive: true, force: true })
}
