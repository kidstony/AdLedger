'use client'

import { useCallback, useEffect, useState } from 'react'
import { BellOff, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { countryNameByGeoId } from '@/lib/geo-targets'

// Dòng thời gian "chỉ số bất thường" của camp (Optimizer v2) — engine phát hiện
// bằng cách so với nền 28 ngày (có tính thứ trong tuần), kèm phát hiện
// "xuống dốc từ từ" nhiều tuần mà so-sánh-tuần-trước không thấy.

interface AnomalyRow {
  id: string
  metric: string
  dimension: Record<string, string> | null
  direction: 'up' | 'down'
  severity: 'warn' | 'high'
  value: number
  baseline: number
  zscore: number | null
  window: Record<string, unknown> | null
  state: string
  detected_at: string
}

const fmtUsd = (n: number) => '$' + n.toFixed(2)

function describe(a: AnomalyRow): string {
  const day = (a.window as { date?: string } | null)?.date ?? ''
  switch (a.metric) {
    case 'cpc': return `Giá click ${fmtUsd(a.value)} (bình thường ~${fmtUsd(a.baseline)}) — ngày ${day}`
    case 'ctr': return `Tỷ lệ bấm ${a.value.toFixed(2)}% (bình thường ~${a.baseline.toFixed(2)}%) — ngày ${day}`
    case 'spend': return `Chi phí ${fmtUsd(a.value)} (bình thường ~${fmtUsd(a.baseline)}/ngày) — ngày ${day}`
    case 'revenue': return `Doanh thu ${fmtUsd(a.value)} (bình thường ~${fmtUsd(a.baseline)}/ngày) — ngày ${day}`
    case 'roi': return `Lãi/lỗ ${a.value.toFixed(0)}% (bình thường ~${a.baseline.toFixed(0)}%) — ngày ${day}`
    case 'is_lost_budget': return `Mất ${a.value.toFixed(0)}% hiển thị vì hết ngân sách (bình thường ~${a.baseline.toFixed(0)}%)`
    case 'geo_revenue': {
      const geo = a.dimension?.geo ?? ''
      const name = countryNameByGeoId(geo) ?? geo
      return a.baseline > 0
        ? `Nước ${name} mang về ${fmtUsd(a.value)} — gấp ${(a.value / a.baseline).toFixed(1)}× bình thường`
        : `Nước MỚI ${name} mang về ${fmtUsd(a.value)}`
    }
    case 'offer_revenue':
      return a.baseline > 0
        ? `Offer "${a.dimension?.offer}" mang về ${fmtUsd(a.value)} — gấp ${(a.value / a.baseline).toFixed(1)}× bình thường`
        : `Offer MỚI "${a.dimension?.offer}" mang về ${fmtUsd(a.value)}`
    case 'cpc_trend': return `Giá click bò dần lên +${a.value.toFixed(0)}% trong ${(a.window as { window_days?: number } | null)?.window_days ?? '?'} ngày`
    case 'revenue_trend': return `Doanh thu nguội dần ${a.value.toFixed(0)}% trong ${(a.window as { window_days?: number } | null)?.window_days ?? '?'} ngày`
    case 'roi_trend': return `Lãi trượt dần ${a.value.toFixed(0)} điểm % trong ${(a.window as { window_days?: number } | null)?.window_days ?? '?'} ngày`
    case 'confirm_rate': return `Kỳ thanh toán mới network chỉ thực trả ${a.value.toFixed(0)}% tiền màn hình (các kỳ trước ~${a.baseline.toFixed(0)}%)`
    case 'network_outage': return `Nghi mất kết nối network "${a.dimension?.network}" — doanh thu về 0 trong khi vẫn có click`
    default: return `${a.metric}: ${a.value}`
  }
}

const METRIC_ICON: Record<string, string> = {
  cpc: '🔺', ctr: '🔻', spend: '💸', revenue: '📉', roi: '⚠️', is_lost_budget: '⏳',
  geo_revenue: '🌍', offer_revenue: '🎯', cpc_trend: '🐢', revenue_trend: '🐢',
  roi_trend: '🐢', confirm_rate: '🏦', network_outage: '🔌',
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function AnomalyFeed({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [rows, setRows] = useState<AnomalyRow[] | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch(`/api/optimize/anomalies?project_id=${encodeURIComponent(projectId)}`, { headers: await authHeaders() })
        const json = await res.json()
        if (!cancelled && res.ok) setRows(json.anomalies ?? [])
      } catch { /* im lặng — feed phụ */ }
    }
    run()
    return () => { cancelled = true }
  }, [projectId, refreshKey])

  const mute = async (id: string) => {
    try {
      const res = await fetch('/api/optimize/anomalies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ id, action: 'mute' }),
      })
      if (res.ok) { toast.success('Đã tắt cảnh báo này.'); load() }
    } catch { toast.error('Lỗi kết nối') }
  }

  if (rows == null) return null
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-400">
        Không có chỉ số bất thường nào đang mở.
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {rows.map(a => (
        <div
          key={a.id}
          className={cn('flex items-start gap-2 rounded-lg border px-3 py-2',
            a.severity === 'high' ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60')}
        >
          <span className="mt-0.5 text-sm leading-none">{METRIC_ICON[a.metric] ?? '⚡'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-700">{describe(a)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Phát hiện {new Date(a.detected_at).toLocaleString('vi-VN')}
              {a.zscore != null && ` · độ lệch z=${a.zscore.toFixed(1)}`}
            </p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold',
            a.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>
            {a.severity === 'high' ? 'Nghiêm trọng' : 'Cảnh báo'}
          </span>
          {canManage && (
            <button onClick={() => mute(a.id)} title="Tắt cảnh báo này" className="text-slate-400 hover:text-slate-600">
              <BellOff size={13} />
            </button>
          )}
        </div>
      ))}
      <p className="flex items-center gap-1 pt-1 text-[10px] text-slate-400">
        <Zap size={11} /> So với nền 28 ngày gần nhất (có tính thứ trong tuần). Cảnh báo nghiêm trọng được gửi qua Telegram nếu đã cấu hình bot.
      </p>
    </div>
  )
}
