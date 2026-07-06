'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2, X, Copy, Check, AlertTriangle, ChevronDown, ChevronRight, Wallet, Building2, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Bank, BankAccount, Project } from '@/lib/types'
import { toast } from 'sonner'
import TableSkeleton from '@/components/ui/TableSkeleton'
import EmptyState from '@/components/ui/EmptyState'
import { supabase } from '@/lib/supabase'

// API routes require an Authorization: Bearer <token> header (getCallerProfile).
// Without it every request 401s and the page renders as empty.
async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { Authorization: `Bearer ${session?.access_token ?? ''}` }
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

// ─── Crypto constants ─────────────────────────────────────────────────────────

const COINS = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'TON', 'Khác']

const COIN_NETWORKS: Record<string, string[]> = {
  USDT: ['TRC20', 'ERC20', 'BEP20', 'SOL'],
  USDC: ['ERC20', 'BEP20', 'TRC20', 'ARB', 'OP', 'BASE', 'POL', 'SOL', 'AVAX'],
  BTC: ['Bitcoin', 'Lightning'],
  ETH: ['ERC20', 'ARB', 'OP', 'BASE'],
  BNB: ['BEP20'],
  SOL: ['SOL'],
  TRX: ['TRC20'],
  TON: ['TON'],
  Khác: ['ERC20', 'TRC20', 'BEP20', 'SOL', 'ARB', 'OP', 'BASE', 'POL', 'AVAX', 'Khác'],
}

const NETWORK_STYLES: Record<string, string> = {
  TRC20:     'bg-green-100 text-green-700',
  ERC20:     'bg-blue-100 text-blue-700',
  BEP20:     'bg-yellow-100 text-yellow-700',
  SOL:       'bg-purple-100 text-purple-700',
  Bitcoin:   'bg-orange-100 text-orange-700',
  Lightning: 'bg-yellow-100 text-yellow-700',
  TON:       'bg-cyan-100 text-cyan-700',
  ARB:       'bg-sky-100 text-sky-700',
  OP:        'bg-red-100 text-red-700',
  BASE:      'bg-indigo-100 text-indigo-700',
  POL:       'bg-violet-100 text-violet-700',
  AVAX:      'bg-rose-100 text-rose-700',
}

const NETWORK_WARNING: Record<string, string> = {
  TRC20:     'Chỉ nhận từ mạng TRON. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  ERC20:     'Chỉ nhận từ mạng Ethereum. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  BEP20:     'Chỉ nhận từ mạng BNB Chain. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  SOL:       'Chỉ nhận từ mạng Solana (SPL). Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  Bitcoin:   'Chỉ nhận từ mạng Bitcoin mainnet.',
  Lightning: 'Chỉ nhận qua Lightning Network (off-chain).',
  TON:       'Chỉ nhận từ mạng TON.',
  ARB:       'Chỉ nhận từ mạng Arbitrum One. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  OP:        'Chỉ nhận từ mạng Optimism (OP Mainnet). Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  BASE:      'Chỉ nhận từ mạng Base. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  POL:       'Chỉ nhận từ mạng Polygon PoS. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
  AVAX:      'Chỉ nhận từ mạng Avalanche C-Chain. Gửi sai network sẽ MẤT TIỀN vĩnh viễn.',
}

function networkStyle(n: string | null | undefined) {
  return NETWORK_STYLES[n ?? ''] ?? 'bg-slate-100 text-slate-600'
}

function shortenAddr(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setDone(true)
    setTimeout(() => setDone(false), 1500)
  }
  return (
    <button onClick={copy} title="Copy" className={`p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors ${className}`}>
      {done ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

function BankIcon({ bank }: { bank: Bank }) {
  if (bank.bank_category === 'crypto') return <Wallet size={15} className="text-orange-500 shrink-0" />
  if (bank.type === 'international') return <Globe size={15} className="text-blue-500 shrink-0" />
  return <Building2 size={15} className="text-green-600 shrink-0" />
}

const BANK_CATEGORY_OPTIONS: { cat: 'traditional' | 'crypto'; label: string }[] = [
  { cat: 'traditional', label: 'Ngân hàng\n/ Ví điện tử' },
  { cat: 'crypto', label: 'Crypto\n/ Web3' },
]

// ─── Inline Account Table ─────────────────────────────────────────────────────

function InlineAccountTable({ bank, projects }: { bank: Bank; projects: Project[] }) {
  const isCrypto = bank.bank_category === 'crypto'
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: BankAccount } | null>(null)
  const [form, setForm] = useState({ account_identifier: '', owner_name: '', note: '', coin_type: 'USDT', network: 'TRC20', wallet_address: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<BankAccount | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [usagePopup, setUsagePopup] = useState<{ account: BankAccount; list: Project[] } | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/bank-accounts?bank_id=${bank.id}`, { headers: await authHeaders() })
      const d = await res.json()
      if (Array.isArray(d)) setAccounts(d)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [bank.id])

  const usageMap = useMemo(() => {
    const map = new Map<string, Project[]>()
    projects.forEach(p => {
      if (p.bank_account_id) {
        if (!map.has(p.bank_account_id)) map.set(p.bank_account_id, [])
        map.get(p.bank_account_id)!.push(p)
      }
    })
    return map
  }, [projects])

  function openAdd() {
    setForm({ account_identifier: '', owner_name: '', note: '', coin_type: 'USDT', network: 'TRC20', wallet_address: '' })
    setSaveError('')
    setDialog({ mode: 'add' })
  }
  function openEdit(acc: BankAccount) {
    setForm({
      account_identifier: acc.account_identifier ?? '',
      owner_name: acc.owner_name,
      note: acc.note ?? '',
      coin_type: acc.coin_type ?? 'USDT',
      network: acc.network ?? 'TRC20',
      wallet_address: acc.wallet_address ?? '',
    })
    setSaveError('')
    setDialog({ mode: 'edit', data: acc })
  }

  async function handleSave() {
    if (!form.owner_name.trim()) return
    if (isCrypto && !form.wallet_address.trim()) return
    if (!isCrypto && !form.account_identifier.trim()) return
    setSaving(true)
    setSaveError('')
    try {
      const payload = isCrypto
        ? { bank_id: bank.id, owner_name: form.owner_name, note: form.note || null, coin_type: form.coin_type, network: form.network, wallet_address: form.wallet_address, account_identifier: null }
        : { bank_id: bank.id, account_identifier: form.account_identifier, owner_name: form.owner_name, note: form.note || null, coin_type: null, network: null, wallet_address: null }
      if (dialog?.mode === 'add') {
        const res = await fetch('/api/bank-accounts', { method: 'POST', headers: await authHeaders(true), body: JSON.stringify(payload) })
        const created = await res.json()
        if (!res.ok) { setSaveError(created.error ?? 'Lỗi lưu tài khoản'); return }
        setAccounts(prev => [...prev, created])
        toast.success('Đã thêm tài khoản')
      } else if (dialog?.data) {
        const res = await fetch('/api/bank-accounts', { method: 'PUT', headers: await authHeaders(true), body: JSON.stringify({ id: dialog.data.id, ...payload }) })
        const updated = await res.json()
        if (!res.ok) { setSaveError(updated.error ?? 'Lỗi cập nhật tài khoản'); return }
        setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
        toast.success('Đã cập nhật tài khoản')
      }
      setDialog(null)
    } finally { setSaving(false) }
  }

  async function handleDelete(acc: BankAccount) {
    setDeleteError('')
    const res = await fetch(`/api/bank-accounts?id=${acc.id}`, { method: 'DELETE', headers: await authHeaders() })
    const json = await res.json()
    if (!res.ok) { setDeleteError(json.error ?? 'Lỗi xóa'); return }
    setAccounts(prev => prev.filter(a => a.id !== acc.id))
    setConfirmDelete(null)
    toast.success('Đã xóa tài khoản')
  }

  const networks = COIN_NETWORKS[form.coin_type] ?? ['ERC20', 'TRC20', 'BEP20']

  return (
    <div className="bg-slate-50/60 border-t border-slate-200 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">
          {loading ? 'Đang tải...' : accounts.length > 0 ? `${accounts.length} tài khoản` : 'Chưa có tài khoản'}
        </p>
        <Button size="sm" onClick={openAdd} className="gap-1 h-7 text-xs px-2.5">
          <Plus size={12} /> Thêm tài khoản
        </Button>
      </div>

      {loading ? (
        <TableSkeleton rows={2} cols={5} />
      ) : accounts.length === 0 ? (
        <EmptyState message="Chưa có tài khoản nào." />
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-white border-b border-slate-200">
              <tr>
                {(isCrypto
                  ? ['Địa chỉ ví', 'Loại', 'Người quản lý', 'Sử dụng', '']
                  : ['Email / Số TK', 'Người quản lý', 'Ghi chú', 'Sử dụng', '']
                ).map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => {
                const projList = usageMap.get(acc.id) ?? []
                return (
                  <tr key={acc.id} className="border-b border-slate-100 last:border-0 hover:bg-white/70 transition-colors">
                    {isCrypto ? (
                      <>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5 font-mono text-xs text-slate-700">
                            <span>{acc.wallet_address ? shortenAddr(acc.wallet_address) : <span className="text-slate-300">—</span>}</span>
                            {acc.wallet_address && <CopyButton text={acc.wallet_address} />}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-slate-700">{acc.coin_type}</span>
                            {acc.network && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${networkStyle(acc.network)}`}>{acc.network}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-600 text-xs">{acc.owner_name}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700">{acc.account_identifier ?? <span className="text-slate-300">—</span>}</td>
                        <td className="px-3 py-2 text-slate-600 text-xs">{acc.owner_name}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{acc.note ?? <span className="text-slate-300">—</span>}</td>
                      </>
                    )}
                    <td className="px-3 py-2">
                      {projList.length > 0
                        ? <button onClick={() => setUsagePopup({ account: acc, list: projList })} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 transition-colors">{projList.length} dự án</button>
                        : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(acc)} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors"><Pencil size={12} /></button>
                        <button onClick={() => { setDeleteError(''); setConfirmDelete(acc) }} className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={12} /></button>
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
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-semibold text-slate-800 mb-1">{dialog.mode === 'add' ? 'Thêm tài khoản' : 'Sửa tài khoản'}</h3>
            <p className="text-xs text-slate-400 mb-4">{bank.name}</p>
            {isCrypto ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Loại coin</label>
                  <select value={form.coin_type} onChange={e => { const coin = e.target.value; const nets = COIN_NETWORKS[coin] ?? ['ERC20']; setForm(f => ({ ...f, coin_type: coin, network: nets[0] })) }}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300">
                    {COINS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Network</label>
                  <select value={form.network} onChange={e => setForm(f => ({ ...f, network: e.target.value }))}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300">
                    {networks.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {NETWORK_WARNING[form.network] && (
                  <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-md">
                    <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      <span className="font-bold">{form.coin_type} {form.network}</span> — {NETWORK_WARNING[form.network]}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Địa chỉ ví</label>
                  <div className="relative">
                    <Input value={form.wallet_address} onChange={e => setForm(f => ({ ...f, wallet_address: e.target.value }))} placeholder="TXxxx... hoặc 0x..." className="pr-8" />
                    {form.wallet_address && <div className="absolute right-2 top-1/2 -translate-y-1/2"><CopyButton text={form.wallet_address} /></div>}
                  </div>
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
            ) : (
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
            )}
            {saveError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded mt-3">{saveError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa tài khoản?</h3>
            <p className="text-xs text-slate-600 mb-1 font-mono">
              {isCrypto ? (confirmDelete.wallet_address ? shortenAddr(confirmDelete.wallet_address) : '—') : (confirmDelete.account_identifier ?? '—')}
            </p>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mt-2">{deleteError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Xóa</Button>
            </div>
          </div>
        </div>
      )}

      {usagePopup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">Dự án đang sử dụng</h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">
                  {isCrypto && usagePopup.account.wallet_address ? shortenAddr(usagePopup.account.wallet_address) : usagePopup.account.account_identifier}
                </p>
              </div>
              <button onClick={() => setUsagePopup(null)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400"><X size={15} /></button>
            </div>
            <ul className="space-y-1.5">
              {usagePopup.list.map(p => (
                <li key={p.project_id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-50 text-sm">
                  <span className="font-mono text-xs text-slate-400">{p.project_id}</span>
                  <span className="font-medium text-slate-700">{p.name}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end mt-4"><Button variant="outline" onClick={() => setUsagePopup(null)}>Đóng</Button></div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Bank Row ─────────────────────────────────────────────────────────────────

type BankWithCount = Bank & { bank_accounts: [{ count: number }] }

function BankRow({
  bank, projCount, isExpanded, onToggle, onEdit, onDelete, projects,
}: {
  bank: BankWithCount
  projCount: number
  isExpanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  projects: Project[]
}) {
  const accCount = bank.bank_accounts?.[0]?.count ?? 0
  return (
    <>
      <tr
        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BankIcon bank={bank} />
            <span className="font-medium text-slate-800">{bank.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          {bank.bank_category === 'crypto' ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-600 border border-orange-200">Crypto / Web3</span>
          ) : (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${bank.type === 'international' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-green-50 text-green-600 border-green-200'}`}>
              {bank.type === 'international' ? 'Quốc tế' : 'Nội địa'}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-sm text-slate-600">
          {accCount > 0 ? accCount : <span className="text-slate-300 text-xs">—</span>}
        </td>
        <td className="px-4 py-3">
          {projCount > 0
            ? <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">{projCount} dự án</span>
            : <span className="text-slate-300 text-xs">—</span>}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
            <button onClick={onEdit} className="p-1.5 rounded hover:bg-slate-200 text-slate-400 transition-colors"><Pencil size={13} /></button>
            <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
            <button onClick={onToggle} className="p-1.5 rounded hover:bg-slate-200 text-slate-400 transition-colors">
              {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={5} className="p-0 border-b border-slate-200">
            <InlineAccountTable bank={bank} projects={projects} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Bank List ────────────────────────────────────────────────────────────────

interface Props { projects: Project[] }

function BankList({ projects }: Props) {
  const [banks, setBanks] = useState<BankWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBankId, setExpandedBankId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Bank } | null>(null)
  const [form, setForm] = useState({ name: '', type: 'international' as 'local' | 'international', bank_category: '' as '' | 'traditional' | 'crypto' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Bank | null>(null)
  const [deleteError, setDeleteError] = useState('')

  async function load() {
    try {
      const res = await fetch('/api/banks', { headers: await authHeaders() })
      const d = await res.json()
      if (Array.isArray(d)) setBanks(d)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const projectsByBank = useMemo(() => {
    const map = new Map<string, number>()
    projects.forEach(p => { if (p.bank_accounts?.bank_id) map.set(p.bank_accounts.bank_id, (map.get(p.bank_accounts.bank_id) ?? 0) + 1) })
    return map
  }, [projects])

  const totalAccounts = banks.reduce((s, b) => s + (b.bank_accounts?.[0]?.count ?? 0), 0)

  function openAdd() { setForm({ name: '', type: 'international', bank_category: '' }); setSaveError(''); setDialog({ mode: 'add' }) }
  function openEdit(b: Bank) { setForm({ name: b.name, type: b.type, bank_category: b.bank_category }); setSaveError(''); setDialog({ mode: 'edit', data: b }) }

  async function handleSave() {
    if (!form.name.trim() || !form.bank_category) return
    setSaving(true)
    setSaveError('')
    try {
      if (dialog?.mode === 'add') {
        const res = await fetch('/api/banks', { method: 'POST', headers: await authHeaders(true), body: JSON.stringify(form) })
        const created = await res.json()
        if (!res.ok) { setSaveError(created.error ?? 'Lỗi lưu bank'); return }
        setBanks(prev => [...prev, { ...created, bank_accounts: [{ count: 0 }] }])
        toast.success('Đã thêm bank')
      } else if (dialog?.data) {
        const res = await fetch('/api/banks', { method: 'PUT', headers: await authHeaders(true), body: JSON.stringify({ id: dialog.data.id, ...form }) })
        const updated = await res.json()
        if (!res.ok) { setSaveError(updated.error ?? 'Lỗi cập nhật bank'); return }
        setBanks(prev => prev.map(b => b.id === updated.id ? { ...b, ...updated } : b))
        toast.success('Đã cập nhật bank')
      }
      setDialog(null)
    } finally { setSaving(false) }
  }

  async function handleDelete(bank: Bank) {
    setDeleteError('')
    const res = await fetch(`/api/banks?id=${bank.id}`, { method: 'DELETE', headers: await authHeaders() })
    const json = await res.json()
    if (!res.ok) { setDeleteError(json.error ?? 'Lỗi xóa'); return }
    setBanks(prev => prev.filter(b => b.id !== bank.id))
    if (expandedBankId === bank.id) setExpandedBankId(null)
    setConfirmDelete(null)
    toast.success(`Đã xóa ${bank.name}`)
  }

  function toggleExpand(bankId: string) {
    setExpandedBankId(prev => prev === bankId ? null : bankId)
  }

  const cryptoBanks = banks.filter(b => b.bank_category === 'crypto')
  const tradBanks   = banks.filter(b => b.bank_category === 'traditional')
  const COLS = 5

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {banks.length} ngân hàng / ví
          {totalAccounts > 0 && <> · {totalAccounts} tài khoản</>}
          {projectsByBank.size > 0 && <> · {projectsByBank.size} dự án đang dùng</>}
        </p>
        <Button onClick={openAdd} className="gap-1.5"><Plus size={14} /> Thêm bank</Button>
      </div>

      {loading ? (
        <TableSkeleton rows={4} cols={COLS} />
      ) : banks.length === 0 ? (
        <EmptyState message="Chưa có ngân hàng / ví nào." />
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Tên', 'Phân loại', 'Tài khoản', 'Dự án liên kết', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cryptoBanks.length > 0 && (
                <>
                  <tr className="border-b border-slate-100">
                    <td colSpan={COLS} className="px-4 py-2 bg-orange-50/40">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600">
                        <Wallet size={12} /> Crypto / Web3 ({cryptoBanks.length})
                      </div>
                    </td>
                  </tr>
                  {cryptoBanks.map(b => (
                    <BankRow
                      key={b.id}
                      bank={b}
                      projCount={projectsByBank.get(b.id) ?? 0}
                      isExpanded={expandedBankId === b.id}
                      onToggle={() => toggleExpand(b.id)}
                      onEdit={() => openEdit(b)}
                      onDelete={() => { setDeleteError(''); setConfirmDelete(b) }}
                      projects={projects}
                    />
                  ))}
                </>
              )}
              {tradBanks.length > 0 && (
                <>
                  <tr className="border-b border-slate-100">
                    <td colSpan={COLS} className="px-4 py-2 bg-slate-100/60">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <Building2 size={12} /> Ngân hàng / Ví điện tử ({tradBanks.length})
                      </div>
                    </td>
                  </tr>
                  {tradBanks.map(b => (
                    <BankRow
                      key={b.id}
                      bank={b}
                      projCount={projectsByBank.get(b.id) ?? 0}
                      isExpanded={expandedBankId === b.id}
                      onToggle={() => toggleExpand(b.id)}
                      onEdit={() => openEdit(b)}
                      onDelete={() => { setDeleteError(''); setConfirmDelete(b) }}
                      projects={projects}
                    />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit bank modal */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">{dialog.mode === 'add' ? 'Thêm bank / ví' : 'Sửa bank / ví'}</h3>
            <div className="space-y-4">
              {dialog.mode === 'add' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">Loại bank này là gì?</label>
                  <div className="grid grid-cols-2 gap-2">
                    {BANK_CATEGORY_OPTIONS.map(({ cat, label }) => (
                      <button key={cat} onClick={() => setForm(f => ({ ...f, bank_category: cat }))}
                        className={`p-3 rounded-lg border-2 text-center transition-colors ${form.bank_category === cat ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:border-slate-300'}`}>
                        <div className="mb-1.5 flex justify-center">
                          {cat === 'crypto' ? <Wallet size={22} className="text-orange-500" /> : <Building2 size={22} className="text-blue-500" />}
                        </div>
                        <div className="text-xs font-medium text-slate-700 whitespace-pre-line">{label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(form.bank_category || dialog.mode === 'edit') && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">Tên</label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={form.bank_category === 'crypto' ? 'Binance, Bybit, MetaMask...' : 'PayPal, MB Bank, Vietcombank...'}
                      autoFocus />
                  </div>
                  {form.bank_category === 'traditional' && (
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Phạm vi</label>
                      <div className="flex gap-2">
                        {(['international', 'local'] as const).map(t => (
                          <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                            className={`flex-1 py-2 text-sm rounded-md border transition-colors ${form.type === t ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                            {t === 'international' ? 'Quốc tế' : 'Nội địa'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            {saveError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded mt-3">{saveError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving || (!form.bank_category && dialog.mode === 'add')}>{saving ? 'Đang lưu...' : 'Lưu'}</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa {confirmDelete.name}?</h3>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mt-2">{deleteError}</p>}
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BankTab({ projects }: Props) {
  return <BankList projects={projects} />
}
