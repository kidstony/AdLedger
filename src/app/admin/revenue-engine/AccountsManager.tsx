'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, Info, Wand2, Plug, RefreshCw, LogIn } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import NetworkConfigPanel from './NetworkConfigPanel'

interface EngineAccount {
  id: string
  network_id: string
  account_id: string
  label: string
  project_id: string | null
  enabled: boolean
  dashboard_url: string | null
  login_url: string | null
  login_status: 'never' | 'ok' | 'needs_login' | 'error'
  last_login_at: string | null
  created_at: string
}
interface EngineCommand {
  id: string
  type: 'login' | 'fetch'
  account_id: string | null
  status: 'pending' | 'running' | 'done' | 'error'
  message: string | null
}
interface NetworkOpt { id: string; network_id: string | null; network_name: string; color?: string }
interface ProjectOpt { project_id: string; name: string; affiliate_network?: string | null }

async function authFetch(url: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
  })
}

const API = '/api/admin/revenue-engine/accounts'
const CMD_API = '/api/admin/revenue-engine/commands'
const SET_API = '/api/admin/revenue-engine/settings'

interface Settings { auto_sync_enabled: boolean; interval_hours: number; last_auto_sync_at: string | null }

export default function AccountsManager() {
  const [accounts, setAccounts] = useState<EngineAccount[]>([])
  const [networks, setNetworks] = useState<NetworkOpt[]>([])
  const [projects, setProjects] = useState<ProjectOpt[]>([])
  const [configured, setConfigured] = useState<string[]>([])
  const [commands, setCommands] = useState<EngineCommand[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // form thêm mới
  const [adding, setAdding] = useState(false)
  const [fNetwork, setFNetwork] = useState('')
  const [fProject, setFProject] = useState('')
  const [fUrl, setFUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [cfgPanel, setCfgPanel] = useState<{ networkId: string; networkName: string; accountId: string; dashboardUrl: string } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [intervalInput, setIntervalInput] = useState('6')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch(API)
    if (res.ok) {
      const d = await res.json()
      setAccounts(d.accounts ?? [])
      setNetworks(d.networks ?? [])
      setProjects(d.projects ?? [])
      setConfigured(d.configured ?? [])
      // Mặc định chọn network đầu tiên CÓ slug engine (dùng được).
      if (!fNetwork) {
        const firstUsable = (d.networks ?? []).find((n: NetworkOpt) => n.network_id)
        if (firstUsable) setFNetwork(firstUsable.network_id as string)
      }
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Không tải được dữ liệu')
    }
    setLoading(false)
  }, [fNetwork])

  const loadCommands = useCallback(async () => {
    const res = await authFetch(CMD_API)
    if (res.ok) setCommands((await res.json()).commands ?? [])
  }, [])

  const loadSettings = useCallback(async () => {
    const res = await authFetch(SET_API)
    if (res.ok) { const s = (await res.json()).settings; setSettings(s); setIntervalInput(String(s?.interval_hours ?? 6)) }
  }, [])

  const saveSettings = async (patch: Partial<Settings>) => {
    const res = await authFetch(SET_API, { method: 'PUT', body: JSON.stringify(patch) })
    if (res.ok) setSettings((await res.json()).settings)
    else setError((await res.json().catch(() => ({}))).error ?? 'Lỗi lưu cài đặt')
  }

  useEffect(() => { load(); loadCommands(); loadSettings() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Có lệnh đang chờ/chạy → poll nhẹ để cập nhật trạng thái + login_status.
  const hasActive = commands.some(c => c.status === 'pending' || c.status === 'running')
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(() => { loadCommands(); load() }, 4000)
    return () => clearInterval(t)
  }, [hasActive, loadCommands, load])

  // Lệnh đang chờ/chạy của 1 account (nếu có).
  const activeCmd = (accountId: string) =>
    commands.find(c => c.account_id === accountId && (c.status === 'pending' || c.status === 'running'))
  // Lỗi lệnh gần nhất (commands trả về giảm dần theo thời gian).
  const lastCmdError = (accountId: string) => {
    const c = commands.find(x => x.account_id === accountId)
    return c && c.status === 'error' ? c.message : null
  }
  const isConfigured = (networkId: string) => configured.includes(networkId)

  const sendCommand = async (accountId: string, type: 'login' | 'fetch', force = false) => {
    setError(null)
    const res = await authFetch(CMD_API, { method: 'POST', body: JSON.stringify({ type, account_id: accountId, force }) })
    if (res.ok) loadCommands()
    else setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo lệnh')
  }

  // Trạng thái kết nối để hiển thị badge.
  const connState = (a: EngineAccount): { text: string; cls: string; spin?: boolean } => {
    const cmd = activeCmd(a.id)
    if (cmd?.type === 'login') return { text: 'Đang kết nối…', cls: 'bg-amber-50 text-amber-700 border-amber-200', spin: true }
    if (cmd?.type === 'fetch') return { text: 'Đang đồng bộ…', cls: 'bg-amber-50 text-amber-700 border-amber-200', spin: true }
    switch (a.login_status) {
      case 'ok':          return { text: 'Đã kết nối',        cls: 'bg-green-50 text-green-700 border-green-200' }
      case 'needs_login': return { text: 'Cần đăng nhập lại', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
      case 'error':       return { text: 'Lỗi',               cls: 'bg-red-50 text-red-700 border-red-200' }
      default:            return { text: 'Chưa kết nối',      cls: 'bg-slate-100 text-slate-500 border-slate-200' }
    }
  }

  const projectName = (id: string | null) => id ? (projects.find(p => p.project_id === id)?.name ?? id) : '— chưa gán —'

  const create = async () => {
    setSaving(true); setError(null)
    const res = await authFetch(API, {
      method: 'POST',
      body: JSON.stringify({ network_id: fNetwork, project_id: fProject || null, dashboard_url: fUrl.trim() || null }),
    })
    setSaving(false)
    if (res.ok) {
      setAdding(false); setFProject(''); setFUrl('')
      load()
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo tài khoản')
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
    const res = await authFetch(API, { method: 'PATCH', body: JSON.stringify({ id, ...body }) })
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Lỗi cập nhật'); load() }
  }

  const remove = async (id: string, label: string) => {
    if (!confirm(`Xóa định nghĩa tài khoản "${label}"? Dữ liệu doanh thu đã lấy vẫn được giữ.`)) return
    const res = await authFetch(`${API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) load()
    else setError((await res.json().catch(() => ({}))).error ?? 'Lỗi xóa')
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
    setSyncing(true); setError(null)
    const res = await authFetch(`${API}/sync-from-projects`, { method: 'POST' })
    setSyncing(false)
    if (res.ok) {
      const d = await res.json()
      await load()
      alert(d.created > 0 ? `Đã tạo ${d.created} tài khoản từ dự án.` : 'Không có dự án nào cần tạo thêm.')
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo từ dự án')
    }
  }

  const byNetwork = [...new Set(accounts.map(a => a.network_id))]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
        <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
        <p>
          Thêm/gán tài khoản → dự án ở đây. Việc <span className="font-medium text-slate-600">đăng nhập dashboard</span> chạy
          trên máy cài engine: <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">node login.js --network=&lt;net&gt; --account=&lt;id&gt;</code>,
          sau đó <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">node fetch-all.js --network=&lt;net&gt;</code>.
        </p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {settings && (
        <div className="flex flex-wrap items-center gap-3 text-sm bg-white border border-slate-200 rounded-lg px-3 py-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.auto_sync_enabled} onChange={e => saveSettings({ auto_sync_enabled: e.target.checked })} className="accent-indigo-600" />
            <span className="font-medium text-slate-700">Tự động đồng bộ</span>
          </label>
          <span className="text-slate-400">·</span>
          <div className="flex items-center gap-1 text-slate-600">
            mỗi
            <input type="number" min={0.5} max={168} step={0.5} value={intervalInput}
              onChange={e => setIntervalInput(e.target.value)}
              onBlur={() => { const h = Number(intervalInput); if (Number.isFinite(h) && h !== settings.interval_hours) saveSettings({ interval_hours: h }) }}
              className="w-16 border border-slate-200 rounded px-2 py-1 text-sm" />
            giờ
          </div>
          <span className="text-slate-400">·</span>
          <span className="text-xs text-slate-500">
            Lần cuối: {settings.last_auto_sync_at ? new Date(settings.last_auto_sync_at).toLocaleString('vi-VN') : '—'}
          </span>
          <span className="text-xs text-slate-400">(worker tự fetch account "Đã kết nối"; cần worker đang chạy)</span>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {missingCount > 0 && (
          <button
            onClick={syncFromProjects}
            disabled={syncing}
            title="Tạo engine account cho các dự án đã gán affiliate network (có slug engine) mà chưa có tài khoản"
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Tạo từ dự án ({missingCount})
          </button>
        )}
        <button
          onClick={() => { setAdding(v => !v); setError(null) }}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus size={15} /> Thêm tài khoản
        </button>
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
              <select value={fProject} onChange={e => setFProject(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700">
                <option value="">— chưa gán —</option>
                {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 space-y-1 sm:col-span-2">
              <span>URL dashboard <span className="text-slate-400">(vd https://partner.blancvpn.com hoặc https://ten-brand.tolt.io)</span></span>
              <input value={fUrl} onChange={e => setFUrl(e.target.value)} placeholder="https://..." className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700 font-mono" />
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
            <button onClick={() => setAdding(false)} className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">Hủy</button>
            <button onClick={create} disabled={saving || !fNetwork} className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
              {saving && <Loader2 size={14} className="animate-spin" />} Lưu
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Đang tải...
        </div>
      ) : accounts.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">Chưa có tài khoản nào. Nhấn "Thêm tài khoản".</div>
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
                </div>
                {(() => {
                  const acc = accounts.find(a => a.network_id === net && a.dashboard_url)
                  const nm = networks.find(x => x.network_id === net)?.network_name || net
                  const cfg = isConfigured(net)
                  return (
                    <div className="flex items-center gap-2">
                      {!cfg && <span className="text-xs text-amber-600">Chưa cấu hình</span>}
                      <button
                        onClick={() => acc && setCfgPanel({ networkId: net, networkName: nm, accountId: acc.id, dashboardUrl: acc.dashboard_url ?? '' })}
                        disabled={!acc}
                        title={acc ? 'Dò dashboard và tạo cấu hình đọc doanh thu tự động' : 'Cần 1 account có URL dashboard trong network này'}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border disabled:opacity-40 ${cfg ? 'border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50' : 'border-indigo-600 text-white bg-indigo-600 hover:bg-indigo-700'}`}
                      >
                        <Wand2 size={13} /> Cấu hình tự động
                      </button>
                    </div>
                  )
                })()}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">account_id</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Dự án</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">URL dashboard</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Kết nối</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-center">Bật</th>
                      <th className="px-3 py-2"></th>
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
                            className="border border-slate-200 rounded-md px-2 py-1 text-sm text-slate-700 max-w-[220px]"
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
                            className="border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-600 font-mono w-[210px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {(() => {
                            const s = connState(a)
                            const busy = !!activeCmd(a.id)
                            const cfg = isConfigured(a.network_id)
                            const err = lastCmdError(a.id)
                            const needCfg = !cfg ? 'Cấu hình network này trước (bấm "Cấu hình tự động")' : ''
                            return (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${s.cls}`}>
                                  {s.spin && <Loader2 size={11} className="animate-spin" />}{s.text}
                                </span>
                                <button
                                  onClick={() => sendCommand(a.id, 'login')}
                                  disabled={busy || !a.dashboard_url || !cfg}
                                  title={needCfg || (a.dashboard_url ? 'Mở trình duyệt đăng nhập trên máy worker (dùng lại phiên nếu còn hợp lệ)' : 'Nhập URL dashboard trước')}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  <Plug size={12} /> Kết nối
                                </button>
                                <button
                                  onClick={() => sendCommand(a.id, 'login', true)}
                                  disabled={busy || !a.dashboard_url || !cfg}
                                  title={needCfg || 'Xoá phiên cũ và đăng nhập lại (đổi/làm mới tài khoản)'}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  <LogIn size={12} /> Đăng nhập lại
                                </button>
                                <button
                                  onClick={() => sendCommand(a.id, 'fetch')}
                                  disabled={busy || a.login_status !== 'ok' || !cfg}
                                  title={needCfg || (a.login_status === 'ok' ? 'Đồng bộ doanh thu ngay' : 'Cần kết nối trước')}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                                >
                                  <RefreshCw size={12} /> Đồng bộ
                                </button>
                                {err && <span className="text-xs text-red-600 max-w-[220px] truncate" title={err}>⚠ {err}</span>}
                              </div>
                            )
                          })()}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={a.enabled} onChange={e => patch(a.id, { enabled: e.target.checked })} className="accent-indigo-600" />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => remove(a.id, a.label)} className="text-slate-400 hover:text-red-600 transition-colors" title="Xóa">
                            <Trash2 size={15} />
                          </button>
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

      {cfgPanel && (
        <NetworkConfigPanel
          networkId={cfgPanel.networkId}
          networkName={cfgPanel.networkName}
          accountId={cfgPanel.accountId}
          dashboardUrl={cfgPanel.dashboardUrl}
          authFetch={authFetch}
          onClose={() => setCfgPanel(null)}
          onSaved={() => { setCfgPanel(null); load() }}
        />
      )}
    </div>
  )
}
