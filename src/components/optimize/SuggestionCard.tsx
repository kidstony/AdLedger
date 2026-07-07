'use client'

import {
  TrendingUp, Scissors, Wallet, ArrowUpCircle, ArrowDownCircle,
  Ban, PauseCircle, Sparkles, AlertTriangle, MonitorSmartphone,
  CalendarClock, Target, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OptimizationSuggestion, OptSuggestionType, OptSeverity } from '@/lib/types'

const ICONS: Record<OptSuggestionType, LucideIcon> = {
  scale: TrendingUp,
  cut: Scissors,
  raise_budget: Wallet,
  raise_bid: ArrowUpCircle,
  lower_bid: ArrowDownCircle,
  add_negative: Ban,
  pause_keyword: PauseCircle,
  fix_creative: Sparkles,
  margin_alert: AlertTriangle,
  device_adjust: MonitorSmartphone,
  daypart: CalendarClock,
  setup_tracking: Target,
}

// Màu theo mức độ (bám DESIGN_SYSTEM: đỏ=nguy, amber=cần chú ý, slate=thông tin).
const SEV: Record<OptSeverity, { bar: string; icon: string; badge: string; label: string }> = {
  high:   { bar: 'bg-red-500',   icon: 'text-red-600 bg-red-50',     badge: 'bg-red-100 text-red-700',       label: 'Ưu tiên cao' },
  medium: { bar: 'bg-amber-500', icon: 'text-amber-600 bg-amber-50', badge: 'bg-amber-100 text-amber-700',   label: 'Trung bình' },
  low:    { bar: 'bg-slate-300', icon: 'text-slate-500 bg-slate-100', badge: 'bg-slate-100 text-slate-600',  label: 'Thấp' },
}

export default function SuggestionCard({ s }: { s: OptimizationSuggestion }) {
  const Icon = ICONS[s.type] ?? Target
  const sev = SEV[s.severity]

  return (
    <div className="relative flex gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5">
      <span className={cn('absolute left-0 top-0 h-full w-1', sev.bar)} />
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', sev.icon)}>
        <Icon size={18} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{s.title}</h3>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', sev.badge)}>{sev.label}</span>
          {s.confidence === 'roi' ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
              Dựa trên ROI thật
            </span>
          ) : (
            <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              Cần xem xét
            </span>
          )}
        </div>

        <p className="mt-1 text-xs leading-relaxed text-slate-600">{s.detail}</p>

        {s.evidence.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {s.evidence.map((e, i) => (
              <span key={i} className="inline-flex items-baseline gap-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] ring-1 ring-slate-200">
                <span className="text-slate-500">{e.metric}:</span>
                <span className="font-semibold text-slate-800">{e.value}</span>
              </span>
            ))}
          </div>
        )}

        <div className="mt-2.5 flex items-start gap-1.5 rounded-md bg-blue-50/60 px-2.5 py-1.5 text-xs text-blue-800">
          <Target size={13} className="mt-0.5 shrink-0" />
          <span><span className="font-medium">Nên làm:</span> {s.recommendedAction}</span>
        </div>
      </div>
    </div>
  )
}
