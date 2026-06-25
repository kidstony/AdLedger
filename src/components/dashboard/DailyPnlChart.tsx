'use client'

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts'

interface DayPoint { date: string; spend: number; revenue: number; profit: number }

interface Props { data: DayPoint[] }

function fmt(v: number) {
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(1) + 'K'
  return '$' + v.toFixed(0)
}

function fmtDate(d: string) {
  const [, m, day] = d.split('-')
  return `${day}/${m}`
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; color: string; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs">
      <p className="font-medium text-slate-600 mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono font-medium" style={{ color: p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

export default function DailyPnlChart({ data }: Props) {
  if (!data.length) return null

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-xs font-medium text-slate-500 mb-3 uppercase tracking-wide">Trend lãi / lỗ theo ngày</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={52} />
          <ReferenceLine y={0} stroke="#e2e8f0" />
          <Tooltip content={<CustomTooltip />} />
          <Line name="Chi phí" type="monotone" dataKey="spend" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
          <Line name="Doanh thu" type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} />
          <Line name="Lợi nhuận" type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2} dot={false}
            activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 justify-end">
        {[['Chi phí', '#94a3b8'], ['Doanh thu', '#3b82f6'], ['Lợi nhuận', '#22c55e']].map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
            <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
