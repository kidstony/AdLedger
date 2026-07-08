import { getSupabase } from './db.js'
import { log } from './logger.js'

// Fail → mở alert mới hoặc tăng đếm alert đang mở cùng (network, loại lỗi)
export async function openAlert(networkId, errorType, message, runId = null) {
  const supabase = getSupabase()
  try {
    const { data: existing, error: selErr } = await supabase
      .from('engine_alerts')
      .select('id, occurrences')
      .eq('network_id', networkId)
      .eq('error_type', errorType)
      .eq('status', 'open')
      .maybeSingle()
    if (selErr) throw selErr

    if (existing) {
      const { error } = await supabase
        .from('engine_alerts')
        .update({
          occurrences: existing.occurrences + 1,
          last_seen: new Date().toISOString(),
          message,
          last_run_id: runId,
        })
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('engine_alerts').insert({
        network_id: networkId,
        error_type: errorType,
        status: 'open',
        message,
        last_run_id: runId,
      })
      if (error) throw error
    }
  } catch (err) {
    // Ghi alert lỗi thì chỉ log — không được che lỗi gốc của run
    log.error(`Không ghi được engine_alerts: ${err.message}`, networkId)
  }
}

// Run thành công → đóng mọi alert đang mở của network (session/mapping/DB đều đã OK)
export async function closeAlerts(networkId) {
  const supabase = getSupabase()
  try {
    const { error } = await supabase
      .from('engine_alerts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('network_id', networkId)
      .eq('status', 'open')
    if (error) throw error
  } catch (err) {
    log.error(`Không đóng được engine_alerts: ${err.message}`, networkId)
  }
}
