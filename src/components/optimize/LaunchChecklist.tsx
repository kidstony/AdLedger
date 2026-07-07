'use client'

import { useState } from 'react'
import { Rocket, CheckCircle2, AlertTriangle, Circle, Info } from 'lucide-react'
import { cn, formatVND } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { LaunchPlan } from '@/lib/types'

const STATUS_META = {
  pass: { icon: CheckCircle2, cls: 'text-green-600' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600' },
  todo: { icon: Circle, cls: 'text-slate-400' },
  info: { icon: Info, cls: 'text-slate-400' },
} as const

export default function LaunchChecklist({ plan, projectId, onSaved }: {
  plan: LaunchPlan
  projectId: string
  onSaved: () => void
}) {
  const [budgetInput, setBudgetInput] = useState(plan.testBudget != null ? String(plan.testBudget) : '')
  const [saving, setSaving] = useState(false)

  async function saveBudget() {
    const v = budgetInput.trim() === '' ? null : Number(budgetInput)
    if (v != null && (!Number.isFinite(v) || v < 0)) { toast.error('Ngân sách test không hợp lệ'); return }
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ test_budget: v }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(`Lưu thất bại: ${body?.error ?? res.status}`)
      } else {
        toast.success('Đã lưu ngân sách test')
        onSaved()
      }
    } catch {
      toast.error('Lỗi kết nối')
    } finally {
      setSaving(false)
    }
  }

  const budgetPct = plan.testBudget && plan.testBudget > 0
    ? Math.min(100, (plan.lifetimeSpend / plan.testBudget) * 100)
    : null

  return (
    <div className={cn('overflow-hidden rounded-xl border bg-white', plan.stopLossHit ? 'border-red-300' : 'border-slate-200')}>
      {/* Header giai đoạn */}
      <div className={cn('border-b px-4 py-3', plan.stopLossHit ? 'border-red-100 bg-red-50' : 'border-slate-100 bg-slate-50/60')}>
        <div className="flex flex-wrap items-center gap-2">
          <Rocket size={16} className={plan.stopLossHit ? 'text-red-600' : 'text-slate-600'} />
          <h3 className="text-sm font-semibold text-slate-800">
            Lộ trình test camp — Giai đoạn {plan.stage}/3: {plan.stageLabel}
          </h3>
          {plan.campAgeDays != null && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              camp ngày thứ {plan.campAgeDays + 1}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{plan.stageGuide}</p>
      </div>

      {/* Stop-loss */}
      <div className={cn('border-b px-4 py-3', plan.stopLossHit ? 'border-red-100 bg-red-50/60' : 'border-slate-100')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-600">Ngân sách test (stop-loss):</span>
          <input
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            placeholder="vd 50"
            inputMode="decimal"
            className="h-7 w-24 rounded-md border border-slate-300 px-2 text-right text-xs tabular-nums focus:border-slate-400 focus:outline-none"
          />
          <button
            onClick={saveBudget}
            disabled={saving}
            className="h-7 rounded-md bg-slate-800 px-2.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
          <span className="text-xs text-slate-500">
            Đã chi từ start camp: <b className="text-slate-800">{formatVND(plan.lifetimeSpend)}</b>
            {' · '}DT lũy kế: <b className={plan.lifetimeRevenue > 0 ? 'text-green-600' : 'text-red-600'}>{formatVND(plan.lifetimeRevenue)}</b>
          </span>
        </div>
        {budgetPct != null && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn('h-full rounded-full', budgetPct >= 100 ? 'bg-red-500' : budgetPct >= 80 ? 'bg-amber-500' : 'bg-green-500')}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
            {plan.stopLossHit && (
              <p className="mt-1.5 text-xs font-semibold text-red-600">
                ⛔ ĐÃ CHẠM STOP-LOSS mà chưa có doanh thu — dừng test, rà lại offer/keyword/landing.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Checklist */}
      <ul className="divide-y divide-slate-50 px-4 py-1">
        {plan.items.map(item => {
          const meta = STATUS_META[item.status]
          const Icon = meta.icon
          return (
            <li key={item.id} className="flex items-start gap-2.5 py-2">
              <Icon size={15} className={cn('mt-0.5 shrink-0', meta.cls)} />
              <div className="min-w-0">
                <p className={cn('text-xs font-medium', item.status === 'warn' ? 'text-amber-700' : 'text-slate-700')}>{item.label}</p>
                {item.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{item.detail}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
