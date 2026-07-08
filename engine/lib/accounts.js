import { getSupabase } from './db.js'
import { log } from './logger.js'

// Nạp danh sách tài khoản của 1 network từ DB (engine_accounts, enabled=true).
// Nguồn sự thật là DB (quản lý qua UI). Fallback: config.accounts (JSON) rồi account
// ngầm = network_id — giữ chạy được cả khi DB chưa có bản ghi.
export async function loadAccounts(config) {
  const networkId = config.network_id
  try {
    const { data, error } = await getSupabase()
      .from('engine_accounts')
      .select('account_id, label, project_id, enabled')
      .eq('network_id', networkId)
      .eq('enabled', true)
      .order('account_id')
    if (error) throw new Error(error.message)

    if (data && data.length > 0) {
      return data.map((a) => ({
        id: a.account_id,
        label: a.label || a.account_id,
        project_id: a.project_id ?? config.project_mapping.default_project_id ?? null,
      }))
    }
    log.warn(`engine_accounts trống cho "${networkId}" — dùng accounts trong file config`, networkId)
  } catch (err) {
    log.warn(`Không đọc được engine_accounts (${err.message}) — dùng accounts trong file config`, networkId)
  }
  // Fallback: accounts đã chuẩn hóa sẵn trong config (config.js:applyDefaults)
  return config.accounts
}
