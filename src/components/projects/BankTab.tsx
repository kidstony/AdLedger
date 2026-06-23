'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, ChevronRight, ArrowLeft, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Bank, BankAccount, Project } from '@/lib/types'

interface Props {
  projects: Project[]
}

// ─── Tầng 1: Danh sách Bank ──────────────────────────────────────────────────

function BankList({ projects, onEnter }: { projects: Project[]; onEnter: (bank: Bank) => void }) {
  const [banks, setBanks] = useState<(Bank & { bank_accounts: [{ count: number }] })[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Bank } | null>(null)
  const [form, setForm] = useState({ name: '', type: 'international' as 'local' | 'international' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Bank | null>(null)
  const [deleteError, setDeleteError] = useState('')

  function load() {
    fetch('/api/banks')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBanks(d) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // Count projects per bank (via bank_accounts)
  const projectsByBank = useMemo(() => {
    const map = new Map<string, number>()
    projects.forEach(p => {
      if (p.bank_accounts?.bank_id) {
        const bid = p.bank_accounts.bank_id
        map.set(bid, (map.get(bid) ?? 0) + 1)
      }
    })
    return map
  }, [projects])

  function openAdd() { setForm({ name: '', type: 'international' }); setDialog({ mode: 'add' }) }
  function openEdit(b: Bank) { setForm({ name: b.name, type: b.type }); setDialog({ mode: 'edit', data: b }) }

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (dialog?.mode === 'add') {
        const res = await fetch('/api/banks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
        const created = await res.json()
        if (created.id) setBanks(prev => [...prev, { ...created, bank_accounts: [{ count: 0 }] }])
      } else if (dialog?.data) {
        const res = await fetch('/api/banks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dialog.data.id, ...form }) })
        const updated = await res.json()
        if (updated.id) setBanks(prev => prev.map(b => b.id === updated.id ? { ...b, ...updated } : b))
      }
      setDialog(null)
    } finally { setSaving(false) }
  }

  async function handleDelete(bank: Bank) {
    setDeleteError('')
    const res = await fetch(`/api/banks?id=${bank.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { setDeleteError(json.error ?? 'Lỗi xóa'); return }
    setBanks(prev => prev.filter(b => b.id !== bank.id))
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{banks.length} ngân hàng</p>
        <Button onClick={openAdd} className="gap-1.5"><Plus size={14} /> Thêm bank</Button>
      </div>

      {loading ? (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {[1, 2, 3].map(i => <div key={i} className="px-4 py-3 flex gap-4"><div className="w-32 h-3 bg-slate-200 rounded animate-pulse" /><div className="w-20 h-3 bg-slate-200 rounded animate-pulse" /></div>)}
        </div>
      ) : banks.length === 0 ? (
        <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">Chưa có ngân hàng nào. Nhấn "+ Thêm bank" để bắt đầu.</div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Tên ngân hàng', 'Loại', 'Số tài khoản', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {banks.map(bank => {
                const accCount = bank.bank_accounts?.[0]?.count ?? 0
                const projCount = projectsByBank.get(bank.id) ?? 0
                return (
                  <tr key={bank.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => onEnter(bank)}>
                    <td className="px-4 py-3 font-medium text-slate-800">💳 {bank.name}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bank.type === 'international' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                        {bank.type === 'international' ? 'Quốc tế' : 'Nội địa'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {accCount > 0
                        ? <>{accCount} tài khoản{projCount > 0 ? ` · ${projCount} dự án` : ''}</>
                        : <span className="text-slate-300">Chưa có TK</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        <button onClick={() => openEdit(bank)} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => { setDeleteError(''); setConfirmDelete(bank) }} className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                        <button onClick={() => onEnter(bank)} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><ChevronRight size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">{dialog.mode === 'add' ? 'Thêm ngân hàng' : 'Sửa ngân hàng'}</h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Tên ngân hàng</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="PayPal, MB Bank, Vietcombank..." autoFocus />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Loại</label>
                <div className="flex gap-2">
                  {(['international', 'local'] as const).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-2 text-sm rounded-md border transition-colors ${form.type === t ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      {t === 'international' ? 'Quốc tế' : 'Nội địa'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa ngân hàng?</h3>
            <p className="text-sm text-slate-600 mb-1"><strong>{confirmDelete.name}</strong> sẽ bị xóa vĩnh viễn.</p>
            {deleteError && <p className="text-sm text-red-600 mt-2 bg-red-50 px-3 py-2 rounded">{deleteError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Xóa</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tầng 2: Danh sách tài khoản trong 1 bank ────────────────────────────────

function AccountList({ bank, projects, onBack }: { bank: Bank; projects: Project[]; onBack: () => void }) {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: BankAccount } | null>(null)
  const [form, setForm] = useState({ account_identifier: '', owner_name: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<BankAccount | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [usagePopup, setUsagePopup] = useState<{ account: BankAccount; projectList: Project[] } | null>(null)

  function load() {
    fetch(`/api/bank-accounts?bank_id=${bank.id}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAccounts(d) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [bank.id])

  const usageCount = useMemo(() => {
    const map = new Map<string, Project[]>()
    projects.forEach(p => {
      if (p.bank_account_id) {
        if (!map.has(p.bank_account_id)) map.set(p.bank_account_id, [])
        map.get(p.bank_account_id)!.push(p)
      }
    })
    return map
  }, [projects])

  function openAdd() { setForm({ account_identifier: '', owner_name: '', note: '' }); setDialog({ mode: 'add' }) }
  function openEdit(acc: BankAccount) { setForm({ account_identifier: acc.account_identifier, owner_name: acc.owner_name, note: acc.note ?? '' }); setDialog({ mode: 'edit', data: acc }) }

  async function handleSave() {
    if (!form.account_identifier.trim() || !form.owner_name.trim()) return
    setSaving(true)
    try {
      if (dialog?.mode === 'add') {
        const res = await fetch('/api/bank-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank_id: bank.id, ...form, note: form.note || null }) })
        const created = await res.json()
        if (created.id) setAccounts(prev => [...prev, created])
      } else if (dialog?.data) {
        const res = await fetch('/api/bank-accounts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dialog.data.id, ...form, note: form.note || null }) })
        const updated = await res.json()
        if (updated.id) setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
      }
      setDialog(null)
    } finally { setSaving(false) }
  }

  async function handleDelete(acc: BankAccount) {
    setDeleteError('')
    const res = await fetch(`/api/bank-accounts?id=${acc.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok) { setDeleteError(json.error ?? 'Lỗi xóa'); return }
    setAccounts(prev => prev.filter(a => a.id !== acc.id))
    setConfirmDelete(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
            <ArrowLeft size={14} /> Quay lại
          </button>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-2">
            <span className="text-lg">💳</span>
            <span className="font-semibold text-slate-800">{bank.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${bank.type === 'international' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
              {bank.type === 'international' ? 'Quốc tế' : 'Nội địa'}
            </span>
          </div>
        </div>
        <Button onClick={openAdd} className="gap-1.5"><Plus size={14} /> Thêm tài khoản</Button>
      </div>

      {loading ? (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {[1, 2, 3].map(i => <div key={i} className="px-4 py-3 flex gap-4"><div className="w-40 h-3 bg-slate-200 rounded animate-pulse" /><div className="w-24 h-3 bg-slate-200 rounded animate-pulse" /></div>)}
        </div>
      ) : accounts.length === 0 ? (
        <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">Chưa có tài khoản nào trong {bank.name}. Nhấn "+ Thêm tài khoản".</div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Email / Số TK', 'Người quản lý', 'Ghi chú', 'Sử dụng', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => {
                const projList = usageCount.get(acc.id) ?? []
                return (
                  <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{acc.account_identifier}</td>
                    <td className="px-4 py-3 text-slate-600">{acc.owner_name}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{acc.note ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {projList.length > 0 ? (
                        <button
                          onClick={() => setUsagePopup({ account: acc, projectList: projList })}
                          className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors cursor-pointer">
                          {projList.length} dự án
                        </button>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(acc)} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><Pencil size={13} /></button>
                        <button onClick={() => { setDeleteError(''); setConfirmDelete(acc) }} className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit account modal */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-1">{dialog.mode === 'add' ? 'Thêm tài khoản' : 'Sửa tài khoản'}</h3>
            <p className="text-xs text-slate-400 mb-4">💳 {bank.name}</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Email / Số tài khoản</label>
                <Input value={form.account_identifier} onChange={e => setForm(f => ({ ...f, account_identifier: e.target.value }))} placeholder="account@email.com hoặc 0901234567" autoFocus />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Người quản lý</label>
                <Input value={form.owner_name} onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="Nguyễn Văn A" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Ghi chú (tuỳ chọn)</label>
                <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="..." />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa tài khoản?</h3>
            <p className="text-sm text-slate-600 mb-1">
              <span className="font-mono">{confirmDelete.account_identifier}</span> sẽ bị xóa.
            </p>
            {deleteError && <p className="text-sm text-red-600 mt-2 bg-red-50 px-3 py-2 rounded">{deleteError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Xóa</Button>
            </div>
          </div>
        </div>
      )}

      {/* Usage popup: click X dự án → show list */}
      {usagePopup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">Dự án đang sử dụng</h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">{usagePopup.account.account_identifier}</p>
              </div>
              <button onClick={() => setUsagePopup(null)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={15} />
              </button>
            </div>
            <ul className="space-y-1.5">
              {usagePopup.projectList.map(p => (
                <li key={p.project_id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-50 text-sm text-slate-700">
                  <span className="font-mono text-xs text-slate-400">{p.project_id}</span>
                  <span className="font-medium">{p.name}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setUsagePopup(null)}>Đóng</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function BankTab({ projects }: Props) {
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null)

  return selectedBank
    ? <AccountList bank={selectedBank} projects={projects} onBack={() => setSelectedBank(null)} />
    : <BankList projects={projects} onEnter={setSelectedBank} />
}
