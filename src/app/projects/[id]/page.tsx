'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Zap, Database } from 'lucide-react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import ProfitChart from '@/components/project-detail/ProfitChart'
import { formatVNDFull, formatROI, formatVND, getProfitTextClass, getRoiTextClass, cn } from '@/lib/utils'
import { PnlDaily } from '@/lib/types'

type RangeKey = '30d' | '90d' | '180d' | '365d'

const PRESETS: { key: RangeKey; label: string; days: number }[] = [
  { key: '30d',  label: '30 ngày', days: 30  },
  { key: '90d',  label: '3 tháng', days: 90  },
  { key: '180d', label: '6 tháng', days: 180 },
  { key: '365d', label: '1 năm',   days: 365 },
]

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { projects } = useProjectsContext()
  const project = projects.find(p => p.project_id === id)

  const [range, setRange] = useState<RangeKey>('30d')
  const [daily, setDaily] = useState<PnlDaily[]>([])
  const [screenByDate, setScreenByDate] = useState<Map<string, number>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [dataSource, setDataSource] = useState<'real' | 'mock'>('mock')

  useEffect(() => {
    if (projects.length === 0) return
    setIsLoading(true)

    const days = PRESETS.find(p => p.key === range)!.days
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (days - 1))
    const toStr = to.toISOString().split('T')[0]
    const fromStr = from.toISOString().split('T')[0]

    const spendPromise = project?.google_campaign_id
      ? supabase.from('ad_spend').select('date, spend').eq('campaign_id', project.google_campaign_id).gte('date', fromStr).lte('date', toStr)
      : Promise.resolve({ data: [] as { date: string; spend: number }[] })

    const revPromise = supabase
      .from('affiliate_revenue')
      .select('date, revenue, screen_revenue')
      .eq('project_id', id)
      .gte('date', fromStr)
      .lte('date', toStr)

    Promise.all([spendPromise, revPromise]).then(([spendRes, revRes]) => {
      const spendRows = (spendRes.data ?? []) as { date: string; spend: number }[]
      const revRows   = (revRes.data   ?? []) as { date: string; revenue: number; screen_revenue: number }[]

      if (spendRows.length === 0 && revRows.length === 0) {
        const mockDays = MOCK_PNL_DAILY.filter(d => d.project_id === id).slice(-days)
        setDaily(mockDays)
        setScreenByDate(new Map())
        setDataSource('mock')
      } else {
        const spendMap  = new Map(spendRows.map(r => [r.date, r.spend]))
        const revMap    = new Map(revRows.map(r => [r.date, r.revenue]))
        const screenMap = new Map(revRows.map(r => [r.date, r.screen_revenue ?? 0]))
        const dates = [...new Set([...spendMap.keys(), ...revMap.keys()])].sort()

        setDaily(dates.map(date => {
          const spend   = spendMap.get(date) ?? 0
          const revenue = revMap.get(date)   ?? 0
          return {
            project_id: id,
            cid: project?.cid ?? '',
            name: project?.name ?? id,
            date,
            spend,
            revenue,
            profit: revenue - spend,
            roi: spend > 0 ? ((revenue - spend) / spend) * 100 : 0,
          }
        }))
        setScreenByDate(screenMap)
        setDataSource('real')
      }
      setIsLoading(false)
    })
  }, [projects, project, id, range])

  const totalSpend   = daily.reduce((s, d) => s + d.spend,   0)
  const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0)
  const totalProfit  = totalRevenue - totalSpend
  const roi          = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0

  const stats = [
    { label: 'Tổng Chi phí',   value: formatVNDFull(totalSpend),   cls: 'text-slate-700' },
    { label: 'Tổng Doanh thu', value: formatVNDFull(totalRevenue), cls: 'text-blue-600' },
    { label: 'Lợi nhuận',      value: formatVNDFull(totalProfit),  cls: getProfitTextClass(totalProfit) },
    { label: 'ROI',             value: formatROI(roi),              cls: getRoiTextClass(roi) },
  ]

  const rangeLabel = PRESETS.find(p => p.key === range)!.label

  if (!project && !isLoading && projects.length > 0) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Không tìm thấy dự án.</p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← Quay lại</Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={14} /> Quay lại Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-800">
            {project?.name ?? id}
          </h2>
          {!isLoading && (
            dataSource === 'real' ? (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium border border-green-200">
                <Zap size={10} /> Chi phí thật
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-200">
                <Database size={10} /> Demo data
              </span>
            )
          )}
        </div>
        {project && (
          <p className="text-sm text-slate-500 mt-0.5">
            CID: <span className="font-mono">{project.cid}</span> · {project.project_id}
            {project.google_campaign_id && (
              <span className="ml-2">· Campaign: <span className="font-mono">{project.google_campaign_id}</span></span>
            )}
          </p>
        )}
      </div>

      {/* Stats cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
              <div className="h-3 w-24 bg-slate-200 rounded animate-pulse mb-3" />
              <div className="h-6 w-32 bg-slate-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {stats.map(s => (
            <div key={s.label} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{s.label}</p>
              <p className={`text-lg font-semibold ${s.cls}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-slate-700">
            Biểu đồ P&L ({rangeLabel} gần nhất)
          </h3>
          <div className="flex items-center gap-1">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setRange(p.key)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md font-medium transition-colors',
                  range === p.key
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="h-80 bg-slate-50 rounded animate-pulse" />
        ) : daily.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-16">Chưa có dữ liệu trong {rangeLabel} qua.</p>
        ) : (
          <ProfitChart data={daily} />
        )}
      </div>

      {/* Daily table */}
      {!isLoading && daily.length > 0 && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                <tr>
                  {['Ngày', 'Chi phí', 'Doanh thu', 'DT Màn hình', 'Lợi nhuận', 'ROI%'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...daily].reverse().map(row => (
                  <tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{row.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{formatVND(row.spend)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{formatVND(row.revenue)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-blue-500">
                      {(screenByDate.get(row.date) ?? 0) > 0
                        ? formatVND(screenByDate.get(row.date)!)
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-medium ${getProfitTextClass(row.profit)}`}>
                      {row.profit >= 0 ? '+' : ''}{formatVND(row.profit)}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs ${getRoiTextClass(row.roi)}`}>
                      {formatROI(row.roi)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
