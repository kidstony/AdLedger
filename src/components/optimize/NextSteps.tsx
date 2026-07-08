'use client'

import { ListChecks } from 'lucide-react'
import type { OptimizationSuggestion, OptSuggestionType } from '@/lib/types'

// Nơi bấm trong Google Ads cho từng loại hành động — giúp người mới biết đi đâu.
const PLACE: Partial<Record<OptSuggestionType, string>> = {
  cut: 'Google Ads → Campaigns → Pause',
  scale: 'Google Ads → Campaign → Budget',
  raise_budget: 'Google Ads → Campaign → Budget',
  raise_bid: 'Google Ads → Bidding',
  lower_bid: 'Google Ads → Bidding / Keywords',
  add_negative: 'Google Ads → Keywords → Negative keywords',
  pause_keyword: 'Google Ads → Keywords',
  tighten_match: 'Google Ads → Keywords → sửa match type',
  harvest_keyword: 'Google Ads → Keywords → thêm [exact]',
  fix_creative: 'Google Ads → Ads',
  device_adjust: 'Google Ads → Devices (bid adjustment)',
  daypart: 'Google Ads → Ad schedule',
  fix_geo_setting: 'Google Ads → Settings → Locations → Location options',
  split_test: 'Google Ads → tạo campaign/ad group riêng',
  margin_alert: 'Theo dõi — chưa cần bấm gì',
}

export default function NextSteps({ suggestions }: { suggestions: OptimizationSuggestion[] }) {
  // Top 3 việc đáng làm (suggestions đã sắp theo mức độ + $ tác động).
  // Bỏ setup_tracking — là ghi chú nền, không phải việc bấm được hôm nay.
  const steps = suggestions.filter(s => s.type !== 'setup_tracking').slice(0, 3)
  if (steps.length === 0) return null

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 px-4 py-3">
      <div className="flex items-center gap-2">
        <ListChecks size={16} className="text-blue-700" />
        <h2 className="text-sm font-semibold text-blue-900">Làm gì tiếp theo — {steps.length} việc, theo thứ tự</h2>
      </div>
      <ol className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <div className="min-w-0 text-xs leading-relaxed">
              <span className="text-slate-700">{s.recommendedAction}</span>
              {PLACE[s.type] && (
                <span className="ml-1.5 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">
                  {PLACE[s.type]}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-[11px] text-blue-800/70">
        ⚠️ Mỗi lần chỉ đổi 1 thứ lớn, chờ 5–7 ngày dữ liệu chín rồi mới đánh giá — đổi nhiều thứ cùng lúc sẽ không biết cái nào có tác dụng.
      </p>
    </div>
  )
}
