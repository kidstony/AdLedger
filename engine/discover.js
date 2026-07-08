// Script DÒ tạm thời (Phase 1): mở Chrome cho bạn đăng nhập, rồi in ra mọi response JSON
// mà trang báo cáo gọi — kèm URL và "hình dạng" JSON — để dựng config network.
//   node discover.js --network=<network_id>   (dùng config _<network>-discovery.json)
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from './lib/args.js'
import { loadConfigs } from './lib/config.js'
import { openContext } from './lib/browser.js'

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url))

function waitForEnter(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((r) => rl.question(text, () => { rl.close(); r() }))
}

// Mô tả gọn hình dạng 1 giá trị JSON (để biết rows_path)
function shape(value, depth = 0) {
  if (Array.isArray(value)) {
    return `[${value.length}] of ${value.length ? shape(value[0], depth + 1) : '?'}`
  }
  if (value && typeof value === 'object') {
    if (depth > 2) return '{...}'
    const keys = Object.keys(value).slice(0, 12)
    return `{ ${keys.map((k) => `${k}: ${shortType(value[k])}`).join(', ')} }`
  }
  return shortType(value)
}
function shortType(v) {
  if (Array.isArray(v)) return `[${v.length}]`
  if (v === null) return 'null'
  if (typeof v === 'object') return '{…}'
  if (typeof v === 'string') return `"${v.slice(0, 30)}"`
  return String(v)
}

async function main() {
  const args = parseArgs()
  if (!args.network) {
    console.error('Dùng: node discover.js --network=<network_id> (cần file configs/_<network>-discovery.json)')
    process.exit(1)
  }
  const [config] = loadConfigs(args.network) // khớp network_id trong file _<network>-discovery.json
  const report = config.reports[0]

  const context = await openContext(config.network_id)
  const page = context.pages()[0] ?? (await context.newPage())

  const seen = []
  // Bắt trên MỌI tab của context (SPA có thể mở tab mới)
  const attach = (p) => {
    p.on('response', async (res) => {
      const url = res.url()
      if (!url.includes(report.capture.url_pattern)) return
      const ct = res.headers()['content-type'] || ''
      if (!ct.includes('json')) return
      try {
        const payload = await res.json()
        seen.push({ url, payload })
        console.log(`  [bắt được #${seen.length}] ${url.slice(0, 110)}`)
      } catch {}
    })
  }
  attach(page)
  context.on('page', attach)

  await page.goto(report.url, { waitUntil: 'load', timeout: 60000 }).catch(() => {})
  await waitForEnter(
    `\n👉 Trong cửa sổ Chrome: đăng nhập, MỞ TRANG BÁO CÁO DOANH THU, chọn khoảng thời gian có số liệu.\n` +
      `   Bạn sẽ thấy dòng "[bắt được #...]" hiện ra ở đây mỗi khi trang tải dữ liệu.\n` +
      `   Khi bảng số liệu đã hiện đầy đủ, quay lại đây nhấn Enter... `
  )

  // Lưu toàn bộ ra file để Claude đọc trực tiếp
  const outDir = path.join(ENGINE_DIR, 'logs')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `discovery-${config.network_id}.json`)
  fs.writeFileSync(outPath, JSON.stringify(seen, null, 2))

  console.log(`\n===== ${seen.length} response JSON bắt được =====`)
  console.log(`Đã lưu đầy đủ vào: ${outPath}`)
  console.log(`Gửi Claude câu: "đã lưu discovery" là đủ (Claude tự đọc file).\n`)
  if (seen.length === 0) {
    console.log('KHÔNG bắt được response JSON nào từ *.blancvpn.com.')
    console.log('Thử: bấm nút lọc/đổi ngày trên trang báo cáo để ép trang gọi lại dữ liệu, rồi chạy lại discover.js.')
    console.log('Hoặc mở DevTools (F12) → Network → XHR để xem endpoint số liệu tên gì, gửi Claude.\n')
  }
  for (const { url, payload } of seen) {
    console.log('URL     :', url)
    console.log('SHAPE   :', shape(payload))
    console.log('---')
  }
  console.log('\nGửi toàn bộ đoạn trên (URL + SHAPE) cho Claude để dựng config.')
  console.log('Nếu cần chi tiết hơn, log đầy đủ đã lưu trong logs/. Đóng cửa sổ để kết thúc.\n')

  await context.close().catch(() => {})
}

main().catch((err) => { console.error(err.message); process.exit(1) })
