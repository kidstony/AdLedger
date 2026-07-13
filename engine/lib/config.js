import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSupabase } from './db.js'

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

function validateMapping(file, mapping, kind = 'revenue') {
  // Report breakdown: chỉ bắt buộc revenue; date có thể suy từ dimensions.conversion_time
  // (kiểm ở validateReport); offer_name không bắt buộc (nhiều report chuyển đổi không có).
  const requiredFields = kind === 'breakdown' ? ['revenue'] : ['date', 'offer_name', 'revenue']
  for (const required of requiredFields) {
    if (!mapping[required]?.path) fail(file, `mapping.${required}.path là bắt buộc`)
  }
  for (const [field, spec] of Object.entries(mapping)) {
    if (field.startsWith('_')) continue // key chú thích
    if (typeof spec?.path !== 'string') fail(file, `mapping.${field}.path phải là chuỗi`)
  }
}

const DIMENSION_FIELDS = ['country', 'device', 'conversion_time', 'sub_id', 'transaction_id']
const NORMALIZERS = ['country', 'device']

// dimensions của report breakdown — mọi chiều đều TÙY CHỌN (network có gì lấy nấy).
function validateDimensions(file, report) {
  const dims = report.dimensions ?? {}
  for (const [field, spec] of Object.entries(dims)) {
    if (field.startsWith('_')) continue
    if (!DIMENSION_FIELDS.includes(field)) {
      fail(file, `report "${report.name ?? '?'}": dimensions.${field} không hỗ trợ (chỉ: ${DIMENSION_FIELDS.join(', ')})`)
    }
    if (typeof spec?.path !== 'string') {
      fail(file, `report "${report.name ?? '?'}": dimensions.${field}.path phải là chuỗi`)
    }
    if (spec.normalize && !NORMALIZERS.includes(spec.normalize)) {
      fail(file, `report "${report.name ?? '?'}": dimensions.${field}.normalize phải là ${NORMALIZERS.join('|')}`)
    }
  }
}

// Kiểm 1 report — throw khi lỗi (bên gọi bắt để BỎ report đó, không làm chết cả network).
function validateReport(file, report) {
  if (!report.url) fail(file, `report "${report.name ?? '?'}": thiếu url`)
  const isHtml = report.mode === 'html_table'
  if (!isHtml && !report.capture?.url_pattern) fail(file, `report "${report.name ?? '?'}": thiếu capture.url_pattern`)
  if (!isHtml && report.capture.pattern_type === 'regex') {
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
  validateMapping(file, report.mapping ?? {}, report.kind)
  if (report.kind === 'breakdown') {
    validateDimensions(file, report)
    // Ngày: mapping.date HOẶC dimensions.conversion_time HOẶC date_mode='window_end'
    // (nguồn tổng-theo-kỳ không có cột ngày → engine gán ngày = cuối cửa sổ sync).
    if (report.date_mode !== 'window_end' && !report.mapping?.date?.path && !report.dimensions?.conversion_time?.path) {
      fail(file, `report "${report.name ?? '?'}": breakdown cần mapping.date.path, dimensions.conversion_time.path, hoặc date_mode='window_end'`)
    }
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

  if (cfg.sub_id_parse?.pattern) {
    try {
      new RegExp(cfg.sub_id_parse.pattern)
    } catch {
      fail(file, `sub_id_parse.pattern không phải regex hợp lệ: ${cfg.sub_id_parse.pattern}`)
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

  // Kiểm TỪNG report: report lỗi (vd payout chưa chọn cột Ngày) bị BỎ chứ không làm chết cả network
  // (network vẫn sync các report hợp lệ còn lại). Chỉ fail khi KHÔNG report nào hợp lệ.
  const kept = []
  const skipped = []
  for (const report of cfg.reports) {
    try {
      validateReport(file, report)
      kept.push(report)
    } catch (e) {
      // kind: run-network lọc skip-alert theo pipeline (revenue vs breakdown) — không lẫn nhau.
      skipped.push({
        name: report.name ?? '?',
        kind: report.kind === 'breakdown' ? 'breakdown' : 'revenue',
        reason: String(e.message).replace(`Config ${file}: `, ''),
      })
    }
  }
  if (kept.length === 0) fail(file, `không report nào hợp lệ — ${skipped.map((s) => s.reason).join(' ;; ')}`)
  cfg.reports = kept
  cfg._skipped_reports = skipped // tầng chạy (run-network) dùng để mở cảnh báo hiện lên UI
}

function applyDefaults(cfg) {
  cfg.enabled = cfg.enabled !== false
  cfg.window_days = cfg.window_days ?? 7          // cửa sổ incremental (các lần sync sau)
  cfg.backfill_days = cfg.backfill_days ?? 1825   // lần đầu (account chưa có dữ liệu): kéo ~5 năm
  cfg.timezone = cfg.timezone ?? null
  cfg.fx_to_usd = cfg.fx_to_usd ?? 1
  cfg.fx_auto_from = cfg.fx_auto_from ?? null // có → lấy tỷ giá động, bỏ qua fx_to_usd
  cfg.sync_pnl = cfg.sync_pnl !== false
  cfg.login_check = cfg.login_check ?? { logged_out_url_patterns: [], logged_out_selectors: [] }
  cfg.login_check.logged_out_url_patterns = cfg.login_check.logged_out_url_patterns ?? []
  cfg.login_check.logged_out_selectors = cfg.login_check.logged_out_selectors ?? []
  cfg.project_mapping = cfg.project_mapping ?? {}
  cfg.project_mapping.rules = cfg.project_mapping.rules ?? []
  // Tách campaign_id từ sub_id (khi user truyền {campaignid} qua tracking link).
  // Mặc định: sub_id là campaign ID Google trần (8-12 chữ số).
  cfg.sub_id_parse = cfg.sub_id_parse ?? { pattern: '^(\\d{8,12})$', group: 1 }

  // Chuẩn hóa accounts: nhiều tài khoản cùng nền tảng (mỗi cái 1 profile + 1 project_id).
  // - Có accounts trong file → dùng.
  // - Vắng accounts nhưng có default_project_id → 1 account ngầm = network (hành vi cũ).
  // - Vắng cả hai (config kiểu template như tolt, account đến từ DB) → để [] và
  //   để loadAccounts (DB) cung cấp lúc chạy; tránh fail validate vì thiếu project_id.
  const rawAccounts = Array.isArray(cfg.accounts) && cfg.accounts.length > 0
    ? cfg.accounts
    : (cfg.project_mapping.default_project_id
        ? [{ id: cfg.network_id, label: cfg.network_name ?? cfg.network_id }]
        : [])
  cfg.accounts = rawAccounts.map((a) => ({
    id: a.id ?? cfg.network_id,
    label: a.label ?? a.id ?? cfg.network_name ?? cfg.network_id,
    // project_id gán riêng từng tài khoản; vắng thì rơi về default_project_id chung.
    project_id: a.project_id ?? cfg.project_mapping.default_project_id ?? null,
    dashboard_url: a.dashboard_url ?? null,
    login_url: a.login_url ?? null,
  }))

  cfg.reports = (cfg.reports ?? []).map((r, i) => {
    const report = { ...REPORT_DEFAULTS, ...r }
    report.name = report.name ?? `report_${i + 1}`
    report.mode = report.mode ?? 'xhr' // 'xhr' (hứng JSON) | 'html_table' (đọc bảng DOM)
    // 'revenue' (doanh thu/ngày → revenue_raw + P&L) | 'breakdown' (theo chiều quốc gia/
    // thiết bị/giờ/sub-id → revenue_breakdown, KHÔNG vào P&L). Config cũ không có kind → 'revenue'.
    report.kind = report.kind === 'breakdown' ? 'breakdown' : 'revenue'
    report.dimensions = report.kind === 'breakdown' && report.dimensions && typeof report.dimensions === 'object'
      ? report.dimensions
      : (report.kind === 'breakdown' ? {} : null)
    // Breakdown mặc định 'sum' (nguồn per-conversion cộng dồn); nguồn đã tổng hợp sẵn khai 'last'.
    if (report.kind === 'breakdown' && r.duplicate_strategy === undefined) report.duplicate_strategy = 'sum'
    // date_mode='window_end': nguồn tổng-theo-kỳ không có cột ngày → engine gán ngày = cuối cửa sổ sync.
    report.date_mode = report.date_mode === 'window_end' ? 'window_end' : null
    // per_day: report API trả tổng-theo-khoảng (không có cột ngày) → engine gọi date_from=date_to=từng
    // ngày để lấy dữ liệu THEO NGÀY (vd doanh thu quốc gia × ngày). Gán ngày truy vấn vào từng dòng.
    report.per_day = r.per_day === true
    // paginate: nguồn phân trang (vd customers page_size=50) → engine goto url với {page}=1,2,...
    // đến khi trang rỗng hoặc hết max_pages, gom hết dòng. Chỉ dùng cho mode xhr có {page} trong url.
    report.paginate = report.paginate && typeof report.paginate === 'object'
      ? { max_pages: Number(report.paginate.max_pages) > 0 ? Number(report.paginate.max_pages) : 10 }
      : null
    report.wait = { ...WAIT_DEFAULTS, ...report.wait }
    // Breakdown mặc định min_mapped_rows=0: cửa sổ không có chuyển đổi nào là hợp lệ.
    const vDefaults = report.kind === 'breakdown' ? { ...VALIDATION_DEFAULTS, min_mapped_rows: 0 } : VALIDATION_DEFAULTS
    report.validation = { ...vDefaults, ...report.validation }
    report.capture = { pattern_type: 'substring', methods: null, ...report.capture }
    report.request_override = report.request_override ?? null // ghi đè field ngày trong request (vd POST from/to)
    report.actions = Array.isArray(report.actions) ? report.actions : [] // thao tác trước khi đọc (vd click "Payment history")
    // Loại doanh thu report này ghi vào P&L: 'pending' (tiền màn hình/dashboard) | 'confirmed' (thực nhận/payout)
    report.revenue_type = report.revenue_type === 'confirmed' ? 'confirmed' : 'pending'
    if (report.mode === 'html_table' && (report.rows_path === undefined || report.rows_path === null)) report.rows_path = 'rows'
    report.mapping = report.mapping ?? {}
    return report
  })
  return cfg
}

// Đọc config thô từ file configs/ (bỏ file "_" trừ khi gọi đích danh networkId).
function readFileConfigsRaw(networkId) {
  if (!fs.existsSync(CONFIGS_DIR)) return []
  const files = fs
    .readdirSync(CONFIGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => (networkId ? true : !f.startsWith('_')))
    .sort()
  const out = []
  for (const file of files) {
    try {
      out.push({ src: file, raw: JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), 'utf8')) })
    } catch (err) {
      throw new Error(`Config ${file}: JSON không hợp lệ — ${err.message}`)
    }
  }
  return out
}

// Đọc config từ DB (engine_network_configs). Thiếu env/bảng → trả [] (fallback file).
// breakdown_enabled: cột riêng (bật/tắt pipeline tối ưu) — truyền ngoài blob, không ghi vào JSON.
// Cột chưa migrate (worker mới + DB cũ) → retry không có cột, mặc định bật — KHÔNG được để
// mất toàn bộ config DB chỉ vì thiếu 1 cột.
async function readDbConfigsRaw(networkId) {
  let sb
  try { sb = getSupabase() } catch { return [] }
  const query = (cols) => {
    let q = sb.from('engine_network_configs').select(cols)
    return networkId ? q.eq('network_id', networkId) : q
  }
  let { data, error } = await query('network_id, config, enabled, breakdown_enabled')
  if (error) ({ data, error } = await query('network_id, config, enabled'))
  if (error || !data) return []
  return data
    .filter((r) => r.enabled !== false && r.config)
    .map((r) => ({
      src: `DB:${r.network_id}`,
      raw: { ...r.config, network_id: r.config.network_id ?? r.network_id },
      breakdown_enabled: r.breakdown_enabled !== false, // cột thiếu → undefined → true
    }))
}

// Load config: DB trước (override), fallback file. networkId → chỉ config đó.
export async function loadConfigs(networkId = null) {
  const raws = [...readFileConfigsRaw(networkId), ...(await readDbConfigsRaw(networkId))] // DB sau → override file
  const byId = new Map()
  for (const { src, raw, breakdown_enabled } of raws) {
    const cfg = applyDefaults(raw)
    validateConfig(src, cfg)
    // Thuộc tính in-memory (cột DB, không nằm trong blob); config file → mặc định bật.
    cfg.breakdown_enabled = breakdown_enabled ?? true
    byId.set(cfg.network_id, cfg)
  }
  const configs = [...byId.values()]

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
