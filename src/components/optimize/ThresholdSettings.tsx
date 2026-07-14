'use client'

import { useEffect, useState } from 'react'
import { RotateCcw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// Chỉnh ngưỡng Optimizer v2 từ UI (trước đây hardcode trong code, muốn đổi phải
// sửa file). Chỉ lưu phần KHÁC mặc định; nút ↺ trả 1 ngưỡng về mặc định.

interface ThresholdDef {
  key: string
  value: number
  label: string
  group: string
  min: number
  max: number
  step: number
  unit?: string
}

const GROUP_VI: Record<string, string> = {
  quyet_dinh: 'Ngưỡng ra quyết định (cắt / scale / bid)',
  du_lieu: 'Khi nào đủ dữ liệu để kết luận',
  dot_bien: 'Phát hiện đột biến trong ngày',
  trend: 'Phát hiện xuống dốc từ từ',
  tien_thuc: 'Tiền thực nhận & sự cố network',
  danh_gia: 'Đo kết quả sau khi áp dụng',
  phieu_test: 'Phiếu test',
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function ThresholdSettings() {
  const [open, setOpen] = useState(false)
  const [defs, setDefs] = useState<ThresholdDef[]>([])
  const [values, setValues] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const run = async () => {
      try {
        const res = await fetch('/api/optimize/settings', { headers: await authHeaders() })
        const json = await res.json()
        if (res.ok) {
          setDefs(json.definitions ?? [])
          setValues(json.effective ?? {})
        } else {
          toast.error(json.error ?? 'Không tải được cấu hình')
        }
      } catch {
        toast.error('Không tải được cấu hình')
      }
    }
    run()
  }, [open])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/optimize/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ thresholds: values }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Lỗi lưu'); return }
      toast.success('Đã lưu — lần phân tích tới sẽ dùng ngưỡng mới.')
      setOpen(false)
    } catch {
      toast.error('Lỗi kết nối')
    } finally {
      setSaving(false)
    }
  }

  const groups = [...new Set(defs.map(d => d.group))]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <Settings2 size={13} /> Ngưỡng phân tích
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ngưỡng phân tích & đề xuất</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-slate-500">
          Các con số quyết định khi nào hệ thống khuyên cắt/scale, khi nào coi là đột biến, tiêu chí thắng/thua của phiếu test…
          Giá trị khác mặc định được tô đậm; bấm ↺ để trả về mặc định.
        </p>
        {groups.map(g => (
          <section key={g} className="mt-2">
            <h4 className="mb-1.5 text-xs font-bold text-slate-600">{GROUP_VI[g] ?? g}</h4>
            <div className="space-y-1">
              {defs.filter(d => d.group === g).map(d => {
                const cur = values[d.key] ?? d.value
                const changed = cur !== d.value
                return (
                  <div key={d.key} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 text-xs text-slate-600">{d.label}</span>
                    <input
                      type="number"
                      min={d.min} max={d.max} step={d.step}
                      value={cur}
                      onChange={e => {
                        const v = Number(e.target.value)
                        if (Number.isFinite(v)) setValues(prev => ({ ...prev, [d.key]: v }))
                      }}
                      className={cn('h-7 w-24 rounded border px-2 text-right text-xs',
                        changed ? 'border-indigo-300 bg-indigo-50 font-semibold text-indigo-800' : 'border-slate-300 text-slate-700')}
                    />
                    <span className="w-10 text-[10px] text-slate-400">{d.unit ?? ''}</span>
                    <button
                      onClick={() => setValues(prev => ({ ...prev, [d.key]: d.value }))}
                      title={`Về mặc định (${d.value})`}
                      className={cn('text-slate-300 hover:text-slate-600', changed && 'text-indigo-400')}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            Hủy
          </button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {saving ? 'Đang lưu…' : 'Lưu ngưỡng'}
          </button>
        </div>
      </DialogContent>
      </Dialog>
    </>
  )
}
