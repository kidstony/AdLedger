'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Loader2, Wand2, Save } from 'lucide-react'

const CMD_API = '/api/admin/revenue-engine/commands'
const CFG_API = '/api/admin/revenue-engine/network-config'

interface Detect {
  draft: Record<string, unknown> | null
  preview: { date: string; revenue: number }[]
  fields: string[]
  chosen: { url: string; rows_path: string; date_field: string | null; revenue_field: string | null; currency_field: string | null } | null
  candidates: { url: string; rows_path: string; rows: number; hasDate: boolean; hasRevenue: boolean; date_field?: string | null; revenue_field?: string | null; currency?: string }[]
  noAuto?: boolean
  capturedSummary?: { url: string; shape: string }[]
  warnings?: string[]
}

interface Props {
  networkId: string
  networkName: string
  accountId: string
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onClose: () => void
  onSaved: () => void
}

export default function NetworkConfigPanel({ networkId, networkName, accountId, authFetch, onClose, onSaved }: Props) {
  const [phase, setPhase] = useState<'loading' | 'need-discover' | 'discovering' | 'ready' | 'saving'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [det, setDet] = useState<Detect | null>(null)
  const [sel, setSel] = useState<Detect['chosen'] | null>(null)
  const [discoverCmdId, setDiscoverCmdId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const runDetect = useCallback(async (override?: Record<string, unknown>) => {
    const res = await authFetch(`${CFG_API}/detect`, { method: 'POST', body: JSON.stringify({ network_id: networkId, override }) })
    if (res.status === 404) { setPhase('need-discover'); return }
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi phân tích'); setPhase('need-discover'); return }
    const d: Detect = await res.json()
    setDet(d); setSel(d.chosen); setPhase('ready'); setError(null)
  }, [authFetch, networkId])

  useEffect(() => { runDetect() }, [runDetect])
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startDiscover = async () => {
    setError(null); setPhase('discovering')
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type: 'discover', account_id: accountId }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh dò'); setPhase('need-discover'); return }
    const { command } = await res.json()
    setDiscoverCmdId(command.id)
    setAnalyzing(false)
    // Poll đến khi lệnh xong
    pollRef.current = setInterval(async () => {
      const r = await authFetch(CMD_API)
      if (!r.ok) return
      const { commands } = await r.json()
      const c = commands.find((x: { id: string }) => x.id === command.id)
      if (c && (c.status === 'done' || c.status === 'error')) {
        if (pollRef.current) clearInterval(pollRef.current)
        if (c.status === 'error') { setError(c.message ?? 'Dò thất bại'); setPhase('need-discover'); return }
        setPhase('loading'); runDetect()
      }
    }, 4000)
  }

  const signalAnalyze = async () => {
    if (!discoverCmdId) return
    setAnalyzing(true)
    await authFetch(CMD_API, { method: 'PATCH', body: JSON.stringify({ id: discoverCmdId, signal: 'analyze' }) })
  }

  // Loại doanh thu report này ghi vào P&L: 'pending' (tiền màn hình) | 'confirmed' (thực nhận/payout)
  const [revenueType, setRevenueType] = useState<'pending' | 'confirmed'>('pending')

  const override = (patch: Partial<Detect['chosen']>, type = revenueType) => {
    if (!sel) return
    const next = { ...sel, ...patch }
    setSel(next)
    setPhase('loading')
    runDetect({ url: next.url, rows_path: next.rows_path, date_field: next.date_field, revenue_field: next.revenue_field, currency_field: next.currency_field, revenue_type: type })
  }

  const changeRevenueType = (type: 'pending' | 'confirmed') => {
    setRevenueType(type)
    if (sel) { setPhase('loading'); runDetect({ url: sel.url, rows_path: sel.rows_path, date_field: sel.date_field, revenue_field: sel.revenue_field, currency_field: sel.currency_field, revenue_type: type }) }
  }

  const save = async () => {
    if (!det) return
    setPhase('saving'); setError(null)
    const res = await authFetch(CFG_API, { method: 'PUT', body: JSON.stringify({ network_id: networkId, config: det.draft }) })
    setPhase('ready')
    if (res.ok) onSaved()
    else setError((await res.json().catch(() => ({}))).error ?? 'Lỗi lưu cấu hình')
  }

  const total = det?.preview.reduce((s, p) => s + p.revenue, 0) ?? 0

  return (
    <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <div className="font-medium text-slate-800 flex items-center gap-2"><Wand2 size={16} className="text-indigo-600" /> Cấu hình tự động — {networkName}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {phase === 'loading' && <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Đang phân tích…</div>}

          {phase === 'need-discover' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Chưa có dữ liệu dò cho network này. Bấm nút dưới → cửa sổ Chrome mở trên máy worker → <b>đăng nhập + mở trang báo cáo doanh thu</b>. Engine tự bắt dữ liệu.</p>
              <button onClick={startDiscover} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"><Wand2 size={15} /> Dò dữ liệu (đăng nhập)</button>
            </div>
          )}

          {phase === 'discovering' && (
            <div className="py-6 text-center text-sm text-slate-600 space-y-3">
              <Loader2 size={18} className="animate-spin mx-auto text-indigo-600" />
              <p>Sang cửa sổ Chrome trên máy worker: <b>đăng nhập</b> rồi <b>mở đúng trang báo cáo doanh thu</b> (có bảng/biểu đồ số theo ngày).</p>
              <p className="text-slate-500">Xong xuôi, bấm nút dưới để engine đọc dữ liệu:</p>
              <button
                onClick={signalAnalyze}
                disabled={analyzing}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                {analyzing ? 'Đang phân tích…' : 'Tôi đã đăng nhập & mở báo cáo — Phân tích'}
              </button>
              <p className="text-xs text-slate-400">(Cửa sổ sẽ giữ mở tới khi bạn bấm, tối đa 5 phút.)</p>
            </div>
          )}

          {phase !== 'need-discover' && phase !== 'discovering' && det?.noAuto && (
            <div className="space-y-2">
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Đã bắt {det.capturedSummary?.length ?? 0} response nhưng chưa tự nhận ra bảng doanh thu. Gửi danh sách dưới cho dev để chỉnh, hoặc thử "Dò lại" và mở đúng trang có bảng số theo ngày.
              </p>
              <div className="border border-slate-200 rounded-lg max-h-64 overflow-auto divide-y divide-slate-100">
                {(det.capturedSummary ?? []).map((c, i) => (
                  <div key={i} className="px-3 py-2 text-xs">
                    <div className="font-mono text-slate-600 truncate" title={c.url}>{c.url}</div>
                    <div className="text-slate-400 mt-0.5 break-all">{c.shape}</div>
                  </div>
                ))}
              </div>
              <button onClick={startDiscover} className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">Dò lại</button>
            </div>
          )}

          {phase !== 'need-discover' && phase !== 'discovering' && det && sel && !det.noAuto && (
            <>
              {(det.warnings?.length ?? 0) > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1">
                  {det.warnings!.map((w, i) => <div key={i}>⚠ {w}</div>)}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <label className="space-y-1"><span className="text-slate-500">Nguồn (rows_path)</span>
                  <select value={`${sel.url}|||${sel.rows_path}`} onChange={e => { const [url, rows_path] = e.target.value.split('|||'); override({ url, rows_path, date_field: null, revenue_field: null }) }}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-slate-700">
                    {det.candidates.map((c, i) => (
                      <option key={i} value={`${c.url}|||${c.rows_path}`}>
                        {c.rows} dòng · ngày: {c.date_field ?? '?'} · tiền: {c.revenue_field ?? '?'}{c.currency ? ` (${c.currency})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1"><span className="text-slate-500">Field ngày</span>
                  <select value={sel.date_field ?? ''} onChange={e => override({ date_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-2 py-1 text-slate-700">
                    <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><span className="text-slate-500">Field doanh thu</span>
                  <select value={sel.revenue_field ?? ''} onChange={e => override({ revenue_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-2 py-1 text-slate-700">
                    <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label className="space-y-1"><span className="text-slate-500">Field tiền tệ</span>
                  <select value={sel.currency_field ?? ''} onChange={e => override({ currency_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-2 py-1 text-slate-700">
                    <option value="">— (mặc định)</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Loại doanh thu:</span>
                <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
                  <button type="button" onClick={() => changeRevenueType('pending')}
                    className={`px-3 py-1 ${revenueType === 'pending' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>
                    Tiền màn hình
                  </button>
                  <button type="button" onClick={() => changeRevenueType('confirmed')}
                    className={`px-3 py-1 ${revenueType === 'confirmed' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`}>
                    Thực nhận
                  </button>
                </div>
                <span className="text-slate-400">
                  {revenueType === 'confirmed' ? '→ affiliate_revenue [confirmed] (trang Payout)' : '→ affiliate_revenue [pending] (dashboard)'}
                </span>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 flex justify-between">
                  <span>Preview: {det.preview.length} ngày</span>
                  <span>Tổng: {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="max-h-56 overflow-auto">
                  {det.preview.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-red-500">Chưa map ra dữ liệu — chọn lại field ngày/doanh thu.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-slate-100">
                        {det.preview.map(p => <tr key={p.date}><td className="px-3 py-1 text-slate-600">{p.date}</td><td className="px-3 py-1 text-right text-slate-800 font-mono">{p.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>)}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={startDiscover} className="text-xs text-slate-500 hover:text-slate-700 underline">Dò lại</button>
                <button onClick={save} disabled={phase === 'saving' || det.preview.length === 0}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {phase === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu cấu hình
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
