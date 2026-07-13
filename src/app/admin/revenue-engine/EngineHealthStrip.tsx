'use client'

import { useState } from 'react'
import { Activity, AlertTriangle, WifiOff, HelpCircle } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import { type Settings, type WorkerState } from './shared'

interface Props {
  settings: Settings | null
  workerState: WorkerState
  workerAgeSec: number | null // tuổi heartbeat (giây) khi online
  onSaveSettings: (patch: Partial<Settings>) => void
  alertCount: number
  onShowAlerts: () => void
}

// Thanh sức khỏe engine — hiện ở MỌI tab: worker sống/chết, auto-sync, số cảnh báo.
export default function EngineHealthStrip({ settings, workerState, workerAgeSec, onSaveSettings, alertCount, onShowAlerts }: Props) {
  // null = chưa gõ gì → hiển thị giá trị từ settings; khác null = đang gõ dở.
  const [intervalInput, setIntervalInput] = useState<string | null>(null)
  const shownInterval = intervalInput ?? String(settings?.interval_hours ?? 6)

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
      {workerState === 'online' && (
        <StatusPill tone="green" icon={Activity}>
          Worker đang chạy{workerAgeSec != null ? ` · ${workerAgeSec}s trước` : ''}
        </StatusPill>
      )}
      {workerState === 'offline' && (
        <StatusPill tone="red" icon={WifiOff}>
          Worker offline — chạy <code className="font-mono">node engine/worker.js</code> trên máy engine
        </StatusPill>
      )}
      {workerState === 'unknown' && (
        <StatusPill tone="slate" icon={HelpCircle}>Worker: không rõ</StatusPill>
      )}

      {settings && (
        <>
          <span className="text-slate-300">·</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.auto_sync_enabled}
              onChange={e => onSaveSettings({ auto_sync_enabled: e.target.checked })}
              className="accent-indigo-600"
            />
            <span className="font-medium text-slate-700">Tự động đồng bộ</span>
          </label>
          <div className="flex items-center gap-1 text-slate-600">
            mỗi
            <input
              type="number" min={0.5} max={168} step={0.5} value={shownInterval}
              onChange={e => setIntervalInput(e.target.value)}
              onBlur={() => {
                const h = Number(shownInterval)
                if (Number.isFinite(h) && h !== settings.interval_hours) onSaveSettings({ interval_hours: h })
                setIntervalInput(null)
              }}
              className="w-16 border border-slate-200 rounded px-2 py-1 text-sm"
            />
            giờ
          </div>
          <span className="text-xs text-slate-400">
            Lần cuối: {settings.last_auto_sync_at ? new Date(settings.last_auto_sync_at).toLocaleString('vi-VN') : '—'}
          </span>
        </>
      )}

      {alertCount > 0 && (
        <button onClick={onShowAlerts} className="ml-auto" title="Xem chi tiết cảnh báo">
          <StatusPill tone="red" icon={AlertTriangle} className="cursor-pointer hover:bg-red-100 transition-colors">
            {alertCount} cảnh báo
          </StatusPill>
        </button>
      )}
    </div>
  )
}
