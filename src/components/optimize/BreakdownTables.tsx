'use client'

import { formatVND } from '@/lib/utils'
import { countryNameByGeoId } from '@/lib/geo-targets'
import type { KeywordAgg, SearchTermAgg, SegmentAgg, SegmentType } from '@/lib/types'

const intFmt = new Intl.NumberFormat('en-US')
const fmtCount = (n: number) => intFmt.format(Math.round(n))

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function TableCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-400">{hint}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

const SEG_LABEL: Record<SegmentType, string> = { device: 'Thiết bị', hour: 'Khung giờ', geo: 'Vị trí (quốc gia)' }

function SegValueCell({ s }: { s: SegmentAgg }) {
  if (s.segment_type === 'hour') return <>{s.segment_value}h</>
  if (s.segment_type === 'geo') {
    const name = countryNameByGeoId(s.segment_value)
    return name
      ? <>{name} <span className="text-[10px] text-slate-300">#{s.segment_value}</span></>
      : <>Không rõ <span className="text-[10px] text-slate-300">#{s.segment_value}</span></>
  }
  return <>{s.segment_value}</>
}

function SegmentTable({ type, rows }: { type: SegmentType; rows: SegmentAgg[] }) {
  if (rows.length === 0) return null
  return (
    <TableCard title={SEG_LABEL[type]} hint="Phân khúc chi phí cao + CTR thấp → cân nhắc điều chỉnh bid / lịch / loại trừ.">
      <table className="w-full text-xs">
        <thead className="bg-slate-50">
          <tr><Th>{SEG_LABEL[type]}</Th><Th right>Hiển thị</Th><Th right>Click</Th><Th right>CTR</Th><Th right>Chi phí</Th></tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((s, i) => {
            const wasteful = s.clicks === 0 && s.cost > 0
            return (
              <tr key={i} className={wasteful ? 'bg-amber-50/50' : ''}>
                <td className="px-3 py-2 text-slate-700"><SegValueCell s={s} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(s.impressions)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(s.clicks)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">{s.ctr.toFixed(1)}%</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{formatVND(s.cost)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableCard>
  )
}

export default function BreakdownTables({ keywords, searchTerms, segments }: {
  keywords: KeywordAgg[]
  searchTerms: SearchTermAgg[]
  segments: SegmentAgg[]
}) {
  const devices = segments.filter(s => s.segment_type === 'device')
  const hours = segments.filter(s => s.segment_type === 'hour')
  const geos = segments.filter(s => s.segment_type === 'geo')

  if (keywords.length === 0 && searchTerms.length === 0 && segments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-400">
        Chưa có số liệu keyword / search term / phân khúc. Chạy script &ldquo;Hàng ngày&rdquo; bản mới để đồng bộ (không có ở tab Lịch sử).
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {searchTerms.length > 0 && (
        <TableCard title="Search term theo chi phí" hint="Truy vấn tốn chi phí mà CTR thấp / không click → ứng viên negative keyword.">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <Th>Truy vấn</Th><Th right>Hiển thị</Th><Th right>Click</Th><Th right>CTR</Th><Th right>Chi phí</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {searchTerms.map((t, i) => {
                const wasteful = t.clicks === 0 && t.cost > 0
                return (
                  <tr key={i} className={wasteful ? 'bg-amber-50/50' : ''}>
                    <td className="max-w-[240px] truncate px-3 py-2 text-slate-700" title={t.search_term}>{t.search_term}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(t.impressions)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(t.clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{t.ctr.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{formatVND(t.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {keywords.length > 0 && (
        <TableCard title="Keyword theo chi phí" hint="Chi phí cao + CTR thấp / Quality Score kém → cân nhắc tắt hoặc giảm bid.">
          <table className="w-full text-xs">
            <thead className="bg-slate-50">
              <tr>
                <Th>Keyword</Th><Th>Match</Th><Th right>Hiển thị</Th><Th right>Click</Th><Th right>CTR</Th><Th right>CPC</Th><Th right>QS</Th><Th right>Chi phí</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {keywords.map((k, i) => {
                const wasteful = k.clicks === 0 && k.cost > 0
                return (
                  <tr key={i} className={wasteful ? 'bg-amber-50/50' : ''}>
                    <td className="max-w-[200px] truncate px-3 py-2 text-slate-700" title={k.keyword_text}>{k.keyword_text || '(?)'}</td>
                    <td className="px-3 py-2 text-slate-400">{k.match_type}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(k.impressions)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{fmtCount(k.clicks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{k.ctr.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{formatVND(k.avgCpc)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{k.quality_score ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">{formatVND(k.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      <SegmentTable type="device" rows={devices} />
      <SegmentTable type="hour" rows={hours} />
      <SegmentTable type="geo" rows={geos} />
    </div>
  )
}
