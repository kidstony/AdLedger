'use client'

import { Smartphone, Monitor, Tablet, Layers, Calendar, Percent, type LucideIcon } from 'lucide-react'
import { Project } from '@/lib/types'

interface BadgeInfo {
  label: string
  title: string
  Icon: LucideIcon
}

const ddmm = (d?: string | null) => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')

// Tóm tắt attribution rule của một dự án thành badge. Trả null cho mặc định
// ('campaign' / chưa đặt) → không hiển thị badge để tránh rối.
export function attributionBadgeInfo(p: Project): BadgeInfo | null {
  const type = p.attribution_type ?? 'campaign'
  switch (type) {
    case 'device': {
      const dev = p.attribution_device
      if (dev === 'MOBILE')  return { label: 'Mobile', title: 'Tách chi phí QC theo thiết bị: Mobile', Icon: Smartphone }
      if (dev === 'DESKTOP') return { label: 'PC',     title: 'Tách chi phí QC theo thiết bị: Desktop (PC)', Icon: Monitor }
      if (dev === 'TABLET')  return { label: 'Tablet', title: 'Tách chi phí QC theo thiết bị: Tablet', Icon: Tablet }
      return { label: 'Theo thiết bị', title: 'Tách chi phí QC theo thiết bị (chưa chọn thiết bị)', Icon: Smartphone }
    }
    case 'ad_group':
      return {
        label: 'Ad group',
        title: `Tách chi phí QC theo ad group${p.attribution_ad_group_id ? `: ${p.attribution_ad_group_id}` : ' (chưa nhập ID)'}`,
        Icon: Layers,
      }
    case 'date_window': {
      const from = ddmm(p.attribution_from)
      const to   = ddmm(p.attribution_to)
      const range = from || to ? `${from || '…'}–${to || '…'}` : 'Khoảng ngày'
      return { label: range, title: `Tách chi phí QC theo khoảng thời gian: ${range}`, Icon: Calendar }
    }
    case 'manual_pct': {
      const w = p.attribution_weight
      const label = w != null ? `${w}%` : 'Chia %'
      return { label, title: `Tách chi phí QC chia theo trọng số${w != null ? `: ${w}%` : ''}`, Icon: Percent }
    }
    default:
      return null
  }
}

export default function AttributionBadge({ project, className }: { project: Project; className?: string }) {
  const info = attributionBadgeInfo(project)
  if (!info) return null
  const { label, title, Icon } = info
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100 whitespace-nowrap ${className ?? ''}`}
    >
      <Icon size={10} />
      {label}
    </span>
  )
}
