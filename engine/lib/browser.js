import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PROFILES_DIR = path.join(ENGINE_DIR, 'profiles')

// Mỗi tài khoản 1 profile Chrome riêng — cookie đăng nhập sống vĩnh viễn ở đây.
// accountId = slug tài khoản (mặc định = network_id nếu config không khai accounts).
// headless: false bắt buộc (nhiều network chặn headless; cần cửa sổ để user đăng nhập).
export async function openContext(accountId) {
  const profileDir = path.join(PROFILES_DIR, accountId)
  fs.mkdirSync(profileDir, { recursive: true })
  return chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1366, height: 850 },
  })
}

// Xoá profile (đăng xuất/hủy phiên) để buộc đăng nhập lại — dùng cho "Đăng nhập lại"
// hoặc khi đổi sang tài khoản khác trên cùng dashboard. Không mở context nào lúc gọi.
export function clearProfile(accountId) {
  const profileDir = path.join(PROFILES_DIR, accountId)
  fs.rmSync(profileDir, { recursive: true, force: true })
}
