import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ENGINE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const CONFIGS_DIR = path.join(ENGINE_DIR, 'configs')
export const PROFILES_DIR = path.join(ENGINE_DIR, 'profiles')

const ERROR_TYPES = ['NO_CAPTURE', 'MAPPING_FAILED', 'DB_ERROR']
const MATCH_FIELDS = ['offer_id', 'offer_name']
const DUP_STRATEGIES = ['last', 'sum']
const WAIT_STRATEGIES = ['networkidle', 'fixed']

// Mặc định cho các key tùy chọn — merge vào config khi load
const REPORT_DEFAULTS = {
  url_date_format: 'YYYY-MM-DD',
  duplicate_strategy: 'last',
  wait: {},
  validation: {},
}
const WAIT_DEFAULTS = {
  strategy: 'networkidle',
  navigation_timeout_ms: 60000,
  post_load_wait_ms: 5000,
  capture_settle_ms: 3000,
}
const VALIDATION_DEFAULTS = {
  min_mapped_rows: 1,
  max_invalid_row_ratio: 0.2,
}

function fail(file, msg) {
  throw new Error(`Config ${file}: ${msg}`)
}

function validateMapping(file, mapping) {
  for (const required of ['date', 'offer_name', 'revenue']) {
    if (!mapping[required]?.path) fail(file, `mapping.${required}.path là bắt buộc`)
  }
  for (const [field, spec] of Object.entries(mapping)) {
    if (field.startsWith('_')) continue // key chú thích
    if (typeof spec?.path !== 'string') fail(file, `mapping.${field}.path phải là chuỗi`)
  }
}

function validateConfig(file, cfg) {
  if (!cfg.network_id || !/^[a-z0-9_-]+$/i.test(cfg.network_id)) {
    fail(file, 'network_id bắt buộc, chỉ gồm chữ/số/_/- (dùng làm tên thư mục profile)')
  }
  if (!Array.isArray(cfg.reports) || cfg.reports.length === 0) {
    fail(file, 'reports phải là mảng có ít nhất 1 phần tử')
  }

  // Mỗi account phải có id hợp lệ (dùng làm tên thư mục profile) + project_id đã resolve.
  const seenAcc = new Set()
  for (const acc of cfg.accounts ?? []) {
    if (!acc.id || !/^[a-z0-9_-]+$/i.test(acc.id)) {
      fail(file, `account.id bắt buộc, chỉ gồm chữ/số/_/- (dùng làm tên thư mục profile): "${acc.id}"`)
    }
    if (seenAcc.has(acc.id)) fail(file, `account.id trùng: "${acc.id}"`)
    seenAcc.add(acc.id)
    if (!acc.project_id) {
      fail(file, `account "${acc.id}": thiếu project_id (gán trong account hoặc project_mapping.default_project_id)`)
    }
  }

  const pm = cfg.project_mapping
  for (const rule of pm.rules ?? []) {
    if (!MATCH_FIELDS.includes(rule.match_field)) {
      fail(file, `project_mapping rule: match_field phải là ${MATCH_FIELDS.join('|')}`)
    }
    if (!rule.project_id) fail(file, 'project_mapping rule: thiếu project_id')
    try {
      new RegExp(rule.pattern)
    } catch {
      fail(file, `project_mapping rule: pattern không phải regex hợp lệ: ${rule.pattern}`)
    }
  }

  for (const report of cfg.reports) {
    if (!report.url) fail(file, `report "${report.name ?? '?'}": thiếu url`)
    if (!report.capture?.url_pattern) fail(file, `report "${report.name ?? '?'}": thiếu capture.url_pattern`)
    if (report.capture.pattern_type === 'regex') {
      try {
        new RegExp(report.capture.url_pattern)
      } catch {
        fail(file, `report "${report.name ?? '?'}": url_pattern không phải regex hợp lệ`)
      }
    }
    if (!WAIT_STRATEGIES.includes(report.wait.strategy)) {
      fail(file, `report "${report.name ?? '?'}": wait.strategy phải là ${WAIT_STRATEGIES.join('|')}`)
    }
    if (typeof report.rows_path !== 'string') {
      fail(file, `report "${report.name ?? '?'}": thiếu rows_path (chuỗi rỗng = response gốc đã là mảng)`)
    }
    if (!DUP_STRATEGIES.includes(report.duplicate_strategy)) {
      fail(file, `report "${report.name ?? '?'}": duplicate_strategy phải là ${DUP_STRATEGIES.join('|')}`)
    }
    validateMapping(file, report.mapping ?? {})
  }
}

function applyDefaults(cfg) {
  cfg.enabled = cfg.enabled !== false
  cfg.window_days = cfg.window_days ?? 30
  cfg.timezone = cfg.timezone ?? null
  cfg.fx_to_usd = cfg.fx_to_usd ?? 1
  cfg.fx_auto_from = cfg.fx_auto_from ?? null // có → lấy tỷ giá động, bỏ qua fx_to_usd
  cfg.sync_pnl = cfg.sync_pnl !== false
  cfg.login_check = cfg.login_check ?? { logged_out_url_patterns: [], logged_out_selectors: [] }
  cfg.login_check.logged_out_url_patterns = cfg.login_check.logged_out_url_patterns ?? []
  cfg.login_check.logged_out_selectors = cfg.login_check.logged_out_selectors ?? []
  cfg.project_mapping = cfg.project_mapping ?? {}
  cfg.project_mapping.rules = cfg.project_mapping.rules ?? []

  // Chuẩn hóa accounts: nhiều tài khoản cùng nền tảng (mỗi cái 1 profile + 1 project_id).
  // Vắng accounts → 1 account ngầm = chính network (giữ nguyên hành vi cũ).
  const rawAccounts = Array.isArray(cfg.accounts) && cfg.accounts.length > 0
    ? cfg.accounts
    : [{ id: cfg.network_id, label: cfg.network_name ?? cfg.network_id }]
  cfg.accounts = rawAccounts.map((a) => ({
    id: a.id ?? cfg.network_id,
    label: a.label ?? a.id ?? cfg.network_name ?? cfg.network_id,
    // project_id gán riêng từng tài khoản; vắng thì rơi về default_project_id chung.
    project_id: a.project_id ?? cfg.project_mapping.default_project_id ?? null,
  }))

  cfg.reports = (cfg.reports ?? []).map((r, i) => {
    const report = { ...REPORT_DEFAULTS, ...r }
    report.name = report.name ?? `report_${i + 1}`
    report.wait = { ...WAIT_DEFAULTS, ...report.wait }
    report.validation = { ...VALIDATION_DEFAULTS, ...report.validation }
    report.capture = { pattern_type: 'substring', methods: null, ...report.capture }
    report.mapping = report.mapping ?? {}
    return report
  })
  return cfg
}

// Load toàn bộ configs/ (bỏ file bắt đầu bằng "_" trừ khi được gọi đích danh).
// networkId truyền vào → chỉ load config đó (kể cả file "_...").
export function loadConfigs(networkId = null) {
  if (!fs.existsSync(CONFIGS_DIR)) throw new Error(`Không tìm thấy thư mục ${CONFIGS_DIR}`)

  const files = fs
    .readdirSync(CONFIGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => (networkId ? true : !f.startsWith('_')))
    .sort()

  const configs = []
  for (const file of files) {
    let cfg
    try {
      cfg = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8'))
    } catch (err) {
      throw new Error(`Config ${file}: JSON không hợp lệ — ${err.message}`)
    }
    cfg = applyDefaults(cfg)
    validateConfig(file, cfg)
    configs.push(cfg)
  }

  if (networkId) {
    const match = configs.filter((c) => c.network_id === networkId)
    if (match.length === 0) {
      const known = configs.map((c) => c.network_id).join(', ')
      throw new Error(`Không tìm thấy config cho network "${networkId}". Có: ${known || '(trống)'}`)
    }
    return match
  }
  return configs.filter((c) => c.enabled)
}
