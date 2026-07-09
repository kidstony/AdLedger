'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Wand2, Save } from 'lucide-react'

const CMD_API = '/api/admin/revenue-engine/commands'
const CFG_API = '/api/admin/revenue-engine/network-config'

interface Detect {
  draft: Record<string, unknown> | null
  preview: { date: string; revenue: number }[]
  fields: string[]
  chosen: { url: string; rows_path: string; date_field: string | null; revenue_field: string | null; currency_field: string | null } | null
  candidates: { url: string; rows_path: string; rows: number; date_field?: string | null; revenue_field?: string | null; currency?: string; headers?: string[] }[]
  noAuto?: boolean
  capturedSummary?: { url: string; shape: string }[]
  warnings?: string[]
  needDiscover?: boolean
  revenue_type?: 'pending' | 'confirmed'
  source_url?: string | null
  divisor?: number
}

type RType = 'pending' | 'confirmed'
interface Card { url: string; loadedUrl: string; action: string; divisor: string; det: Detect | null; sel: Detect['chosen'] | null; status: 'loading' | 'ready' | 'empty' }
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

interface Props {
  networkId: string
  networkName: string
  accountId: string
  dashboardUrl: string
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onClose: () => void
  onSaved: () => void
}

export default function NetworkConfigPanel({ networkId, networkName, accountId, dashboardUrl, authFetch, onClose, onSaved }: Props) {
  const [cards, setCards] = useState<Record<RType, Card>>({
    pending: { url: '', loadedUrl: '', action: '', divisor: '1', det: null, sel: null, status: 'loading' },
    confirmed: { url: '', loadedUrl: '', action: '', divisor: '1', det: null, sel: null, status: 'loading' },
  })
  const [error, setError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState<RType | null>(null)
  const [discoverCmdId, setDiscoverCmdId] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [saving, setSaving] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const patchCard = (t: RType, p: Partial<Card>) => setCards(cs => ({ ...cs, [t]: { ...cs[t], ...p } }))

  // Phân tích 1 nguồn: đọc ĐÚNG bản dò theo source_url (url của thẻ) + loại của thẻ.
  const runDetect = async (type: RType, url: string, override?: Record<string, unknown>) => {
    patchCard(type, { status: 'loading' })
    // Chia giá trị: ưu tiên divisor trong override (khi user vừa đổi ô), else lấy state thẻ.
    const divisor = override && 'divisor' in override ? override.divisor : (Number(cards[type].divisor) || 1)
    const res = await authFetch(`${CFG_API}/detect`, {
      method: 'POST',
      body: JSON.stringify({ network_id: networkId, source_url: url.trim() || null, revenue_type: type, override: { ...override, divisor } }),
    })
    if (!res.ok) { patchCard(type, { status: 'empty', det: null, sel: null, loadedUrl: url.trim() }); return }
    const d: Detect = await res.json()
    patchCard(type, { det: d, sel: d.chosen, status: d.noAuto ? 'empty' : 'ready', loadedUrl: url.trim() })
  }

  // Mount: nạp config đã lưu → URL + MAPPING từng thẻ → phân tích lại đúng lựa chọn đã lưu
  // (không auto-detect đè lên). Nhờ vậy mở lại panel thấy đúng nguồn/field đã lưu.
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
      runDetect('pending', purl, pov)
      if (curl) runDetect('confirmed', curl, cov); else patchCard('confirmed', { status: 'empty' })
    })()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startDiscover = async (type: RType) => {
    setError(null); setDiscovering(type)
    const url = cards[type].url.trim()
    const act = cards[type].action.trim()
    const discover_actions = act ? [{ type: 'click', text: act }] : undefined // engine tự click trước khi đọc
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type: 'discover', account_id: accountId, discover_url: url || undefined, discover_actions }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh dò'); setDiscovering(null); return }
    const { command } = await res.json()
    setDiscoverCmdId(command.id); setAnalyzing(false)
    pollRef.current = setInterval(async () => {
      const r = await authFetch(CMD_API)
      if (!r.ok) return
      const { commands } = await r.json()
      const c = commands.find((x: { id: string }) => x.id === command.id)
      if (c && (c.status === 'done' || c.status === 'error')) {
        if (pollRef.current) clearInterval(pollRef.current)
        setDiscovering(null)
        if (c.status === 'error') { setError(c.message ?? 'Dò thất bại'); return }
        runDetect(type, url)
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
    runDetect(type, card.url, { url: next.url, rows_path: next.rows_path, date_field: next.date_field, revenue_field: next.revenue_field, currency_field: next.currency_field })
  }

  // Đổi ô ÷ (chia) → re-detect với divisor mới để preview cập nhật ngay.
  const changeDivisor = (type: RType, val: string) => {
    patchCard(type, { divisor: val })
    const card = cards[type]
    if (!card.sel) return
    runDetect(type, card.url, { url: card.sel.url, rows_path: card.sel.rows_path, date_field: card.sel.date_field, revenue_field: card.sel.revenue_field, currency_field: card.sel.currency_field, divisor: Number(val) || 1 })
  }

  const save = async () => {
    setSaving(true); setError(null)
    const types: RType[] = ['pending', 'confirmed']
    const reports = types
      .map(t => {
        const rep = (cards[t].det?.draft as { reports?: Record<string, unknown>[] } | null)?.reports?.[0]
        if (!rep) return null
        const act = cards[t].action.trim()
        rep.actions = act ? [{ type: 'click', text: act }] : [] // thao tác trước khi đọc (engine tự click)
        return rep
      })
      .filter(Boolean)
    if (!reports.length) { setError('Chưa có nguồn nào phân tích được để lưu.'); setSaving(false); return }
    const base = (cards.pending.det?.draft ?? cards.confirmed.det?.draft) as Record<string, unknown>
    const config = { ...base, reports }
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

  const renderCard = (type: RType) => {
    const card = cards[type]
    const m = META[type]
    const isConf = type === 'confirmed'
    const total = card.det?.preview.reduce((s, p) => s + p.revenue, 0) ?? 0
    const dupDash = isConf && !!card.url.trim() && !!dashboardUrl && stripSlash(card.url.trim()) === stripSlash(dashboardUrl)
    const det = card.det, sel = card.sel
    return (
      <div className="border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-md text-white text-xs font-medium ${m.badge}`}>{m.label}</span>
          <span className="text-[11px] text-slate-400">→ affiliate_revenue [{type}]</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <input value={card.url} onChange={e => patchCard(type, { url: e.target.value })}
            onBlur={() => { if (card.url.trim() !== card.loadedUrl) runDetect(type, card.url) }} placeholder={m.hint}
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-slate-700" />
          <button onClick={() => startDiscover(type)} disabled={!!discovering}
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
        {dupDash && !card.action.trim() && <p className="text-[11px] text-slate-400">Cùng URL trang đăng nhập — nếu dữ liệu chỉ hiện sau khi bấm 1 link/nút, điền ô "Bấm trước khi đọc" ở trên.</p>}

        {card.status === 'loading' && <div className="py-3 text-center text-xs text-slate-400 flex items-center justify-center gap-2"><Loader2 size={12} className="animate-spin" /> Đang phân tích…</div>}

        {card.status === 'empty' && (
          <p className="text-[11px] text-slate-500">
            {det?.noAuto
              ? `Đã bắt ${det.capturedSummary?.length ?? 0} response nhưng chưa nhận ra bảng doanh thu — mở đúng trang có bảng số theo ngày rồi Dò lại.`
              : (isConf ? 'Chưa có dữ liệu. Nhập URL trang Payout rồi bấm Dò.' : 'Chưa có dữ liệu. Bấm Dò (bỏ trống URL = trang dashboard).')}
          </p>
        )}

        {card.status === 'ready' && det && sel && (
          <>
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
                      {c.rows === 0
                        ? `0 dòng (trống) · cột: ${(c.headers ?? []).join(', ') || '?'}`
                        : `${c.rows} dòng · ${c.date_field ?? '?'} · ${c.revenue_field ?? '?'}${c.currency ? ` (${c.currency})` : ''}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Ngày</span>
                <select value={sel.date_field ?? ''} onChange={e => override(type, { date_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Doanh thu</span>
                <select value={sel.revenue_field ?? ''} onChange={e => override(type, { revenue_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">—</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label className="space-y-0.5"><span className="text-slate-500">Tiền tệ</span>
                <select value={sel.currency_field ?? ''} onChange={e => override(type, { currency_field: e.target.value || null })} className="w-full border border-slate-200 rounded px-1.5 py-1 text-slate-700">
                  <option value="">— (mặc định)</option>{det.fields.map(f => <option key={f} value={f}>{f}</option>)}
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
                <span>Tổng: {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="max-h-40 overflow-auto">
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

  return (
    <div className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="font-medium text-slate-800 flex items-center gap-2"><Wand2 size={16} className="text-indigo-600" /> Cấu hình tự động — {networkName}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="font-medium">Đăng nhập (login):</span> <span className="font-mono text-slate-600 break-all">{dashboardUrl || '(chưa có)'}</span>
            <span className="text-slate-400"> — chỉ dùng để đăng nhập, KHÔNG phải nguồn doanh thu.</span>
          </div>

          {discovering ? (
            <div className="py-6 text-center text-sm text-slate-600 space-y-3">
              <Loader2 size={18} className="animate-spin mx-auto text-indigo-600" />
              <p>Đang dò nguồn <b>{META[discovering].label}</b>. Sang cửa sổ Chrome trên máy worker: <b>đăng nhập</b> + <b>mở đúng trang</b> (bảng/biểu đồ số theo ngày).</p>
              <button onClick={signalAnalyze} disabled={analyzing}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60">
                {analyzing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                {analyzing ? 'Đang phân tích…' : 'Đã mở đúng trang — Phân tích'}
              </button>
              <p className="text-xs text-slate-400">(Cửa sổ giữ mở tới khi bạn bấm, tối đa 5 phút.)</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-500">2 nguồn doanh thu ngang cấp — mỗi nguồn 1 URL riêng. Cấu hình rồi bấm <b>Lưu cấu hình</b>.</p>
              {renderCard('pending')}
              {renderCard('confirmed')}
              {incomplete.length > 0 && (
                <p className="text-[11px] text-amber-600 text-right">Chọn <b>Ngày</b> và <b>Doanh thu</b> cho: {incomplete.map(t => META[t].label).join(', ')} trước khi lưu.</p>
              )}
              <div className="flex items-center justify-end pt-1">
                <button onClick={save} disabled={saving || !canSave}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu cấu hình
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
