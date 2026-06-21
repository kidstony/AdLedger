'use client'

import { use } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MOCK_PROJECTS, MOCK_PNL_DAILY } from '@/lib/mock-data'
import ProfitChart from '@/components/project-detail/ProfitChart'
import { formatVNDFull, formatROI, getProfitTextClass, getRoiTextClass } from '@/lib/utils'

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const project = MOCK_PROJECTS.find(p => p.project_id === id)
  const daily = MOCK_PNL_DAILY.filter(d => d.project_id === id).slice(-30)

  const totalSpend = daily.reduce((s, d) => s + d.spend, 0)
  const totalRevenue = daily.reduce((s, d) => s + d.revenue, 0)
  const totalProfit = totalRevenue - totalSpend
  const roi = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Không tìm thấy dự án.</p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline mt-2 inline-block">← Quay lại</Link>
      </div>
    )
  }

  const stats = [
    { label: 'Tổng Chi phí', value: formatVNDFull(totalSpend), cls: 'text-slate-700' },
    { label: 'Tổng Doanh thu', value: formatVNDFull(totalRevenue), cls: 'text-blue-600' },
    { label: 'Lợi nhuận', value: formatVNDFull(totalProfit), cls: getProfitTextClass(totalProfit) },
    { label: 'ROI', value: formatROI(roi), cls: getRoiTextClass(roi) },
  ]

  return (
    <div className="p-6 space-y-5">
      <div>
        <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-3">
          <ArrowLeft size={14} /> Quay lại Dashboard
        </Link>
        <h2 className="text-xl font-semibold text-slate-800">{project.name}</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          CID: <span className="font-mono">{project.cid}</span> · MCC: {project.mcc_id} · {project.project_id}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">{s.label}</p>
            <p className={`text-lg font-semibold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700 mb-4">Biểu đồ P&L theo ngày (30 ngày gần nhất)</h3>
        <ProfitChart data={daily} />
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                {['Ngày', 'Chi phí', 'Doanh thu', 'Lợi nhuận', 'ROI%'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-right first:text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map(row => (
                <tr key={row.date} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-600 font-mono">{row.date}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{formatVNDFull(row.spend)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">{formatVNDFull(row.revenue)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-medium ${getProfitTextClass(row.profit)}`}>
                    {row.profit >= 0 ? '+' : ''}{formatVNDFull(row.profit)}
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
    </div>
  )
}
