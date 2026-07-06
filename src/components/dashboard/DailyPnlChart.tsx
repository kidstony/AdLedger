'use client'

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, Legend, ResponsiveContainer,
} from 'recharts'
import { DailyPnlRow } from '@/lib/types'
import { formatVND } from '@/lib/utils'

interface Props { data: DailyPnlRow[]; view: 'screen' | 'confirmed' }

function fmtDate(d: string) {
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-lg text-xs space-y-1">
      <p className="font-medium text-slate-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatVND(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function DailyPnlChart({ data, view }: Props) {
  if (!data.length) return null

  const isScreen = view === 'screen'
  // Screen view: amber revenue/profit (estimate). Confirmed view: blue revenue, green profit.
  const revenueColor = isScreen ? '#f59e0b' : '#60a5fa'
  const profitColor  = isScreen ? '#f59e0b' : '#22c55e'
  const revenueLabel = isScreen ? 'DT Màn hình' : 'Doanh thu'

  const chartData = data.map(d => ({
    date: fmtDate(d.date),
    'Chi phí': d.cost,
    [revenueLabel]: isScreen ? d.screenRevenue : d.revenue,
    'Lợi nhuận': isScreen ? d.screenProfit : d.profit,
  }))

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
      <h3 className="text-sm font-medium text-slate-700 mb-4">Biểu đồ P&L</h3>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
          <YAxis
            tickFormatter={v => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + v.toFixed(0)}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <ReferenceLine y={0} stroke="#cbd5e1" strokeDasharray="4 4" />
          <Bar dataKey="Chi phí" fill="#94a3b8" radius={[2, 2, 0, 0]} barSize={8} />
          <Bar dataKey={revenueLabel} fill={revenueColor} radius={[2, 2, 0, 0]} barSize={8} />
          <Line
            type="monotone"
            dataKey="Lợi nhuận"
            stroke={profitColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
