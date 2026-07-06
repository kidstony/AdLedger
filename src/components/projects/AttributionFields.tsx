'use client'

import { Input } from '@/components/ui/input'
import { AttributionType, AdDevice, Project } from '@/lib/types'

export type AttributionValue = Pick<
  Project,
  | 'attribution_type'
  | 'attribution_device'
  | 'attribution_ad_group_id'
  | 'attribution_from'
  | 'attribution_to'
  | 'attribution_weight'
>

interface Props {
  value: AttributionValue
  onChange: (patch: Partial<Project>) => void
  disabled?: boolean
}

const SELECT_CLS =
  'w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 bg-white disabled:opacity-60 disabled:cursor-not-allowed'

// Ô chọn "Tách chi phí QC (nhiều ref chung campaign)" — dùng chung cho cả form
// tạo/sửa dự án lẫn drawer chi tiết. Đổi kiểu quy chi phí sẽ reset các field phụ
// về null để không còn giá trị cũ lạc.
export default function AttributionFields({ value, onChange, disabled }: Props) {
  const type = value.attribution_type ?? 'campaign'

  function handleTypeChange(next: AttributionType) {
    onChange({
      attribution_type: next,
      attribution_device: null,
      attribution_ad_group_id: null,
      attribution_from: null,
      attribution_to: null,
      attribution_weight: null,
    })
  }

  return (
    <div className="border border-slate-100 rounded-lg p-3 space-y-3 bg-slate-50">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tách chi phí QC (nhiều ref chung campaign)</p>
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600">Cách quy chi phí</label>
        <select value={type} disabled={disabled}
          onChange={e => handleTypeChange(e.target.value as AttributionType)}
          className={SELECT_CLS}>
          <option value="campaign">Cả campaign (mặc định)</option>
          <option value="device">Theo thiết bị (mobile / PC)</option>
          <option value="ad_group">Theo ad group</option>
          <option value="date_window">Theo khoảng thời gian</option>
          <option value="manual_pct">Chia tay theo %</option>
        </select>
      </div>

      {type === 'device' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Thiết bị</label>
          <select value={value.attribution_device ?? ''} disabled={disabled}
            onChange={e => onChange({ attribution_device: (e.target.value || null) as AdDevice | null })}
            className={SELECT_CLS}>
            <option value="">— Chọn thiết bị —</option>
            <option value="MOBILE">Mobile</option>
            <option value="DESKTOP">Desktop (PC)</option>
            <option value="TABLET">Tablet</option>
          </select>
        </div>
      )}

      {type === 'ad_group' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Ad group ID</label>
          <Input value={value.attribution_ad_group_id ?? ''} placeholder="vd: 123456789" disabled={disabled}
            onChange={e => onChange({ attribution_ad_group_id: e.target.value || null })} />
        </div>
      )}

      {type === 'date_window' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Từ ngày</label>
            <input type="date" value={value.attribution_from ?? ''} disabled={disabled}
              onChange={e => onChange({ attribution_from: e.target.value || null })}
              className={SELECT_CLS} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Đến ngày</label>
            <input type="date" value={value.attribution_to ?? ''} disabled={disabled}
              onChange={e => onChange({ attribution_to: e.target.value || null })}
              className={SELECT_CLS} />
          </div>
        </div>
      )}

      {type === 'manual_pct' && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600">Trọng số (%)</label>
          <Input type="number" value={value.attribution_weight ?? ''} placeholder="vd: 60" disabled={disabled}
            onChange={e => onChange({ attribution_weight: e.target.value === '' ? null : Number(e.target.value) })} />
          <p className="text-[11px] text-slate-400">Chi phí chung được chia theo tỷ lệ trọng số giữa các ref chung campaign.</p>
        </div>
      )}
    </div>
  )
}
