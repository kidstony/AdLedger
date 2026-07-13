'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, Loader2, Wand2, Plug, RefreshCw, LogIn, MoreHorizontal, WifiOff, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import StatusPill from '@/components/ui/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import TableSkeleton from '@/components/ui/TableSkeleton'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { normalizeDashboardUrl } from '@/lib/dashboard-url'
import ConfigWizard from './ConfigWizard'
import {
  ACC_API, CMD_API, authFetch, nextAction,
  type EngineAccount, type EngineCommand, type NetworkOpt, type ProjectOpt, type WorkerState,
} from './shared'

interface Props {
  workerState: WorkerState
  onDataChanged?: () => void // báo page reload monitor (sau sync/xóa)
}

interface LoadedData { accounts?: EngineAccount[]; networks?: NetworkOpt[]; projects?: ProjectOpt[]; configured?: string[] }

export default function AccountsTab({ workerState, onDataChanged }: Props) {
  const confirmDlg = useConfirm()
  const [accounts, setAccounts] = useState<EngineAccount[]>([])
  const [networks, setNetworks] = useState<NetworkOpt[]>([])
  const [projects, setProjects] = useState<ProjectOpt[]>([])
  const [configured, setConfigured] = useState<string[]>([])
  const [commands, setCommands] = useState<EngineCommand[]>([])
  const [loading, setLoading] = useState(true)

  // form thêm mới
  const [adding, setAdding] = useState(false)
  const [fNetwork, setFNetwork] = useState('')
  const [fProject, setFProject] = useState('')
  const [fUrl, setFUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null) // vị trí menu ⋯ (portal, position:fixed)
  const [cfgPanel, setCfgPanel] = useState<{ networkId: string; networkName: string; accountId: string; dashboardUrl: string } | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now()) // đồng hồ tick 1s để hiện "đã chờ M:SS"

  const workerOffline = workerState === 'offline'

  const load = useCallback(async (): Promise<LoadedData | null> => {
    const res = await authFetch(ACC_API)
    let d: LoadedData | null = null
    if (res.ok) {
      d = await res.json()
      setAccounts(d?.accounts ?? [])
      setNetworks(d?.networks ?? [])
      setProjects(d?.projects ?? [])
      setConfigured(d?.configured ?? [])
      // Mặc định chọn network đầu tiên CÓ slug engine (dùng được).
      setFNetwork(prev => {
        if (prev) return prev
        const firstUsable = (d?.networks ?? []).find((n: NetworkOpt) => n.network_id)
        return firstUsable?.network_id ?? ''
      })
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Không tải được dữ liệu')
    }
    setLoading(false)
    return d
  }, [])

  const loadCommands = useCallback(async () => {
    const res = await authFetch(CMD_API)
    if (res.ok) setCommands((await res.json()).commands ?? [])
  }, [])

  // Cần đồng bộ từ dự án khi: có dự án gán network (slug engine) mà chưa có account,
  // hoặc account đã gán dự án nhưng thiếu URL trong khi dự án có affiliate_url.
  const needsSyncFromProjects = (d: LoadedData) => {
    const accs = d.accounts ?? []
    const slugs = new Map<string, string>()
    for (const n of d.networks ?? []) if (n.network_id) slugs.set(n.network_name.trim().toLowerCase(), n.network_id)
    const withAccount = new Set(accs.map(a => a.project_id).filter(Boolean))
    const urlOf = new Map((d.projects ?? []).map(p => [p.project_id, normalizeDashboardUrl(p.affiliate_url)]))
    return (d.projects ?? []).some(p =>
      p.affiliate_network && slugs.has(p.affiliate_network.trim().toLowerCase()) && !withAccount.has(p.project_id)
    ) || accs.some(a => !a.dashboard_url && a.project_id && urlOf.get(a.project_id))
  }

  // Tự đồng bộ account từ dự án khi mở tab (im lặng, idempotent) — tối đa 1 lần
  // mỗi lần mount để không loop khi affiliate_url không hợp lệ (account vẫn thiếu URL).
  const autoSynced = useRef(false)
  useEffect(() => {
    (async () => {
      const d = await load()
      loadCommands()
      if (!d || autoSynced.current || !needsSyncFromProjects(d)) return
      autoSynced.current = true
      const res = await authFetch(`${ACC_API}/sync-from-projects`, { method: 'POST' })
      if (res.ok) load()
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Có lệnh đang chờ/chạy → poll nhẹ để cập nhật trạng thái + login_status, và tick đồng hồ 1s
  // để hiện "đã chờ M:SS" (phân biệt đang chạy vs treo).
  const hasActive = commands.some(c => c.status === 'pending' || c.status === 'running')
  useEffect(() => {
    if (!hasActive) return
    const poll = setInterval(() => { loadCommands(); load() }, 4000)
    const tick = setInterval(() => setNowTs(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [hasActive, loadCommands, load])

  const activeCmd = (accountId: string) =>
    commands.find(c => c.account_id === accountId && (c.status === 'pending' || c.status === 'running'))
  const lastCmdError = (accountId: string) => {
    const c = commands.find(x => x.account_id === accountId)
    return c && c.status === 'error' ? c.message : null
  }
  const isConfigured = (networkId: string) => configured.includes(networkId)

  // Thời gian đã trôi kể từ khi lệnh bắt đầu chạy (hoặc được tạo, nếu còn chờ) → "M:SS".
  const fmtElapsed = (cmd: EngineCommand) => {
    const from = cmd.started_at ?? cmd.created_at
    if (!from) return ''
    const s = Math.max(0, Math.floor((nowTs - new Date(from).getTime()) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // Hủy mọi lệnh đang chờ/chạy của account → thoát bế tắc "Đang kết nối…".
  const cancelCommand = async (accountId: string) => {
    const res = await authFetch(CMD_API, { method: 'DELETE', body: JSON.stringify({ account_id: accountId }) })
    if (res.ok) { loadCommands(); load() }
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Không hủy được lệnh')
  }

  const sendCommand = async (accountId: string, type: 'login' | 'fetch', force = false) => {
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type, account_id: accountId, force }) })
    if (res.ok) loadCommands()
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh')
  }

  const projectName = (id: string | null) => id ? (projects.find(p => p.project_id === id)?.name ?? id) : '— chưa gán —'

  const create = async () => {
    setSaving(true)
    const res = await authFetch(ACC_API, {
      method: 'POST',
      body: JSON.stringify({ network_id: fNetwork, project_id: fProject || null, dashboard_url: fUrl.trim() || null }),
    })
    setSaving(false)
    if (res.ok) {
      setAdding(false); setFProject(''); setFUrl('')
      toast.success('Đã thêm tài khoản')
      load()
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo tài khoản')
    }
  }

  // Preview account_id sẽ sinh (cùng thuật toán server): network_id → _2, _3…
  const nextAccountId = (network_id: string) => {
    if (!network_id) return ''
    const taken = new Set(accounts.filter(a => a.network_id === network_id).map(a => a.account_id))
    let candidate = network_id
    let n = 2
    while (taken.has(candidate)) candidate = `${network_id}_${n++}`
    return candidate
  }

  const patch = async (id: string, body: Record<string, unknown>) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, ...body } as EngineAccount : a)) // optimistic
    const res = await authFetch(ACC_API, { method: 'PATCH', body: JSON.stringify({ id, ...body }) })
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi cập nhật'); load() }
  }

  const remove = async (id: string, label: string) => {
    if (!(await confirmDlg({
      title: `Xóa tài khoản "${label}"?`,
      description: 'Chỉ gỡ định nghĩa — dữ liệu doanh thu đã lấy vẫn được giữ.',
    }))) return
    const res = await authFetch(`${ACC_API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Đã xóa tài khoản'); load(); onDataChanged?.() }
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi xóa')
  }

  // Số project đã gán network (có slug engine) nhưng chưa có engine_account nào.
  const usableSlugByName = new Map<string, string>()
  for (const n of networks) if (n.network_id) usableSlugByName.set(n.network_name.trim().toLowerCase(), n.network_id)
  const projectsWithAccount = new Set(accounts.map(a => a.project_id).filter(Boolean))
  const missingCount = projects.filter(p =>
    p.affiliate_network &&
    usableSlugByName.has(p.affiliate_network.trim().toLowerCase()) &&
    !projectsWithAccount.has(p.project_id)
  ).length

  const syncFromProjects = async () => {
    setSyncing(true)
    const res = await authFetch(`${ACC_API}/sync-from-projects`, { method: 'POST' })
    setSyncing(false)
    if (res.ok) {
      const d = await res.json()
      await load()
      const parts = []
      if (d.created > 0) parts.push(`tạo ${d.created} tài khoản`)
      if (d.url_filled > 0) parts.push(`điền URL cho ${d.url_filled} tài khoản`)
      if (parts.length) toast.success(`Đã ${parts.join(', ')} từ dự án.`)
      else toast.info('Không có dự án nào cần tạo thêm.')
    } else {
      toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo từ dự án')
    }
  }

  const openWizard = (net: string) => {
    const acc = accounts.find(a => a.network_id === net && a.dashboard_url)
    if (!acc) return
    const nm = networks.find(x => x.network_id === net)?.network_name || net
    setCfgPanel({ networkId: net, networkName: nm, accountId: acc.id, dashboardUrl: acc.dashboard_url ?? '' })
  }

  // Pill trạng thái kết nối của 1 account.
  const renderStatusPill = (a: EngineAccount) => {
    const cmd = activeCmd(a.id)
    const err = lastCmdError(a.id)
    if (cmd) {
      const label = cmd.type === 'login' ? 'Đang kết nối' : cmd.type === 'fetch' ? 'Đang đồng bộ' : cmd.type === 'fetch_breakdown' ? 'Đang đồng bộ (tối ưu)' : 'Đang dò'
      const elapsed = fmtElapsed(cmd)
      // Worker tắt → lệnh sẽ KHÔNG tiến triển: báo rõ (đứng yên) thay vì quay vô hạn như đang chạy.
      if (workerOffline) {
        return (
          <span title="Worker đang tắt — mở node engine/worker.js trên máy engine, hoặc bấm Hủy để bỏ lệnh.">
            <StatusPill tone="red" icon={WifiOff}>Worker tắt · lệnh chờ {elapsed}</StatusPill>
          </span>
        )
      }
      return <StatusPill tone="amber" icon={Loader2} spin>{label}… {elapsed}</StatusPill>
    }
    switch (a.login_status) {
      case 'ok': return <StatusPill tone="green">Đã kết nối</StatusPill>
      case 'needs_login': return <StatusPill tone="amber">Cần đăng nhập lại</StatusPill>
      case 'error': return <span title={err ?? undefined}><StatusPill tone="red">Lỗi{err ? ' ⓘ' : ''}</StatusPill></span>
      default: return <StatusPill tone="slate">Chưa kết nối</StatusPill>
    }
  }

  // 1 nút hành động chính theo state machine (+ menu ⋯ cho hành động phụ).
  const renderAction = (a: EngineAccount) => {
    const action = nextAction(a, activeCmd(a.id), isConfigured(a.network_id))
    const offlineTip = workerOffline ? 'Worker offline — mở node engine/worker.js trên máy engine' : undefined

    let primary: React.ReactNode = null
    switch (action.kind) {
      case 'busy':
        // Lối thoát khi "Đang kết nối…" bị kẹt: hủy lệnh ngay (kể cả worker offline) → pill hết busy,
        // các nút Kết nối/Đồng bộ hiện lại. Cửa sổ Chrome đang mở (nếu có) sẽ tự đóng khi hết giờ chờ.
        primary = (
          <Button size="sm" variant="outline" onClick={() => cancelCommand(a.id)}
            title="Hủy lệnh đang chờ/chạy để thoát trạng thái kẹt. Nếu đang mở cửa sổ đăng nhập, cửa sổ sẽ tự đóng khi hết thời gian chờ.">
            <Ban size={13} /> Hủy
          </Button>
        )
        break
      case 'need-url':
        primary = <span className="text-xs text-amber-600">← nhập URL dashboard</span>
        break
      case 'need-config':
        primary = (
          <Button size="sm" onClick={() => openWizard(a.network_id)} title="Dò dashboard và tạo cấu hình đọc doanh thu">
            <Wand2 size={13} /> Cấu hình
          </Button>
        )
        break
      case 'connect':
        primary = (
          <Button size="sm" disabled={workerOffline} onClick={() => sendCommand(a.id, 'login')}
            title={offlineTip ?? 'Mở trình duyệt đăng nhập trên máy worker (dùng lại phiên nếu còn)'}>
            <Plug size={13} /> Kết nối
          </Button>
        )
        break
      case 'relogin':
        primary = (
          <Button size="sm" disabled={workerOffline} onClick={() => sendCommand(a.id, 'login', true)}
            title={offlineTip ?? 'Xoá phiên cũ và đăng nhập lại'}>
            <LogIn size={13} /> Đăng nhập lại
          </Button>
        )
        break
      case 'sync':
        primary = (
          <Button size="sm" variant="outline" disabled={workerOffline} onClick={() => sendCommand(a.id, 'fetch')}
            title={offlineTip ?? 'Đồng bộ doanh thu ngay'}>
            <RefreshCw size={13} /> Đồng bộ
          </Button>
        )
        break
    }

    return (
      <div className="flex items-center gap-1.5">
        {primary}
        <div className="relative">
          <Button size="icon-sm" variant="ghost" title="Thao tác khác"
            onClick={(e) => {
              if (openMenuId === a.id) { setOpenMenuId(null); setMenuPos(null); return }
              // Vị trí tuyệt đối theo nút (position:fixed qua portal) để KHÔNG bị overflow của
              // thẻ network / wrapper bảng cắt mất. Canh phải; lật lên nếu sát đáy màn hình.
              const r = e.currentTarget.getBoundingClientRect()
              const top = r.bottom + 120 > window.innerHeight ? r.top - 120 : r.bottom + 4
              setMenuPos({ top, left: Math.max(8, r.right - 192) })
              setOpenMenuId(a.id)
            }}>
            <MoreHorizontal size={14} />
          </Button>
          {openMenuId === a.id && menuPos && createPortal(
            <>
              <div className="fixed inset-0 z-[9998]" onClick={() => { setOpenMenuId(null); setMenuPos(null) }} />
              <div
                style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 9999 }}
                className="w-48 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
                <button
                  onClick={() => { setOpenMenuId(null); sendCommand(a.id, 'login', true) }}
                  disabled={workerOffline || !a.dashboard_url || !isConfigured(a.network_id) || !!activeCmd(a.id)}
                  className="w-full text-left px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"
                >
                  <LogIn size={13} /> Đăng nhập lại (xoá phiên)
                </button>
                <button
                  onClick={() => { setOpenMenuId(null); openWizard(a.network_id) }}
                  disabled={!accounts.some(x => x.network_id === a.network_id && x.dashboard_url)}
                  className="w-full text-left px-3 py-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 flex items-center gap-2"
                >
                  <Wand2 size={13} /> Cấu hình network
                </button>
                <button
                  onClick={() => { setOpenMenuId(null); remove(a.id, a.label) }}
                  className="w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 size={13} /> Xóa tài khoản
                </button>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>
    )
  }

  const byNetwork = [...new Set(accounts.map(a => a.network_id))]

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        {missingCount > 0 && (
          <Button variant="outline" onClick={syncFromProjects} disabled={syncing}
            title="Tạo engine account cho các dự án đã gán affiliate network (có slug engine) mà chưa có tài khoản">
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Tạo từ dự án ({missingCount})
          </Button>
        )}
        <Button onClick={() => setAdding(v => !v)}>
          <Plus size={15} /> Thêm tài khoản
        </Button>
      </div>

      {adding && (
        <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-slate-500 space-y-1">
              <span>Network</span>
              <select value={fNetwork} onChange={e => setFNetwork(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700">
                <option value="" disabled>— chọn network —</option>
                {networks.map(n => (
                  <option key={n.id} value={n.network_id ?? ''} disabled={!n.network_id}>
                    {n.network_name}{n.network_id ? '' : ' (chưa có slug engine)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500 space-y-1">
              <span>Dự án</span>
              <select
                value={fProject}
                onChange={e => {
                  setFProject(e.target.value)
                  // Autofill từ dự án: URL dashboard (nếu ô đang trống) + network (nếu khớp slug).
                  const p = projects.find(x => x.project_id === e.target.value)
                  if (!p) return
                  if (!fUrl.trim()) {
                    const u = normalizeDashboardUrl(p.affiliate_url)
                    if (u) setFUrl(u)
                  }
                  const slug = p.affiliate_network ? usableSlugByName.get(p.affiliate_network.trim().toLowerCase()) : undefined
                  if (slug) setFNetwork(slug)
                }}
                className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700"
              >
                <option value="">— chưa gán —</option>
                {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 space-y-1 sm:col-span-2">
              <span>URL dashboard <span className="text-slate-400">(tự điền khi chọn dự án — vd https://partner.blancvpn.com)</span></span>
              <Input value={fUrl} onChange={e => setFUrl(e.target.value)} placeholder="https://..." className="font-mono" />
            </label>
          </div>
          {fNetwork && (
            <p className="text-xs text-slate-500">
              account_id sẽ tạo:{' '}
              <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200 text-slate-700">{nextAccountId(fNetwork)}</code>
              {' '}— dùng làm tên profile khi đăng nhập. Nhiều account có thể chung 1 URL nhưng khác login.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Hủy</Button>
            <Button onClick={create} disabled={saving || !fNetwork}>
              {saving && <Loader2 size={14} className="animate-spin" />} Lưu
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={3} cols={5} />
      ) : accounts.length === 0 ? (
        <EmptyState message='Chưa có tài khoản nào. Gán "URL Affiliate" + "Affiliate Network" cho dự án (Quản lý dự án) để tự sinh, hoặc nhấn "Thêm tài khoản".' />
      ) : (
        <div className="space-y-4">
          {byNetwork.map(net => (
            <div key={net} className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 text-sm font-medium text-slate-700 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {(() => {
                    const n = networks.find(x => x.network_id === net)
                    return <>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: n?.color ?? '#6b7280' }} />
                      {n?.network_name || net}
                    </>
                  })()}
                  {!isConfigured(net) && <StatusPill tone="amber">Chưa cấu hình</StatusPill>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => openWizard(net)}
                  disabled={!accounts.some(a => a.network_id === net && a.dashboard_url)}
                  title={accounts.some(a => a.network_id === net && a.dashboard_url) ? 'Dò dashboard và tạo/sửa cấu hình đọc doanh thu' : 'Cần 1 account có URL dashboard trong network này'}>
                  <Wand2 size={13} /> Cấu hình
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">account_id</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Dự án</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">URL dashboard</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Kết nối</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Hành động</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-center">Bật</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.filter(a => a.network_id === net).map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-slate-500 font-mono text-xs">{a.account_id}</td>
                        <td className="px-3 py-2">
                          <select
                            value={a.project_id ?? ''}
                            onChange={e => patch(a.id, { project_id: e.target.value || null })}
                            className="border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-700 max-w-[200px]"
                            title={projectName(a.project_id)}
                          >
                            <option value="">— chưa gán —</option>
                            {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            key={a.dashboard_url ?? ''}
                            defaultValue={a.dashboard_url ?? ''}
                            onBlur={e => { const v = e.target.value.trim(); if (v !== (a.dashboard_url ?? '')) patch(a.id, { dashboard_url: v || null }) }}
                            placeholder="https://..."
                            className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-600 font-mono w-[190px]"
                          />
                        </td>
                        <td className="px-3 py-2">{renderStatusPill(a)}</td>
                        <td className="px-3 py-2">{renderAction(a)}</td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={a.enabled} onChange={e => patch(a.id, { enabled: e.target.checked })} className="accent-indigo-600" title="Tắt = bỏ qua khi auto-sync" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {accounts.length > 0 && (
        <details className="text-xs text-slate-500 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/50">
          <summary className="cursor-pointer font-medium text-slate-600">
            Mẹo: gắn sub-id để doanh thu breakdown gắn đúng từng campaign (Tối Ưu Camp)
          </summary>
          <div className="mt-2 space-y-1 leading-relaxed">
            <p>
              Khi network có báo cáo chuyển đổi (quốc gia/thiết bị…), Engine tự thu về cho mục Tối Ưu Camp.
              Mặc định doanh thu gắn theo <b>dự án</b>; muốn gắn chính xác theo <b>campaign</b> (kể cả nhiều camp chung 1 dự án):
            </p>
            <p>
              1. Google Ads → Campaign settings → <b>Final URL suffix</b>: thêm{' '}
              <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">&lt;tham_số_sub_của_network&gt;={'{campaignid}'}</code>{' '}
              (vd <code className="font-mono">aff_sub={'{campaignid}'}</code> hoặc <code className="font-mono">s1={'{campaignid}'}</code> — xem docs network).
            </p>
            <p>
              2. Network trả sub-id theo từng chuyển đổi → Engine tự tách campaign id (không cần script).
              Mục Tối Ưu Camp sẽ hiện badge &quot;gắn theo campaign (sub-id)&quot; khi đủ dữ liệu.
            </p>
          </div>
        </details>
      )}

      {cfgPanel && (
        <ConfigWizard
          networkId={cfgPanel.networkId}
          networkName={cfgPanel.networkName}
          accountId={cfgPanel.accountId}
          dashboardUrl={cfgPanel.dashboardUrl}
          workerState={workerState}
          onClose={() => setCfgPanel(null)}
          onSaved={() => { setCfgPanel(null); toast.success('Đã lưu cấu hình network'); load() }}
        />
      )}
    </div>
  )
}
