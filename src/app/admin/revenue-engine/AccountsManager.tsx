'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Loader2, Info } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface EngineAccount {
  id: string
  network_id: string
  account_id: string
  label: string
  project_id: string | null
  enabled: boolean
  created_at: string
}
interface NetworkOpt { network_id: string; network_name: string }
interface ProjectOpt { project_id: string; name: string }

async function authFetch(url: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
  })
}

const API = '/api/admin/revenue-engine/accounts'

export default function AccountsManager() {
  const [accounts, setAccounts] = useState<EngineAccount[]>([])
  const [networks, setNetworks] = useState<NetworkOpt[]>([])
  const [projects, setProjects] = useState<ProjectOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // form thêm mới
  const [adding, setAdding] = useState(false)
  const [fNetwork, setFNetwork] = useState('')
  const [fAccountId, setFAccountId] = useState('')
  const [fLabel, setFLabel] = useState('')
  const [fProject, setFProject] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch(API)
    if (res.ok) {
      const d = await res.json()
      setAccounts(d.accounts ?? [])
      setNetworks(d.networks ?? [])
      setProjects(d.projects ?? [])
      if (!fNetwork && d.networks?.[0]) setFNetwork(d.networks[0].network_id)
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Không tải được dữ liệu')
    }
    setLoading(false)
  }, [fNetwork])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const projectName = (id: string | null) => id ? (projects.find(p => p.project_id === id)?.name ?? id) : '— chưa gán —'

  const create = async () => {
    setSaving(true); setError(null)
    const res = await authFetch(API, {
      method: 'POST',
      body: JSON.stringify({ network_id: fNetwork, account_id: fAccountId.trim(), label: fLabel.trim(), project_id: fProject || null }),
    })
    setSaving(false)
    if (res.ok) {
      setAdding(false); setFAccountId(''); setFLabel(''); setFProject('')
      load()
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Lỗi tạo tài khoản')
    }
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

      <div className="flex justify-end">
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
                {networks.map(n => <option key={n.network_id} value={n.network_id}>{n.network_name || n.network_id}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 space-y-1">
              <span>Dự án</span>
              <select value={fProject} onChange={e => setFProject(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700">
                <option value="">— chưa gán —</option>
                {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500 space-y-1">
              <span>account_id (slug, tên profile)</span>
              <input value={fAccountId} onChange={e => setFAccountId(e.target.value)} placeholder="blancvpn_2" className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700 font-mono" />
            </label>
            <label className="text-xs text-slate-500 space-y-1">
              <span>Nhãn hiển thị</span>
              <input value={fLabel} onChange={e => setFLabel(e.target.value)} placeholder="BlancVPN Ref 2" className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-sm text-slate-700" />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">Hủy</button>
            <button onClick={create} disabled={saving || !fAccountId.trim()} className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5">
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
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 text-sm font-medium text-slate-700">
                {networks.find(n => n.network_id === net)?.network_name || net}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Tài khoản</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">account_id</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Dự án</th>
                      <th className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide text-center">Bật</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.filter(a => a.network_id === net).map(a => (
                      <tr key={a.id}>
                        <td className="px-3 py-2 text-slate-700">{a.label}</td>
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
    </div>
  )
}
