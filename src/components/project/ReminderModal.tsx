'use client'

import { useState, useEffect } from 'react'
import { Bell, Trash2, X } from 'lucide-react'
import { ProjectReminder } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ReminderModalProps {
  projectId: string
  projectName: string
  onClose: () => void
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onReminderChange?: (projectId: string, hasActive: boolean) => void
}

export default function ReminderModal({ projectId, projectName, onClose, authFetch, onReminderChange }: ReminderModalProps) {
  const [reminders, setReminders] = useState<ProjectReminder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const now = new Date()
  now.setMinutes(now.getMinutes() + 30)
  const defaultDateTime = now.toISOString().slice(0, 16)

  const [form, setForm] = useState({
    date: defaultDateTime.slice(0, 10),
    time: defaultDateTime.slice(11, 16),
    repeat_type: 'none' as 'none' | 'daily' | 'weekly' | 'custom',
    repeat_days: 7,
    message: '',
    notify_inapp: true,
    notify_telegram: false,
  })

  useEffect(() => {
    authFetch(`/api/projects/${projectId}/reminder`)
      .then(r => r.json())
      .then(d => setReminders(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false))
  }, [projectId])

  async function handleSave() {
    setSaving(true)
    const remind_at = new Date(`${form.date}T${form.time}:00`).toISOString()
    const res = await authFetch(`/api/projects/${projectId}/reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        remind_at,
        repeat_type: form.repeat_type,
        repeat_days: form.repeat_type === 'custom' ? form.repeat_days : null,
        message: form.message || null,
        notify_inapp: form.notify_inapp,
        notify_telegram: form.notify_telegram,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      const next = [...reminders, created]
      setReminders(next)
      setForm(f => ({ ...f, message: '' }))
      onReminderChange?.(projectId, next.some(r => !r.is_triggered))
    }
    setSaving(false)
  }

  async function handleDelete(reminderId: string) {
    const res = await authFetch(`/api/projects/${projectId}/reminder`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminder_id: reminderId }),
    })
    if (res.ok) {
      const next = reminders.filter(r => r.id !== reminderId)
      setReminders(next)
      onReminderChange?.(projectId, next.some(r => !r.is_triggered))
    }
  }

  function formatDateTime(dt: string) {
    const d = new Date(dt)
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-amber-500" />
            <h3 className="font-semibold text-slate-800 text-sm">Nhắc nhở · {projectName}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        {/* Form đặt nhắc nhở mới */}
        <div className="space-y-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
          <p className="text-xs font-medium text-slate-600">Thêm nhắc nhở mới</p>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">Ngày</label>
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-blue-300" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Giờ</label>
              <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-blue-300" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Lặp lại</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['none','daily','weekly','custom'] as const).map(r => (
                <label key={r} className={cn(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-pointer text-xs transition-colors',
                  form.repeat_type === r ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-100 text-slate-600'
                )}>
                  <input type="radio" name="repeat" value={r} checked={form.repeat_type === r}
                    onChange={() => setForm(f => ({ ...f, repeat_type: r }))} className="accent-blue-600" />
                  {{ none: 'Không lặp', daily: 'Hàng ngày', weekly: 'Hàng tuần', custom: 'Tùy chỉnh' }[r]}
                </label>
              ))}
            </div>
            {form.repeat_type === 'custom' && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-slate-500">Mỗi</span>
                <input type="number" min={1} max={365} value={form.repeat_days}
                  onChange={e => setForm(f => ({ ...f, repeat_days: Number(e.target.value) }))}
                  className="w-16 px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300" />
                <span className="text-xs text-slate-500">ngày</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-slate-500 mb-1 block">Nội dung nhắc</label>
            <input value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              placeholder="vd: Kiểm tra CTR tuần này..."
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-blue-300" />
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.notify_inapp}
                onChange={e => setForm(f => ({ ...f, notify_inapp: e.target.checked }))}
                className="accent-blue-600" />
              <span className="text-xs text-slate-600">Trong app</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={form.notify_telegram}
                onChange={e => setForm(f => ({ ...f, notify_telegram: e.target.checked }))}
                className="accent-blue-600" />
              <span className="text-xs text-slate-600">Telegram</span>
            </label>
          </div>

          <Button onClick={handleSave} disabled={saving || !form.date} size="sm" className="w-full">
            {saving ? 'Đang lưu...' : 'Lưu nhắc nhở'}
          </Button>
        </div>

        {/* Danh sách nhắc nhở hiện có */}
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-2">Đang tải...</p>
        ) : reminders.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-2">Chưa có nhắc nhở nào</p>
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            <p className="text-xs font-medium text-slate-500">Đã đặt ({reminders.length})</p>
            {reminders.map(r => (
              <div key={r.id} className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-md border text-xs',
                r.is_triggered ? 'bg-slate-50 border-slate-100 text-slate-400' : 'bg-amber-50 border-amber-100'
              )}>
                <Bell size={11} className={r.is_triggered ? 'text-slate-400' : 'text-amber-500'} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{formatDateTime(r.remind_at)}</span>
                  {r.repeat_type !== 'none' && (
                    <span className="ml-1.5 text-slate-400">
                      · lặp {{ daily:'hàng ngày', weekly:'hàng tuần', custom:`mỗi ${r.repeat_days} ngày` }[r.repeat_type]}
                    </span>
                  )}
                  {r.message && <div className="truncate text-slate-500 mt-0.5">{r.message}</div>}
                </div>
                <button onClick={() => handleDelete(r.id)}
                  className="shrink-0 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
