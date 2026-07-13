'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, Wand2, Save, WifiOff, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CMD_API, CFG_API, authFetch, type WorkerState } from './shared'

interface Detect {
  draft: Record<string, unknown> | null
  preview: { date: string; revenue: number }[]
  fields: string[]
  field_labels?: Record<string, string>   // col_N → tên header (nhãn hiển thị; value vẫn col_N)
  chosen: { url: string; rows_path: string; date_field: string | null; revenue_field: string | null; currency_field: string | null; page?: string | null } | null
  candidates: { url: string; rows_path: string; rows: number; page?: string | null; date_field?: string | null; revenue_field?: string | null; currency?: string; headers?: string[] }[]
  noAuto?: boolean
  capturedSummary?: { url: string; shape: string }[]
  warnings?: string[]
  needDiscover?: boolean
  revenue_type?: 'pending' | 'confirmed'
  source_url?: string | null
  divisor?: number
  // (detect API còn trả `breakdown` — wizard này CHỈ quản lý doanh thu, phần breakdown
  // cấu hình ở Tối Ưu Camp → tab "Dữ liệu tối ưu Network".)
  // các trang auto-scan đã ghé trong lần dò + trang đó có gì
  pages?: { page_url: string; page: string | null; candidates: number; hasDate: boolean; hasRevenue: boolean; hasBreakdownDims: boolean }[]
}

type RType = 'pending' | 'confirmed'
interface Card { url: string; loadedUrl: string; action: string; divisor: string; scan: boolean; det: Detect | null; sel: Detect['chosen'] | null; status: 'loading' | 'ready' | 'empty' }
interface SavedReport {
  revenue_type?: string
  url?: string
  rows_path?: string
  table_index?: number
  capture?: { url_pattern?: string }
  actions?: { type?: string; text?: string }[]
  mapping?: { date?: { path?: string }; revenue?: { path?: string; divisor?: number }; currency?: { path?: string } }
}

const META: Record<RType, { label: string; hint: string; badge: string }> = {
  pending: { label: 'Tiền màn hình', hint: 'URL trang doanh thu màn hình — bỏ trống = dùng trang dashboard', badge: 'bg-indigo-600' },
  confirmed: { label: 'Thực nhận', hint: 'URL trang Payout (tiền đã thực nhận)', badge: 'bg-emerald-600' },
}

const stripSlash = (s: string) => s.replace(/\/+$/, '')

const STEPS = [
  { n: 1, label: 'Tiền màn hình' },
  { n: 2, label: 'Thực nhận' },
  { n: 3, label: 'Hoàn tất' },
]

interface Props {
  networkId: string
  networkName: string
  accountId: string
  dashboardUrl: string
  workerState: WorkerState
  onClose: () => void
  onSaved: () => void
}

// Wizard cấu hình network 3 bước: 1 Tiền màn hình → 2 Thực nhận (bỏ qua được) → 3 Tiền tệ + Lưu.
// Logic dò/map/preview giữ nguyên từ NetworkConfigPanel — chỉ đổi cấu trúc hiển thị.
export default function ConfigWizard({ networkId, networkName, accountId, dashboardUrl, workerState, onClose, onSaved }: Props) {
  const [step, setStep] = useState(1)
  const [cards, setCards] = useState<Record<RType, Card>>({
    // scan: auto-scan trang báo cáo sau đăng nhập — bật sẵn cho Tiền màn hình (dò dashboard,
    // engine tự tìm trang có số); tắt sẵn cho Thực nhận (thường đã biết đúng trang Payout).
    pending: { url: '', loadedUrl: '', action: '', divisor: '1', scan: true, det: null, sel: null, status: 'loading' },
    confirmed: { url: '', loadedUrl: '', action: '', divisor: '1', scan: false, det: null, sel: null, status: 'loading' },
  })
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<RType | null>(null)
  const [discoverCmdId, setDiscoverCmdId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null) // tiến độ auto-scan ("Quét trang 2/5: /reports")
  const [saving, setSaving] = useState(false)
  // Tiền tệ nguồn (config-level): nếu ≠ USD → engine tự đổi sang USD khi sync (fx_auto_from).
  const [fxFrom, setFxFrom] = useState('USD')
  const [fxRate, setFxRate] = useState<number | null>(1) // tỷ giá <fxFrom>→USD (để preview quy đổi)
  const [fxLoading, setFxLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const workerOffline = workerState === 'offline'

  const patchCard = (t: RType, p: Partial<Card>) => setCards(cs => ({ ...cs, [t]: { ...cs[t], ...p } }))

  // Phân tích 1 nguồn: đọc ĐÚNG bản dò theo source_url (url của thẻ) + loại của thẻ.
  const runDetect = async (type: RType, url: string, override?: Record<string, unknown>, hasAction = false) => {
    patchCard(type, { status: 'loading' })
    // Chia giá trị: ưu tiên divisor trong override (khi user vừa đổi ô), else lấy state thẻ.
    const divisor = override && 'divisor' in override ? override.divisor : (Number(cards[type].divisor) || 1)
    const res = await authFetch(`${CFG_API}/detect`, {
      method: 'POST',
      // has_action: thẻ có "Bấm trước khi đọc" → detect tách đúng bản dò + ưu tiên bảng hiện sau click.
      body: JSON.stringify({ network_id: networkId, source_url: url.trim() || null, revenue_type: type, has_action: hasAction, override: { ...override, divisor } }),
    })
    if (!res.ok) { patchCard(type, { status: 'empty', det: null, sel: null, loadedUrl: url.trim() }); return }
    const d: Detect = await res.json()
    patchCard(type, { det: d, sel: d.chosen, status: d.noAuto ? 'empty' : 'ready', loadedUrl: url.trim() })
  }

  // Mount: nạp config đã lưu → URL + MAPPING từng thẻ → phân tích lại đúng lựa chọn đã lưu
  // (không auto-detect đè lên). Nhờ vậy mở lại wizard thấy đúng nguồn/field đã lưu.
  useEffect(() => {
    (async () => {
      let purl = '', curl = '', pact = '', cact = '', pdiv = '1', cdiv = '1'
      let pov: Record<string, unknown> | undefined, cov: Record<string, unknown> | undefined
      const savedOverride = (r: SavedReport): Record<string, unknown> => {
        const cur = r?.mapping?.currency?.path
        return {
          rows_path: r?.rows_path,
          // định danh nguồn để reload khớp ĐÚNG candidate khi nhiều nguồn cùng rows_path.
          url_pattern: r?.capture?.url_pattern ?? null,
          table_index: r?.table_index ?? null,
          date_field: r?.mapping?.date?.path ?? null,
          revenue_field: r?.mapping?.revenue?.path ?? null,
          currency_field: cur && cur !== '__const__' ? cur : null,
          divisor: Number(r?.mapping?.revenue?.divisor) || 1,
        }
      }
      const res = await authFetch(`${CFG_API}?network_id=${encodeURIComponent(networkId)}`)
      if (res.ok) {
        const { config } = await res.json().catch(() => ({ config: null }))
        if (config?.config?.fx_auto_from) setFxFrom(String(config.config.fx_auto_from).toUpperCase())
        const reps: SavedReport[] = Array.isArray(config?.config?.reports) ? config.config.reports : []
        for (const r of reps) {
          const u = r.url === '{base}' ? '' : (r.url ?? '')
          const act = r.actions?.find(a => (a.type ?? 'click') === 'click')?.text ?? ''
          const div = String(r.mapping?.revenue?.divisor ?? 1)
          if (r.revenue_type === 'confirmed') { curl = u; cov = savedOverride(r); cact = act; cdiv = div }
          else { purl = u; pov = savedOverride(r); pact = act; pdiv = div }
        }
      }
      setCards(cs => ({ pending: { ...cs.pending, url: purl, action: pact, divisor: pdiv }, confirmed: { ...cs.confirmed, url: curl, action: cact, divisor: cdiv } }))
      runDetect('pending', purl, pov, !!pact.trim())
      if (curl) runDetect('confirmed', curl, cov, !!cact.trim()); else patchCard('confirmed', { status: 'empty' })
    })()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lấy tỷ giá <fxFrom>→USD qua API route CÙNG ORIGIN (server fetch hộ, tránh CORS). USD → 1.
  useEffect(() => {
    if (fxFrom === 'USD') { setFxRate(1); setFxLoading(false); return }
    let ok = true
    setFxLoading(true); setFxRate(null)
    authFetch(`/api/admin/revenue-engine/fx-rate?from=${encodeURIComponent(fxFrom)}`)
      .then(r => r.ok ? r.json() : { rate: null })
      .then(d => { if (ok) { setFxRate(typeof d?.rate === 'number' ? d.rate : null); setFxLoading(false) } })
      .catch(() => { if (ok) { setFxRate(null); setFxLoading(false) } })
    return () => { ok = false }
  }, [fxFrom])

  const startDiscover = async (type: RType) => {
    setError(null); setDiscovering(type); setDiscoverMsg(null)
    const url = cards[type].url.trim()
    const act = cards[type].action.trim()
    const discover_actions = act ? [{ type: 'click', text: act }] : undefined // engine tự click trước khi đọc
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type: 'discover', account_id: accountId, discover_url: url || undefined, discover_actions, discover_scan: cards[type].scan }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh dò'); setDiscovering(null); return }
    const { command } = await res.json()
    setDiscoverCmdId(command.id); setAnalyzing(false)
    pollRef.current = setInterval(async () => {
      const r = await authFetch(CMD_API)
      if (!r.ok) return
      const { commands } = await r.json()
      const c = commands.find((x: { id: string }) => x.id === command.id)
      // Đang chạy: hiện tiến độ auto-scan (worker ghi message giữa chừng: "Quét trang 2/5…").
      if (c?.status === 'running') setDiscoverMsg(c.message ?? null)
      if (c && (c.status === 'done' || c.status === 'error')) {
        if (pollRef.current) clearInterval(pollRef.current)
        setDiscovering(null); setDiscoverMsg(null)
        if (c.status === 'error') { setError(c.message ?? 'Dò thất bại'); return }
        runDetect(type, url, undefined, !!cards[type].action.trim())
      }
    }, 4000)
  }

  const signalAnalyze = async () => {
    if (!discoverCmdId) return
    setAnalyzing(true)
    await authFetch(CMD_API, { method: 'PATCH', body: JSON.stringify({ id: discoverCmdId, signal: 'analyze' }) })
  }

  const override = (type: RType, patch: Partial<Detect['chosen']>) => {
    const card = cards[type]
    if (!card.sel) return
    const next = { ...card.sel, ...patch }
    patchCard(type, { sel: next })
    runDetect(type, card.url, { url: next.url, rows_path: next.rows_path, date_field: next.date_field, revenue_field: next.revenue_field, currency_field: next.currency_field }, !!card.action.trim())
  }

  // Đổi ô ÷ (chia) → re-detect với divisor mới để preview cập nhật ngay.
  const changeDivisor = (type: RType, val: string) => {
    patchCard(type, { divisor: val })
    const card = cards[type]
    if (!card.sel) return
    runDetect(type, card.url, { url: card.sel.url, rows_path: card.sel.rows_path, date_field: card.sel.date_field, revenue_field: card.sel.revenue_field, currency_field: card.sel.currency_field, divisor: Number(val) || 1 }, !!card.action.trim())
  }

  const save = async () => {
    setSaving(true); setError(null)
    const types: RType[] = ['pending', 'confirmed']
    const reports: Record<string, unknown>[] = types
      .map((t): Record<string, unknown> | null => {
        const orig = (cards[t].det?.draft as { reports?: Record<string, unknown>[] } | null)?.reports?.[0]
        if (!orig) return null
        const act = cards[t].action.trim()
        // Clone (không mutate state draft) + thao tác trước khi đọc (engine tự click).
        return { ...orig, actions: act ? [{ type: 'click', text: act }] : [] }
      })
      .filter((r): r is Record<string, unknown> => r !== null)
    if (!reports.length) { setError('Chưa có nguồn nào phân tích được để lưu.'); setSaving(false); return }
    // Wizard này CHỈ lưu report doanh thu (pending/confirmed) — merge phía PUT giữ nguyên
    // report breakdown đã cấu hình ở tab "Dữ liệu tối ưu Network" (không đụng nhau).
    const base = (cards.pending.det?.draft ?? cards.confirmed.det?.draft) as Record<string, unknown>
    // fx_auto_from: nguồn ≠ USD → engine tự đổi sang USD khi sync.
    const config = { ...base, reports, fx_auto_from: fxFrom && fxFrom !== 'USD' ? fxFrom : null }
    const res = await authFetch(CFG_API, { method: 'PUT', body: JSON.stringify({ network_id: networkId, config }) })
    setSaving(false)
    if (res.ok) onSaved()
    else setError((await res.json().catch(() => ({}))).error ?? 'Lỗi lưu cấu hình')
  }

  // Chặn lưu khi đang phân tích (tránh lưu draft cũ) — chỉ lưu khi có ít nhất 1 nguồn ready.
  const anyLoading = cards.pending.status === 'loading' || cards.confirmed.status === 'loading'
  // Thẻ đã có nguồn nhưng CHƯA chọn Ngày/Doanh thu → chặn lưu (config thiếu date/revenue path sẽ hỏng).
  const incomplete = (['pending', 'confirmed'] as RType[]).filter(t => cards[t].det?.draft && (!cards[t].sel?.date_field || !cards[t].sel?.revenue_field))
  const canSave = !anyLoading && incomplete.length === 0 && !!(cards.pending.det?.draft || cards.confirmed.det?.draft)

  // Bước 1/2 chỉ cho Tiếp tục khi thẻ không đang phân tích và không dở dang mapping.
  const stepBlocked = (t: RType) =>
    cards[t].status === 'loading' ? 'Đang phân tích…' :
    incomplete.includes(t) ? `Chọn Ngày và Doanh thu cho ${META[t].label} trước.` : null

  const renderCard = (type: RType) => {
    const card = cards[type]
    const m = META[type]
    const isConf = type === 'confirmed'
    const total = card.det?.preview.reduce((s, p) => s + p.revenue, 0) ?? 0
    const dupDash = isConf && !!card.url.trim() && !!dashboardUrl && stripSlash(card.url.trim()) === stripSlash(dashboardUrl)
    const det = card.det, sel = card.sel
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-white text-xs font-medium ${m.badge}`}>{m.label}</span>
          <span className="text-[11px] text-slate-400">→ affiliate_revenue [{type}]</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input value={card.url} onChange={e => patchCard(type, { url: e.target.value })}
            onBlur={() => { if (card.url.trim() !== card.loadedUrl) runDetect(type, card.url, undefined, !!card.action.trim()) }} placeholder={m.hint}
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700" />
          <button onClick={() => startDiscover(type)} disabled={!!discovering || workerOffline}
            title={workerOffline ? 'Worker offline — không dò được' : undefined}
            className="px-2.5 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap flex items-center gap-1">
            <Wand2 size={13} /> Dò
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-400 whitespace-nowrap">Bấm trước khi đọc:</span>
          <input value={card.action} onChange={e => patchCard(type, { action: e.target.value })}
            placeholder="tên link/nút cần click (vd: Payment history) — để trống nếu không cần"
            className="flex-1 border border-slate-200 rounded px-2 py-0.5 text-slate-600" />
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer w-fit"
          title="Sau khi đăng nhập, engine tự ghé các trang menu Conversions/Reports/Statistics… (cùng origin, chỉ mở link — không bấm nút) để tìm trang chứa dữ liệu — không cần tự điều hướng.">
          <input type="checkbox" checked={card.scan} onChange={e => patchCard(type, { scan: e.target.checked })} className="accent-indigo-600" />
          Tự quét trang báo cáo (auto-scan)
        </label>
        {dupDash && !card.action.trim() && <p className="text-[11px] text-slate-400">Cùng URL trang đăng nhập — nếu dữ liệu chỉ hiện sau khi bấm 1 link/nút, điền ô &quot;Bấm trước khi đọc&quot; ở trên.</p>}

        {card.status === 'loading' && <div className="py-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Đang phân tích…</div>}

        {card.status === 'empty' && (
          <p className="text-[11px] text-slate-500">
            {det?.noAuto
              ? `Đã bắt ${det.capturedSummary?.length ?? 0} response nhưng chưa nhận ra bảng doanh thu — mở đúng trang có bảng số theo ngày rồi Dò lại.`
              : (isConf ? 'Chưa có dữ liệu. Nhập URL trang Payout rồi bấm Dò — hoặc Bỏ qua nếu chưa cần.' : 'Chưa có dữ liệu. Bấm Dò (bỏ trống URL = trang dashboard).')}
          </p>
        )}

        {card.status === 'ready' && det && sel && (
          <>
            {(det.pages?.length ?? 0) > 0 && (
              <p className="text-[11px] text-slate-400">
                Đã tự quét {det.pages!.length} trang: {det.pages!.map(p => p.page ?? p.page_url).slice(0, 5).join(', ')}
                {sel.page ? <> — nguồn đang chọn ở <span className="font-mono text-slate-500">{sel.page}</span></> : null}
              </p>
            )}
            {(det.warnings?.length ?? 0) > 0 && (
              <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 space-y-0.5">
                {det.warnings!.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <label className="space-y-0.5"><span className="text-slate-500">Nguồn</span>
                <select value={`${sel.url}|||${sel.rows_path}`} onChange={e => { const [url, rows_path] = e.target.value.split('|||'); override(type, { url, rows_path, date_field: null, revenue_field: null }) }}
                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  {det.candidates.map((c, i) => (
                    <option key={i} value={`${c.url}|||${c.rows_path}`}>
                      {c.page ? `${c.page} · ` : ''}{c.rows === 0
                        ? `0 dòng (trống) · cột: ${(c.headers ?? []).join(', ') || '?'}`
                        : `${c.rows} dòng · ${c.date_field ?? '?'} · ${c.revenue_field ?? '?'}${c.currency ? ` (${c.currency})` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Ngày</span>
                <select value={sel.date_field ?? ''} onChange={e => override(type, { date_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{det.field_labels?.[f] ?? f}</option>)}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Doanh thu</span>
                <select value={sel.revenue_field ?? ''} onChange={e => override(type, { revenue_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{det.field_labels?.[f] ?? f}</option>)}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Tiền tệ</span>
                <select value={sel.currency_field ?? ''} onChange={e => override(type, { currency_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">— (mặc định)</option>{det.fields.map(f => <option key={f} value={f}>{det.field_labels?.[f] ?? f}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-slate-500">Chia giá trị (÷):</span>
              <input value={card.divisor} onChange={e => changeDivisor(type, e.target.value)}
                className="w-20 border border-slate-200 rounded px-1.5 py-0.5 text-slate-700" />
              <span className="text-slate-400">đặt 100 nếu doanh thu là cents (vd 640 → €6.40)</span>
            </div>
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 flex justify-between">
                <span>Preview: {det.preview.length} ngày</span>
                <span>Tổng: {total.toLocaleString('en-US', { maximumFractionDigits: 2 })} {fxFrom}{fxFrom !== 'USD' && fxRate ? ` ≈ $${(total * fxRate).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''}</span>
              </div>
              <div className="max-h-56 overflow-auto">
                {det.preview.length === 0 ? (
                  (det.candidates.find(c => c.url === sel.url && c.rows_path === sel.rows_path)?.rows ?? 1) === 0 ? (
                    <p className="px-2 py-3 text-center text-[11px] text-slate-400">Nguồn hiện <b>trống (0 dòng)</b> — vd payout chưa có khoản nào. Chọn Ngày + Doanh thu theo tên cột rồi Lưu; khi có dữ liệu sẽ tự vào.</p>
                  ) : (
                    <p className="px-2 py-3 text-center text-[11px] text-red-500">Chưa map ra dữ liệu — chọn lại Nguồn/Ngày/Doanh thu.</p>
                  )
                ) : (
                  <table className="w-full text-[11px]">
                    <tbody className="divide-y divide-slate-100">
                      {det.preview.map(p => <tr key={p.date}><td className="px-2 py-0.5 text-slate-600">{p.date}</td><td className="px-2 py-0.5 text-right text-slate-800 font-mono">{p.revenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td></tr>)}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // Tóm tắt 1 nguồn ở bước Hoàn tất.
  const summaryRow = (t: RType) => {
    const card = cards[t]
    const hasDraft = !!card.det?.draft
    const total = card.det?.preview.reduce((s, p) => s + p.revenue, 0) ?? 0
    return (
      <tr key={t}>
        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-md text-white text-xs font-medium ${META[t].badge}`}>{META[t].label}</span></td>
        <td className="px-3 py-2 text-xs font-mono text-slate-500 break-all">{hasDraft ? (card.url.trim() || '(trang dashboard)') : '—'}</td>
        <td className="px-3 py-2 text-xs text-slate-600 text-right">{hasDraft ? `${card.det?.preview.length ?? 0} ngày` : 'bỏ qua'}</td>
        <td className="px-3 py-2 text-xs font-mono text-slate-800 text-right">
          {hasDraft ? `${total.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${fxFrom}` : '—'}
        </td>
      </tr>
    )
  }

  const blocked1 = stepBlocked('pending')
  const blocked2 = stepBlocked('confirmed')

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={16} className="text-indigo-600" /> Cấu hình tự động — {networkName}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-center gap-2">
              {i > 0 && <div className={cn('w-8 h-px', step > i ? 'bg-indigo-400' : 'bg-slate-200')} />}
              <button
                type="button"
                onClick={() => { if (s.n < step) setStep(s.n) }}
                className={cn('flex items-center gap-1.5 text-xs font-medium',
                  step === s.n ? 'text-indigo-600' : step > s.n ? 'text-indigo-400' : 'text-slate-400')}
              >
                <span className={cn('w-5 h-5 rounded-full flex items-center justify-center text-[10px] border',
                  step === s.n ? 'bg-indigo-600 text-white border-indigo-600'
                    : step > s.n ? 'bg-indigo-50 text-indigo-600 border-indigo-300'
                      : 'bg-white text-slate-400 border-slate-200')}>
                  {step > s.n ? <Check size={11} /> : s.n}
                </span>
                {s.label}
              </button>
            </div>
          ))}
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        {workerOffline && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <WifiOff size={14} /> Worker offline — chạy <code className="font-mono">node engine/worker.js</code> trên máy engine trước khi Dò.
          </div>
        )}

        {discovering ? (
          <div className="py-6 text-center text-sm text-slate-600 space-y-3">
            <Loader2 size={18} className="animate-spin mx-auto text-indigo-600" />
            {cards[discovering].scan ? (
              <p>Đang dò nguồn <b>{META[discovering].label}</b>. Sang cửa sổ Chrome trên máy worker: chỉ cần <b>đăng nhập</b> — engine sẽ <b>tự quét các trang báo cáo</b> sau khi bạn bấm nút bên dưới.</p>
            ) : (
              <p>Đang dò nguồn <b>{META[discovering].label}</b>. Sang cửa sổ Chrome trên máy worker: <b>đăng nhập</b> + <b>mở đúng trang</b> (bảng/biểu đồ số theo ngày).</p>
            )}
            {discoverMsg && (
              <p className="text-xs font-medium text-indigo-600">{discoverMsg}</p>
            )}
            <button onClick={signalAnalyze} disabled={analyzing}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
              {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {analyzing
                ? (cards[discovering].scan ? 'Đang quét & phân tích…' : 'Đang phân tích…')
                : (cards[discovering].scan ? 'Đã đăng nhập — Quét & phân tích' : 'Đã mở đúng trang — Phân tích')}
            </button>
            <p className="text-xs text-slate-400">(Cửa sổ giữ mở tới khi bạn bấm, tối đa 5 phút{cards[discovering].scan ? '; quét thêm tối đa ~2 phút' : ''}.)</p>
          </div>
        ) : (
          <>
            {step === 1 && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <span className="font-medium">Đăng nhập (login):</span> <span className="font-mono text-slate-600 break-all">{dashboardUrl || '(chưa có)'}</span>
                  <span className="text-slate-400"> — chỉ dùng để đăng nhập, KHÔNG phải nguồn doanh thu.</span>
                </div>
                {renderCard('pending')}
              </div>
            )}

            {step === 2 && <div className="space-y-3">{renderCard('confirmed')}</div>}

            {step === 3 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Tiền tệ nguồn (tự đổi ra USD):</span>
                  <select value={fxFrom} onChange={e => setFxFrom(e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-slate-700">
                    {['USD', 'EUR', 'GBP', 'VND', 'AUD', 'CAD', 'JPY', 'RUB'].map(c => <option key={c} value={c}>{c}{c === 'USD' ? ' (không đổi)' : ''}</option>)}
                  </select>
                  {fxFrom !== 'USD' && (
                    <span className="text-slate-400">
                      {fxLoading ? 'đang lấy tỷ giá…' : fxRate ? `1 ${fxFrom} ≈ $${fxRate.toFixed(3)} → P&L quy USD khi sync` : 'chưa lấy được tỷ giá (vẫn tự đổi khi sync)'}
                    </span>
                  )}
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left">
                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Nguồn</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">URL</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Preview</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-right">Tổng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(['pending', 'confirmed'] as RType[]).map(summaryRow)}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-400">
                  Wizard này chỉ cấu hình nguồn <b>doanh thu</b> (P&amp;L). Dữ liệu tối ưu camp
                  (quốc gia/thiết bị/giờ/sub-id) cấu hình riêng ở <b>Tối Ưu Camp → Dữ liệu tối ưu Network</b> — 2 phần độc lập, không đụng nhau.
                </p>
                {incomplete.length > 0 && (
                  <p className="text-[11px] text-amber-600">Chọn <b>Ngày</b> và <b>Doanh thu</b> cho: {incomplete.map(t => META[t].label).join(', ')} trước khi lưu (quay lại bước tương ứng).</p>
                )}
              </div>
            )}

            {/* Footer điều hướng */}
            <div className="flex items-center justify-between pt-1">
              <div>
                {step > 1 && (
                  <Button variant="ghost" onClick={() => setStep(step - 1)}>
                    <ChevronLeft size={14} /> Quay lại
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {step === 1 && (
                  <>
                    {blocked1 && <span className="text-[11px] text-amber-600">{blocked1}</span>}
                    <Button onClick={() => setStep(2)} disabled={!!blocked1}>
                      Tiếp tục <ChevronRight size={14} />
                    </Button>
                  </>
                )}
                {step === 2 && (
                  <>
                    {blocked2 && <span className="text-[11px] text-amber-600">{blocked2}</span>}
                    {!cards.confirmed.det?.draft && (
                      <Button variant="ghost" onClick={() => setStep(3)}>Bỏ qua — chưa có trang Payout</Button>
                    )}
                    <Button onClick={() => setStep(3)} disabled={!!blocked2}>
                      Tiếp tục <ChevronRight size={14} />
                    </Button>
                  </>
                )}
                {step === 3 && (
                  <Button onClick={save} disabled={saving || !canSave}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu cấu hình
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
