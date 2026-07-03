'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, Pencil, Trash2, Search, Share2, Link2, Mail, Copy, Check,
  RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Download,
  Bell, Eye, EyeOff, LayoutGrid, List, FileText, User,
} from 'lucide-react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { useProjects } from '@/hooks/useProjects'
import ProjectFormDialog from '@/components/projects/ProjectFormDialog'
import StatusPicker from '@/components/project/StatusPicker'
import CategorySelect from '@/components/project/CategorySelect'
import ReminderModal from '@/components/project/ReminderModal'
import ProjectDetailDrawer from '@/components/project/ProjectDetailDrawer'
import UserSelect, { UserAvatar } from '@/components/project/UserSelect'
import NetworkSelect from '@/components/project/NetworkSelect'
import {
  Project, CampaignDiscovery, ProjectCategory, ProjectStatus, AffiliateNetwork,
  STATUS_CONFIG, ACTIVE_STATUSES,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import TableSkeleton from '@/components/ui/TableSkeleton'
import { toast } from 'sonner'
import { exportToCsv, cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'
import MasterProjectsTab from '@/components/project/MasterProjectsTab'

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtCustomerId(id: string | null | undefined): string {
  if (!id) return '—'
  const d = id.replace(/-/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : id
}

function networkBadge(n: string | null | undefined) {
  const styles: Record<string, string> = {
    TRC20: 'bg-green-100 text-green-700', ERC20: 'bg-blue-100 text-blue-700',
    BEP20: 'bg-yellow-100 text-yellow-700', SOL: 'bg-purple-100 text-purple-700',
    ARB: 'bg-sky-100 text-sky-700',
  }
  return styles[n ?? ''] ?? 'bg-slate-100 text-slate-600'
}
function shortenAddr(a: string) { return a.length <= 12 ? a : `${a.slice(0, 6)}...${a.slice(-4)}` }

// Row highlight: pick primary status (first ACTIVE_STATUSES match, else first)
function rowBg(statuses: ProjectStatus[] = []) {
  for (const s of ACTIVE_STATUSES) {
    if (statuses.includes(s)) return STATUS_CONFIG[s]?.row ?? ''
  }
  return statuses[0] ? STATUS_CONFIG[statuses[0]]?.row ?? '' : ''
}

// ─── main ───────────────────────────────────────────────────────────────────

function ProjectsPageInner() {
  const { projects, isLoading, addProject, updateProject, patchProjectLocal, deleteProject, deleteProjects } = useProjects()
  const { role, user } = useAuth()
  const isAdminOrManager = role === 'super_admin' || role === 'manager'
  const canCreateProject = isAdminOrManager || role === 'member'
  const canManageCategories = role === 'super_admin' || role === 'manager'
  const canEditCampFields = isAdminOrManager || role === 'member'
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = (searchParams.get('tab') ?? 'manage') as 'manage' | 'ads' | 'master'
  const { masterProjects } = useMasterProjectsContext()

  // ── categories ──
  const [categories, setCategories] = useState<ProjectCategory[]>([])
  useEffect(() => {
    authFetch('/api/projects/categories').then(r => r.json()).then(d => setCategories(Array.isArray(d) ? d : []))
    // Load team users for person_in_charge
    authFetch('/api/projects/team-users').then(r => r.json()).then((d: { user_id: string; full_name: string }[]) => {
      if (Array.isArray(d)) setTeamUsers(d.map(u => ({ ...u, email: '' })))
    }).catch(() => {})
    // Load reminder map: which projects have active reminders for current user
    authFetch('/api/projects/reminders-active')
      .then(r => r.json())
      .then((ids: string[]) => {
        if (Array.isArray(ids)) {
          const m = new Map<string, boolean>()
          ids.forEach(id => m.set(id, true))
          setReminderMap(m)
        }
      })
      .catch(() => {})
  }, [])

  // ── dialogs & selections ──
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Partial<Project> } | null>(null)
  const [reminderProject, setReminderProject] = useState<{ id: string; name: string } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false)
  const bulkStatusRef = useRef<HTMLDivElement>(null)
  const [bulkPersonOpen, setBulkPersonOpen] = useState(false)
  const bulkPersonRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close bulk dropdowns on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (bulkStatusRef.current && !bulkStatusRef.current.contains(e.target as Node)) setBulkStatusOpen(false)
      if (bulkPersonRef.current && !bulkPersonRef.current.contains(e.target as Node)) setBulkPersonOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // `/` shortcut → focus search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as Element).tagName)) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── search / sort / filter ──
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'project_id' | 'name' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | 'all'>('all')
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPerson, setFilterPerson] = useState<string>('all')
  const [filterHasReminder, setFilterHasReminder] = useState(false)
  const [filterCampFrom, setFilterCampFrom] = useState<string>('')
  const [filterCampTo, setFilterCampTo] = useState<string>('')

  // ── inline cell editing ──
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'affiliate_url' | 'affiliate_username' | 'affiliate_password' | 'ref_link' } | null>(null)
  const [notePopover, setNotePopover] = useState<{ id: string; pos: { top: number; left: number }; initValue: string } | null>(null)

  // ── copy states ──
  const [copied, setCopied] = useState<string | null>(null)
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)
  const [revealedPasswords, setRevealedPasswords] = useState<Set<string>>(new Set())
  const [decryptedPasswords, setDecryptedPasswords] = useState<Map<string, string>>(new Map())
  const [copiedPassword, setCopiedPassword] = useState<string | null>(null)

  // ── campaign / share data (Tab 2) ──
  const [campaignInfoMap, setCampaignInfoMap] = useState<Map<string, {
    customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null
  }>>(new Map())
  const [syncingMcc, setSyncingMcc] = useState(false)
  const [shareCountMap, setShareCountMap] = useState<Map<string, number>>(new Map())

  // ── view mode ──
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table')

  // ── reminder state ──
  const [reminderMap, setReminderMap] = useState<Map<string, boolean>>(new Map()) // projectId → has reminder

  // ── drawer ──
  const [drawerProject, setDrawerProject] = useState<Project | null>(null)
  const [teamUsers, setTeamUsers] = useState<{ user_id: string; full_name: string; email: string }[]>([])
  const [affiliateNetworks, setAffiliateNetworks] = useState<AffiliateNetwork[]>([])

  async function authFetch(url: string, opts?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...opts,
      headers: { ...opts?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
    })
  }

  // ── load campaign info ──
  useEffect(() => {
    fetch('/api/integrations/campaigns')
      .then(r => r.json())
      .then((list: CampaignDiscovery[]) => {
        if (!Array.isArray(list)) return
        const map = new Map<string, { customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null }>()
        list.forEach(c => { if (c.project_id) map.set(c.project_id, { customer_id: c.customer_id, campaign_id: c.campaign_id, mcc_name: c.mcc_name ?? null, mcc_id: c.mcc_id ?? null }) })
        setCampaignInfoMap(map)
      })
      .catch(() => {})
  }, [])

  // ── load affiliate networks ──
  useEffect(() => {
    authFetch('/api/projects/networks').then(r => r.ok ? r.json() : []).then(setAffiliateNetworks).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── highlight from notification bell ──
  const highlightId = searchParams.get('highlight')
  useEffect(() => {
    if (!highlightId || projects.length === 0) return
    const p = projects.find(x => x.project_id === highlightId)
    if (p) {
      setDrawerProject(p)
      // Clean up URL without reload
      const url = new URL(window.location.href)
      url.searchParams.delete('highlight')
      window.history.replaceState({}, '', url.toString())
    }
  }, [highlightId, projects])

  // ── load share counts ──
  useEffect(() => {
    if (projects.length === 0 || !isAdminOrManager) return
    const ids = projects.map(p => p.project_id)
    supabase.from('project_shares').select('project_id').in('project_id', ids)
      .then(({ data }) => {
        const map = new Map<string, number>()
        ;(data ?? []).forEach((r: { project_id: string }) => map.set(r.project_id, (map.get(r.project_id) ?? 0) + 1))
        setShareCountMap(map)
      })
  }, [projects, isAdminOrManager])

  // ── filter / sort logic ──
  const filtered = projects.filter(p => {
    if (tab === 'ads') {
      const hasActive = (p.statuses ?? []).some(s => ACTIVE_STATUSES.includes(s))
      if (!hasActive) return false
    }
    if (search) {
      const q = search.toLowerCase()
      if (!p.name.toLowerCase().includes(q) && !p.project_id.includes(q) && !p.cid.includes(q)) return false
    }
    if (tab === 'manage') {
      if (filterStatus !== 'all' && !(p.statuses ?? []).includes(filterStatus)) return false
      if (filterCategory !== 'all' && p.category_id !== filterCategory) return false
      if (filterPerson !== 'all' && p.person_in_charge !== filterPerson) return false
      if (filterHasReminder && !reminderMap.get(p.project_id)) return false
      if (filterCampFrom && (!p.camp_start_date || p.camp_start_date < filterCampFrom)) return false
      if (filterCampTo   && (!p.camp_start_date || p.camp_start_date > filterCampTo))   return false
    }
    return true
  })

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    : filtered

  function handleSort(key: 'project_id' | 'name') {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // ── stats for Tab 1 ──
  const stats = {
    total: projects.length,
    byStatus: Object.fromEntries(
      Object.keys(STATUS_CONFIG).map(s => [s, projects.filter(p => (p.statuses ?? []).includes(s as ProjectStatus)).length])
    ) as Record<ProjectStatus, number>,
    hasReminder: projects.filter(p => reminderMap.get(p.project_id)).length,
  }

  // ── bulk selection ──
  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.project_id))
  const someSelected = filtered.some(p => selectedIds.has(p.project_id))
  const selectedCount = [...selectedIds].filter(id => filtered.some(p => p.project_id === id)).length

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected && !allFilteredSelected
  }, [someSelected, allFilteredSelected])

  function toggleAll() {
    if (allFilteredSelected) setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.delete(p.project_id)); return n })
    else setSelectedIds(prev => { const n = new Set(prev); filtered.forEach(p => n.add(p.project_id)); return n })
  }
  function toggleOne(id: string) { setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  function handleDeleteProject(p: Project) {
    deleteProject(p.project_id)
    toast.success(`Đã xóa "${p.name}"`, {
      action: { label: 'Hoàn tác', onClick: () => addProject(p) },
      duration: 5000,
    })
  }

  function handleBulkDelete() {
    const count = selectedIds.size
    const deletedProjects = sorted.filter(p => selectedIds.has(p.project_id))
    deleteProjects([...selectedIds])
    setSelectedIds(new Set())
    toast.success(`Đã xóa ${count} dự án`, {
      action: { label: 'Hoàn tác', onClick: async () => { await Promise.all(deletedProjects.map(p => addProject(p))) } },
      duration: 5000,
    })
  }

  async function handleBulkStatusAdd(status: ProjectStatus) {
    setBulkStatusOpen(false)
    const ids = [...selectedIds].filter(id => filtered.some(p => p.project_id === id))
    const results = await Promise.allSettled(
      ids.map(async id => {
        const project = projects.find(p => p.project_id === id)
        if (!project) return
        const newStatuses = (project.statuses ?? []).includes(status)
          ? project.statuses!
          : [...(project.statuses ?? []), status]
        patchProjectLocal({ ...project, statuses: newStatuses })
        await authFetch(`/api/projects/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statuses: newStatuses }),
        })
      })
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) toast.error(`${failed} dự án không thể cập nhật`)
    else toast.success(`Đã thêm trạng thái "${STATUS_CONFIG[status].label}" cho ${ids.length} dự án`)
  }

  async function handleBulkSetPerson(userId: string | null) {
    setBulkPersonOpen(false)
    const ids = [...selectedIds].filter(id => filtered.some(p => p.project_id === id))
    const results = await Promise.allSettled(
      ids.map(async id => {
        const project = projects.find(p => p.project_id === id)
        if (!project) return
        patchProjectLocal({ ...project, person_in_charge: userId ?? undefined })
        await authFetch(`/api/projects/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ person_in_charge: userId }),
        })
      })
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) toast.error(`${failed} dự án không thể cập nhật`)
    else {
      const name = userId ? (teamUsers.find(u => u.user_id === userId)?.full_name ?? userId) : 'Chưa giao'
      toast.success(`Đã gán "${name}" cho ${ids.length} dự án`)
    }
  }

  // ── copy helpers ──
  function copyText(text: string, key: string, setter: (v: string | null) => void, clearClipboard = false) {
    navigator.clipboard.writeText(text)
    setter(key)
    if (clearClipboard) setTimeout(() => navigator.clipboard.writeText(''), 30000)
    setTimeout(() => setter(null), 1500)
  }

  // Ctrl+Z undo last saved cell
  useEffect(() => {
    function onUndo(e: KeyboardEvent) {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'z')) return
      if (editingCell) return
      if (undoStack.current.size === 0) return
      const entries = [...undoStack.current.entries()]
      const [key, prevValue] = entries[entries.length - 1]
      const [projectId, ...rest] = key.split('-')
      const field = rest.join('-')
      const project = projects.find(p => p.project_id === projectId)
      if (!project) return
      e.preventDefault()
      undoStack.current.delete(key)
      saveCell(project, field, prevValue ?? '')
      toast.success('Đã khôi phục giá trị cũ')
    }
    document.addEventListener('keydown', onUndo)
    return () => document.removeEventListener('keydown', onUndo)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell, projects])

  // ── inline status update ──
  const pendingStatusUpdate = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleStatusChange(project: Project, newStatuses: ProjectStatus[]) {
    patchProjectLocal({ ...project, statuses: newStatuses })
    if (pendingStatusUpdate.current) clearTimeout(pendingStatusUpdate.current)
    pendingStatusUpdate.current = setTimeout(async () => {
      const res = await authFetch(`/api/projects/${project.project_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statuses: newStatuses }),
      })
      if (!res.ok) patchProjectLocal({ ...project })
    }, 600)
  }

  // ── inline category update ──
  async function handleCategoryChange(project: Project, categoryId: string | null) {
    const enriched = { ...project, category_id: categoryId, category: categories.find(c => c.id === categoryId) ?? null }
    patchProjectLocal(enriched)
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_id: categoryId }),
    })
    if (!res.ok) patchProjectLocal({ ...project })
  }

  const CELL_ORDER = ['affiliate_url', 'affiliate_username', 'affiliate_password', 'ref_link'] as const
  type EditableField = typeof CELL_ORDER[number]
  const [editPwVisible, setEditPwVisible] = useState(false)
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set())
  const [errorCells, setErrorCells] = useState<Set<string>>(new Set())
  const [pastedCells, setPastedCells] = useState<Set<string>>(new Set())
  const undoStack = useRef<Map<string, string | null>>(new Map())

  // ── Excel-style range selection across the 4 affiliate columns ──
  // r = rowIndex trong `sorted`; c = colIndex 0..3 khớp CELL_ORDER
  const [sel, setSel] = useState<{ a: { r: number; c: number }; f: { r: number; c: number } } | null>(null)
  const draggingRef = useRef(false)
  const selAnchorRef = useRef<{ r: number; c: number } | null>(null)
  const selBounds = sel && {
    minR: Math.min(sel.a.r, sel.f.r), maxR: Math.max(sel.a.r, sel.f.r),
    minC: Math.min(sel.a.c, sel.f.c), maxC: Math.max(sel.a.c, sel.f.c),
  }
  const inSel = (r: number, c: number) =>
    !!selBounds && r >= selBounds.minR && r <= selBounds.maxR && c >= selBounds.minC && c <= selBounds.maxC
  function selMouseDown(r: number, c: number, shiftKey: boolean, preventDefault: () => void) {
    if (!canEditCampFields) return
    if (shiftKey && selAnchorRef.current) { preventDefault(); setSel({ a: selAnchorRef.current, f: { r, c } }) }
    else { selAnchorRef.current = { r, c }; draggingRef.current = true; setSel(null) }
  }
  function selMouseEnter(r: number, c: number) {
    if (canEditCampFields && draggingRef.current && selAnchorRef.current) setSel({ a: selAnchorRef.current, f: { r, c } })
  }
  const selCls = (r: number, c: number) => cn('select-none', inSel(r, c) && 'ring-2 ring-inset ring-blue-400 bg-blue-50')

  async function fetchDecryptedPassword(projectId: string): Promise<string | null> {
    const res = await authFetch(`/api/projects/${projectId}/password`)
    if (!res.ok) {
      toast.error('Không thể giải mã mật khẩu')
      return null
    }
    const { password } = await res.json()
    if (password) setDecryptedPasswords(prev => new Map(prev).set(projectId, password))
    return password
  }

  async function handleRevealPassword(projectId: string) {
    if (revealedPasswords.has(projectId)) {
      setRevealedPasswords(prev => { const n = new Set(prev); n.delete(projectId); return n })
      return
    }
    let ok = decryptedPasswords.has(projectId)
    if (!ok) {
      const result = await fetchDecryptedPassword(projectId)
      ok = result !== null
    }
    if (ok) setRevealedPasswords(prev => new Set(prev).add(projectId))
  }

  async function handleCopyPassword(projectId: string) {
    let pw = decryptedPasswords.get(projectId)
    if (!pw) pw = await fetchDecryptedPassword(projectId) ?? undefined
    if (pw) copyText(pw, `pw-${projectId}`, v => setCopiedPassword(v), true)
  }

  async function saveCell(project: Project, field: string, value: string, nextField?: EditableField, silent = false) {
    if (field === 'affiliate_password' && !value) {
      if (!silent) setEditingCell(nextField ? { id: project.project_id, field: nextField } : null)
      return
    }
    const cellKey = `${project.project_id}-${field}`
    const prevVal = project[field as keyof Project] as string | null
    const prev = { ...project }
    patchProjectLocal({ ...project, [field]: value || null })
    if (field === 'affiliate_password' && value) {
      setDecryptedPasswords(m => new Map(m).set(project.project_id, value))
    }
    setSavingCells(s => new Set(s).add(cellKey))
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value || null }),
    })
    setSavingCells(s => { const n = new Set(s); n.delete(cellKey); return n })
    if (!res.ok) {
      patchProjectLocal(prev)
      setErrorCells(s => {
        const n = new Set(s); n.add(cellKey)
        setTimeout(() => setErrorCells(x => { const y = new Set(x); y.delete(cellKey); return y }), 3000)
        return n
      })
      if (!silent) toast.error('Lưu thất bại')
      setEditingCell(null)
      return
    }
    if ((value || null) !== prevVal) undoStack.current.set(cellKey, prevVal)
    if (silent) return
    if (nextField) {
      setEditingCell({ id: project.project_id, field: nextField })
    } else {
      if ((value || null) !== prevVal) {
        toast.success('Đã lưu', {
          action: { label: 'Hoàn tác', onClick: () => saveCell(prev, field, prevVal ?? '') },
          duration: 5000,
        })
      }
      setEditingCell(null)
    }
  }

  async function handleMultiRowPaste(
    e: React.ClipboardEvent<HTMLInputElement>,
    rowIndex: number,
    field: string,
    project: Project,
  ) {
    const text = e.clipboardData.getData('text')
    const lines = text.split(/\r?\n/).filter(l => l !== '')
    if (lines.length <= 1) return
    e.preventDefault()
    const affectedRows = sorted.slice(rowIndex, rowIndex + lines.length)
    if (!window.confirm(`Paste ${lines.length} giá trị vào ${affectedRows.length} dòng?`)) return
    setEditingCell(null)
    const keys = affectedRows.map(proj => `${proj.project_id}-${field}`)
    await Promise.all(affectedRows.map((proj, i) => saveCell(proj, field, lines[i] ?? '', undefined, true)))
    setPastedCells(new Set(keys))
    setTimeout(() => setPastedCells(new Set()), 1200)
    toast.success(`Đã paste ${affectedRows.length} giá trị`)
  }

  // ── range selection: copy + bulk delete ──────────────────────────────────
  function fieldHasValue(p: Project, f: EditableField): boolean {
    return f === 'affiliate_password' ? !!p.affiliate_password : !!(p[f as keyof Project])
  }

  // Persist a group of field→value changes for one project in a SINGLE patch,
  // avoiding the whole-object clobber that per-field saveCell would cause.
  async function patchProjectFields(project: Project, values: Record<string, string | null>) {
    const prev = { ...project }
    patchProjectLocal({ ...project, ...values })
    for (const [f, v] of Object.entries(values)) {
      if (f === 'affiliate_password') {
        if (v) setDecryptedPasswords(m => new Map(m).set(project.project_id, v))
        else {
          setDecryptedPasswords(m => { const n = new Map(m); n.delete(project.project_id); return n })
          setRevealedPasswords(s => { const n = new Set(s); n.delete(project.project_id); return n })
        }
      }
    }
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    })
    if (!res.ok) { patchProjectLocal(prev); toast.error('Lưu thất bại'); return false }
    return true
  }

  async function clearSelectedCells() {
    const b = selBounds
    if (!b) return
    // Group selected non-empty cells by project
    const groups = new Map<string, { project: Project; fields: EditableField[] }>()
    for (let r = b.minR; r <= b.maxR; r++) {
      const project = sorted[r]
      if (!project) continue
      for (let c = b.minC; c <= b.maxC; c++) {
        const field = CELL_ORDER[c]
        if (!fieldHasValue(project, field)) continue
        const g = groups.get(project.project_id) ?? { project, fields: [] }
        g.fields.push(field)
        groups.set(project.project_id, g)
      }
    }
    const list = [...groups.values()]
    const total = list.reduce((s, g) => s + g.fields.length, 0)
    if (total === 0) { setSel(null); return }
    if (!window.confirm(`Xoá nội dung ${total} ô đã chọn?`)) return

    // Snapshot previous values for undo (password needs plaintext)
    const snapshots = await Promise.all(list.map(async ({ project, fields }) => {
      const prev: Record<string, string | null> = {}
      for (const f of fields) {
        prev[f] = f === 'affiliate_password'
          ? (decryptedPasswords.get(project.project_id) ?? await fetchDecryptedPassword(project.project_id))
          : ((project[f as keyof Project] as string | null) ?? null)
      }
      return { project, prev }
    }))

    await Promise.all(list.map(({ project, fields }) =>
      patchProjectFields(project, Object.fromEntries(fields.map(f => [f, null])))
    ))
    setSel(null)

    toast.success(`Đã xoá ${total} ô`, {
      action: {
        label: 'Hoàn tác',
        onClick: () => {
          snapshots.forEach(({ project, prev }) => {
            const restore = Object.fromEntries(
              Object.entries(prev).filter(([, v]) => v != null && v !== '')
            ) as Record<string, string>
            if (Object.keys(restore).length > 0) patchProjectFields(project, restore)
          })
          toast.success('Đã khôi phục')
        },
      },
      duration: 6000,
    })
  }

  async function copySelectedCells() {
    const b = selBounds
    if (!b) return
    const rows: string[] = []
    for (let r = b.minR; r <= b.maxR; r++) {
      const project = sorted[r]
      if (!project) continue
      const cols: string[] = []
      for (let c = b.minC; c <= b.maxC; c++) {
        const field = CELL_ORDER[c]
        if (field === 'affiliate_password') {
          cols.push(project.affiliate_password
            ? (decryptedPasswords.get(project.project_id) ?? await fetchDecryptedPassword(project.project_id) ?? '')
            : '')
        } else {
          cols.push((project[field as keyof Project] as string | null) ?? '')
        }
      }
      rows.push(cols.join('\t'))
    }
    await navigator.clipboard.writeText(rows.join('\n'))
    const count = (b.maxR - b.minR + 1) * (b.maxC - b.minC + 1)
    toast.success(`Đã copy ${count} ô`)
  }

  // Range selection: end drag on mouseup; Delete clears, Ctrl+C copies, Escape deselects
  useEffect(() => {
    function onMouseUp() { draggingRef.current = false }
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      const inInput = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
      if (inInput || !sel) return
      if (e.key === 'Escape') { setSel(null); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copySelectedCells(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelectedCells(); return }
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])

  // Clear selection when the row set/order changes (indices would be stale)
  useEffect(() => { setSel(null) }, [tab, search, sortKey, sortDir, filterStatus, filterCategory, filterPerson, filterHasReminder, filterCampFrom, filterCampTo])

  function openNotePopover(p: Project, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    setNotePopover({
      id: p.project_id,
      pos: { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 340) },
      initValue: p.note ?? '',
    })
  }

  // ── Kanban drag-and-drop ──
  async function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const { source, destination, draggableId } = result
    if (source.droppableId === destination.droppableId) return

    const project = projects.find(p => p.project_id === draggableId)
    if (!project) return

    const fromStatus = source.droppableId as ProjectStatus
    const toStatus = destination.droppableId as ProjectStatus
    const currentStatuses = project.statuses ?? []

    // Remove from source status, add to destination status
    const newStatuses = [...currentStatuses.filter(s => s !== fromStatus), toStatus]
    handleStatusChange(project, newStatuses)
  }

  // ── export ──
  function handleExport(onlySelected = false) {
    const rows = onlySelected && selectedCount > 0
      ? sorted.filter(p => selectedIds.has(p.project_id))
      : sorted
    exportToCsv(
      rows.map(p => ({
        'Tên dự án': p.name,
        'Category': categories.find(c => c.id === p.category_id)?.name ?? '',
        'URL Affiliate': p.affiliate_url ?? '',
        'Username': p.affiliate_username ?? '',
        'Mạng': p.affiliate_network ?? '',
        'Trạng thái': (p.statuses ?? []).map(s => STATUS_CONFIG[s]?.label).join(', '),
        'Ngày lên camp': p.camp_start_date ?? '',
        'Người phụ trách': teamUsers.find(u => u.user_id === p.person_in_charge)?.full_name ?? '',
        'Note': p.note ?? '',
        'Link Ref': p.ref_link ?? '',
        'Project ID': p.project_id,
        'Người thêm': teamUsers.find(u => u.user_id === p.created_by)?.full_name ?? '',
        'Ngày thêm': p.created_at ? new Date(p.created_at).toLocaleDateString('vi-VN') : '',
      })),
      `projects-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }

  async function refreshMccInfo() {
    setSyncingMcc(true)
    try {
      await fetch('/api/integrations/campaigns', { method: 'POST' })
      const list = await fetch('/api/integrations/campaigns').then(r => r.json())
      if (Array.isArray(list)) {
        const map = new Map<string, { customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null }>()
        ;(list as CampaignDiscovery[]).forEach(c => { if (c.project_id) map.set(c.project_id, { customer_id: c.customer_id, campaign_id: c.campaign_id, mcc_name: c.mcc_name ?? null, mcc_id: c.mcc_id ?? null }) })
        setCampaignInfoMap(map)
        toast.success('Đã cập nhật thông tin MCC')
      }
    } catch { toast.error('Không thể cập nhật MCC') }
    setSyncingMcc(false)
  }

  function setTab(t: 'manage' | 'ads' | 'master') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', t)
    router.push(`/projects?${params.toString()}`)
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản lý dự án</h2>
          <p className="text-sm text-slate-500 mt-0.5">{projects.length} dự án</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExport()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
            <Download size={14} /> Export CSV
          </button>
          {canCreateProject && (
            <Button onClick={() => setDialog({ mode: 'add', data: role === 'member' ? { person_in_charge: user?.id ?? null } : undefined })} className="gap-1.5">
              <Plus size={14} /> Thêm dự án
            </Button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-slate-200">
        {([['manage', '📁 Quản lý Dự Án'], ['ads', '📢 Ads Mapping'], ['master', '🏢 Tổng Dự Án']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === key
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TAB 1: QUẢN LÝ DỰ ÁN ═══════════════════════════════════════ */}
      {tab === 'manage' && (
        <>
          {/* Stats summary bar */}
          <div className="flex flex-wrap gap-2 text-xs">
            <button onClick={() => setFilterStatus('all')}
              className={cn('px-3 py-1.5 rounded-full border font-medium transition-colors',
                filterStatus === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
              Tất cả ({stats.total})
            </button>
            {(Object.keys(STATUS_CONFIG) as ProjectStatus[]).filter(s => stats.byStatus[s] > 0).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={cn(
                  'px-3 py-1.5 rounded-full border font-medium transition-colors',
                  filterStatus === s
                    ? cn(STATUS_CONFIG[s].badge, 'border-current')
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                )}>
                {STATUS_CONFIG[s].label} ({stats.byStatus[s]})
              </button>
            ))}
            {stats.hasReminder > 0 && (
              <button
                onClick={() => { setFilterStatus('all'); setFilterHasReminder(v => !v) }}
                className={cn('px-3 py-1.5 rounded-full border font-medium transition-colors',
                  filterHasReminder
                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                    : 'border-amber-200 text-amber-600 hover:bg-amber-50'
                )}>
                ⚠️ Cần xem ({stats.hasReminder})
              </button>
            )}
          </div>

          {/* Filters + view toggle */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setSearch('')}
                placeholder="Tìm tên, ID... (nhấn /)"
                className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300 w-56" />
            </div>
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
              <option value="all">Tất cả category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {teamUsers.length > 0 && (
              <select value={filterPerson} onChange={e => setFilterPerson(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                <option value="all">Tất cả người phụ trách</option>
                {teamUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}
              </select>
            )}
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-400 whitespace-nowrap">Lên camp:</span>
              <input type="date" value={filterCampFrom} onChange={e => setFilterCampFrom(e.target.value)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none text-slate-600 w-32" />
              <span className="text-xs text-slate-400">→</span>
              <input type="date" value={filterCampTo} onChange={e => setFilterCampTo(e.target.value)}
                className="px-2 py-1.5 text-xs border border-slate-200 rounded-md outline-none text-slate-600 w-32" />
              {(filterCampFrom || filterCampTo) && (
                <button onClick={() => { setFilterCampFrom(''); setFilterCampTo('') }}
                  className="text-slate-400 hover:text-slate-600 text-xs px-1">✕</button>
              )}
            </div>
            <button
              onClick={() => setFilterHasReminder(v => !v)}
              className={cn('flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors',
                filterHasReminder
                  ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
            >
              <Bell size={13} /> Có nhắc nhở
            </button>
            <div className="ml-auto flex items-center gap-1 border border-slate-200 rounded-md p-0.5">
              <button onClick={() => setViewMode('table')}
                className={cn('p-1.5 rounded transition-colors', viewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-700')}>
                <List size={14} />
              </button>
              <button onClick={() => setViewMode('kanban')}
                className={cn('p-1.5 rounded transition-colors', viewMode === 'kanban' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-700')}>
                <LayoutGrid size={14} />
              </button>
            </div>
          </div>

          {/* Bulk action bar */}
          {selectedCount > 0 && isAdminOrManager && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 rounded-lg text-white text-sm">
              <span className="font-medium">{selectedCount} dự án đã chọn</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-white text-xs underline">Bỏ chọn</button>
              <div className="flex-1" />
              {/* Bulk status dropdown */}
              <div ref={bulkStatusRef} className="relative">
                <button onClick={() => setBulkStatusOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-medium">
                  Đổi trạng thái ▾
                </button>
                {bulkStatusOpen && (
                  <div className="absolute bottom-full mb-1 right-0 w-44 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50">
                    {(Object.keys(STATUS_CONFIG) as ProjectStatus[]).map(s => (
                      <button key={s} onClick={() => handleBulkStatusAdd(s)}
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', STATUS_CONFIG[s].badge)}>
                          {STATUS_CONFIG[s].label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Bulk person in charge dropdown */}
              <div ref={bulkPersonRef} className="relative">
                <button onClick={() => setBulkPersonOpen(o => !o)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-medium">
                  <User size={12} /> Người phụ trách ▾
                </button>
                {bulkPersonOpen && (
                  <div className="absolute bottom-full mb-1 right-0 w-48 bg-white border border-slate-200 rounded-lg shadow-xl py-1 z-50 max-h-56 overflow-y-auto">
                    <button onClick={() => handleBulkSetPerson(null)}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50 italic">
                      — Bỏ gán
                    </button>
                    {teamUsers.map(u => (
                      <button key={u.user_id} onClick={() => handleBulkSetPerson(u.user_id)}
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                        <UserAvatar userId={u.user_id} name={u.full_name} size="sm" />
                        {u.full_name || u.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={() => handleExport(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-md text-xs font-medium">
                <Download size={12} /> Export ({selectedCount})
              </button>
              <button onClick={() => handleBulkDelete()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-md text-xs font-medium">
                <Trash2 size={12} /> Xóa {selectedCount}
              </button>
            </div>
          )}

          {/* Kanban View — drag & drop */}
          {viewMode === 'kanban' && (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="flex gap-3 overflow-x-auto pb-4">
                {(Object.keys(STATUS_CONFIG) as ProjectStatus[]).map(status => {
                  const colProjects = sorted.filter(p => (p.statuses ?? []).includes(status))
                  return (
                    <div key={status} className="flex-shrink-0 w-60">
                      <div className={cn('flex items-center justify-between px-3 py-2 rounded-t-lg', STATUS_CONFIG[status].badge)}>
                        <span className="text-xs font-semibold">{STATUS_CONFIG[status].label}</span>
                        <span className="text-xs opacity-70">({colProjects.length})</span>
                      </div>
                      <Droppable droppableId={status}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn(
                              'rounded-b-lg border border-slate-200 border-t-0 min-h-24 space-y-2 p-2 transition-colors',
                              snapshot.isDraggingOver ? 'bg-blue-50' : 'bg-slate-50'
                            )}
                          >
                            {colProjects.map((p, index) => (
                              <Draggable key={p.project_id} draggableId={p.project_id} index={index}>
                                {(drag, dragSnapshot) => {
                                  const { style: dndStyle, ...draggableRest } = drag.draggableProps
                                  return (
                                  <div
                                    ref={drag.innerRef}
                                    {...draggableRest}
                                    style={dndStyle as React.CSSProperties}
                                    {...drag.dragHandleProps}
                                    className={cn(
                                      'bg-white border border-slate-200 rounded-md p-2.5 shadow-sm transition-shadow cursor-grab active:cursor-grabbing',
                                      dragSnapshot.isDragging ? 'shadow-lg border-blue-300 rotate-1' : 'hover:shadow-md'
                                    )}
                                    onClick={() => !dragSnapshot.isDragging && setDrawerProject(p)}
                                  >
                                    <p className="text-xs font-medium text-slate-800 mb-1">{p.name}</p>
                                    {p.category_id && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                                        style={{ backgroundColor: (categories.find(c => c.id === p.category_id)?.color ?? '#6b7280') + '20', color: categories.find(c => c.id === p.category_id)?.color ?? '#6b7280' }}>
                                        {categories.find(c => c.id === p.category_id)?.name}
                                      </span>
                                    )}
                                    {p.camp_start_date && (
                                      <p className="text-[10px] text-slate-400 mt-1">📅 {new Date(p.camp_start_date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</p>
                                    )}
                                    {p.person_in_charge && (
                                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                                        👤 {teamUsers.find(u => u.user_id === p.person_in_charge)?.full_name ?? '—'}
                                      </p>
                                    )}
                                    {reminderMap.get(p.project_id) && (
                                      <p className="text-[10px] text-amber-500 mt-1">🔔 Có nhắc nhở</p>
                                    )}
                                  </div>
                                  )
                                }}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                            {colProjects.length === 0 && (
                              <p className="text-[11px] text-slate-400 text-center py-3 italic">Thả vào đây</p>
                            )}
                          </div>
                        )}
                      </Droppable>
                    </div>
                  )
                })}
              </div>
            </DragDropContext>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            isLoading ? <TableSkeleton rows={8} cols={10} /> : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-3 w-9">
                          <input ref={headerCheckboxRef} type="checkbox" checked={allFilteredSelected} onChange={toggleAll}
                            className="rounded border-slate-300 cursor-pointer accent-slate-700" />
                        </th>
                        <th onClick={() => handleSort('name')}
                          className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">Tên dự án {sortKey === 'name' ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="text-slate-400" />}</span>
                        </th>
                        {['Category', 'URL Affiliate', 'Username', 'Password', 'Link Ref', 'Affiliate Network', 'Tình trạng', 'Ngày lên camp', 'Người phụ trách', 'Note', '🔔', 'Người thêm', 'Ngày thêm'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                        {isAdminOrManager && <th className="px-4 py-3" />}
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p, rowIndex) => {
                        const isSelected = selectedIds.has(p.project_id)
                        const bg = rowBg(p.statuses)
                        const isRevealed = revealedPasswords.has(p.project_id)
                        const hasReminder = reminderMap.get(p.project_id) ?? false
                        return (
                          <tr key={p.project_id}
                            className={cn('border-b border-slate-100 transition-colors',
                              bg || (isSelected ? 'bg-slate-50' : 'hover:bg-slate-50'))}>
                            <td className="px-3 py-3">
                              <input type="checkbox" checked={isSelected} onChange={() => toggleOne(p.project_id)}
                                className="rounded border-slate-300 cursor-pointer accent-slate-700" />
                            </td>
                            {/* Tên dự án — click mở drawer */}
                            <td className="px-4 py-3 min-w-[140px]">
                              <button onClick={() => setDrawerProject(p)}
                                className="font-medium text-slate-800 hover:text-blue-600 text-left transition-colors">
                                {p.name}
                              </button>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{p.project_id}</div>
                            </td>
                            {/* Category */}
                            <td className="px-4 py-3">
                              {isAdminOrManager ? (
                                <CategorySelect
                                  value={p.category_id ?? null}
                                  categories={categories}
                                  canManage={canManageCategories}
                                  onChange={id => handleCategoryChange(p, id)}
                                  onCategoryCreated={cat => setCategories(prev => [...prev, cat])}
                                  authFetch={authFetch}
                                />
                              ) : p.category_id ? (
                                <span className="text-xs px-2 py-0.5 rounded-full"
                                  style={{ backgroundColor: (categories.find(c => c.id === p.category_id)?.color ?? '#6b7280') + '20', color: categories.find(c => c.id === p.category_id)?.color ?? '#6b7280' }}>
                                  {categories.find(c => c.id === p.category_id)?.name ?? '—'}
                                </span>
                              ) : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                            {/* URL Affiliate */}
                            <td
                              className={cn('px-4 py-3 max-w-[180px] transition-colors', canEditCampFields && 'cursor-text', selCls(rowIndex, 0), pastedCells.has(`${p.project_id}-affiliate_url`) && 'bg-yellow-50')}
                              onMouseDown={e => selMouseDown(rowIndex, 0, e.shiftKey, () => e.preventDefault())}
                              onMouseEnter={() => selMouseEnter(rowIndex, 0)}
                              onClick={e => { if (canEditCampFields && !(e.target as HTMLElement).closest('a, button, input')) setEditingCell({ id: p.project_id, field: 'affiliate_url' }) }}
                            >
                              <div className="relative">
                                {canEditCampFields && editingCell?.id === p.project_id && editingCell.field === 'affiliate_url' && (
                                  <input autoFocus defaultValue={p.affiliate_url ?? ''}
                                    className={cn('absolute left-0 top-1/2 -translate-y-1/2 z-20 w-full px-2.5 py-2 text-sm outline-none border-2 rounded-md bg-white shadow-lg', errorCells.has(`${p.project_id}-affiliate_url`) ? 'border-red-400' : 'border-blue-400')}
                                    onFocus={e => e.target.select()}
                                    onPaste={e => handleMultiRowPaste(e, rowIndex, 'affiliate_url', p)}
                                    onBlur={e => { if (!e.relatedTarget) saveCell(p, 'affiliate_url', e.target.value) }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { setEditingCell(null); return }
                                      if (e.key === 'Enter') { e.currentTarget.blur(); return }
                                      if (e.key === 'Tab') {
                                        e.preventDefault()
                                        if (e.shiftKey) {
                                          const prevRow = sorted[rowIndex - 1]
                                          saveCell(p, 'affiliate_url', e.currentTarget.value, undefined, true)
                                          if (prevRow) setEditingCell({ id: prevRow.project_id, field: 'ref_link' })
                                          else setEditingCell(null)
                                        } else {
                                          saveCell(p, 'affiliate_url', e.currentTarget.value, CELL_ORDER[1])
                                        }
                                      }
                                    }}
                                  />
                                )}
                                <div className="flex items-center gap-1 group">
                                  {p.affiliate_url ? (
                                    <a href={p.affiliate_url} target="_blank" rel="noopener noreferrer"
                                      title={p.affiliate_url}
                                      className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate">
                                      {p.affiliate_url.replace(/^https?:\/\//, '').slice(0, 22)}{p.affiliate_url.length > 28 ? '…' : ''}
                                    </a>
                                  ) : (
                                    <span onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'affiliate_url' })}
                                      className={cn('text-slate-300 text-xs', canEditCampFields && 'cursor-text hover:bg-slate-100 px-1 rounded')}>—</span>
                                  )}
                                  {p.affiliate_url && (
                                    <>
                                      <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); copyText(p.affiliate_url!, `url-${p.project_id}`, v => setCopied(v)) }}
                                        className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                        {copied === `url-${p.project_id}` ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                      </button>
                                      {canEditCampFields && (
                                        <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setEditingCell({ id: p.project_id, field: 'affiliate_url' }) }}
                                          className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                          <Pencil size={10} />
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                            {/* Username */}
                            <td
                              className={cn('px-4 py-3 max-w-[120px] transition-colors', canEditCampFields && 'cursor-text', selCls(rowIndex, 1), pastedCells.has(`${p.project_id}-affiliate_username`) && 'bg-yellow-50')}
                              onMouseDown={e => selMouseDown(rowIndex, 1, e.shiftKey, () => e.preventDefault())}
                              onMouseEnter={() => selMouseEnter(rowIndex, 1)}
                              onClick={e => { if (canEditCampFields && !(e.target as HTMLElement).closest('a, button, input')) setEditingCell({ id: p.project_id, field: 'affiliate_username' }) }}
                            >
                              <div className="relative">
                                {canEditCampFields && editingCell?.id === p.project_id && editingCell.field === 'affiliate_username' && (
                                  <input autoFocus defaultValue={p.affiliate_username ?? ''}
                                    className={cn('absolute left-0 top-1/2 -translate-y-1/2 z-20 w-full px-2.5 py-2 text-sm outline-none border-2 rounded-md bg-white shadow-lg', errorCells.has(`${p.project_id}-affiliate_username`) ? 'border-red-400' : 'border-blue-400')}
                                    onFocus={e => e.target.select()}
                                    onPaste={e => handleMultiRowPaste(e, rowIndex, 'affiliate_username', p)}
                                    onBlur={e => { if (!e.relatedTarget) saveCell(p, 'affiliate_username', e.target.value) }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { setEditingCell(null); return }
                                      if (e.key === 'Enter') { e.currentTarget.blur(); return }
                                      if (e.key === 'Tab') {
                                        e.preventDefault()
                                        const next = e.shiftKey ? CELL_ORDER[0] : CELL_ORDER[2]
                                        saveCell(p, 'affiliate_username', e.currentTarget.value, next)
                                      }
                                    }}
                                  />
                                )}
                                <div className="flex items-center gap-1 group">
                                  <span
                                    onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'affiliate_username' })}
                                    className={cn('text-xs text-slate-600 truncate', canEditCampFields && 'cursor-text hover:bg-slate-100 px-1 rounded')}
                                  >
                                    {p.affiliate_username ?? <span className="text-slate-300">—</span>}
                                  </span>
                                  {p.affiliate_username && (
                                    <button onClick={() => copyText(p.affiliate_username!, `usr-${p.project_id}`, v => setCopied(v))}
                                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                      {copied === `usr-${p.project_id}` ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                            {/* Password */}
                            <td
                              className={cn('px-4 py-3 transition-colors', canEditCampFields && 'cursor-text', selCls(rowIndex, 2), pastedCells.has(`${p.project_id}-affiliate_password`) && 'bg-yellow-50')}
                              onMouseDown={e => selMouseDown(rowIndex, 2, e.shiftKey, () => e.preventDefault())}
                              onMouseEnter={() => selMouseEnter(rowIndex, 2)}
                              onClick={e => { if (canEditCampFields && !(e.target as HTMLElement).closest('a, button, input')) setEditingCell({ id: p.project_id, field: 'affiliate_password' }) }}
                            >
                              <div className="relative">
                                {canEditCampFields && editingCell?.id === p.project_id && editingCell.field === 'affiliate_password' && (
                                  <div className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-full">
                                    <input autoFocus type={editPwVisible ? 'text' : 'password'}
                                      defaultValue=""
                                      placeholder={p.affiliate_password ? '••••••' : ''}
                                      className={cn('w-full px-2.5 py-2 pr-8 outline-none border-2 rounded-md bg-white shadow-lg text-sm font-mono', errorCells.has(`${p.project_id}-affiliate_password`) ? 'border-red-400' : 'border-blue-400')}
                                      onPaste={e => handleMultiRowPaste(e, rowIndex, 'affiliate_password', p)}
                                      onBlur={e => {
                                        if (!e.relatedTarget) {
                                          saveCell(p, 'affiliate_password', e.target.value)
                                          setEditPwVisible(false)
                                        }
                                      }}
                                      onKeyDown={e => {
                                        if (e.key === 'Escape') { setEditingCell(null); setEditPwVisible(false); return }
                                        if (e.key === 'Enter') { e.currentTarget.blur(); return }
                                        if (e.key === 'Tab') {
                                          e.preventDefault()
                                          const next = e.shiftKey ? CELL_ORDER[1] : CELL_ORDER[3]
                                          saveCell(p, 'affiliate_password', e.currentTarget.value, next)
                                          setEditPwVisible(false)
                                        }
                                      }}
                                    />
                                    <button type="button"
                                      onMouseDown={e => e.preventDefault()}
                                      onClick={() => setEditPwVisible(v => !v)}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 z-20 text-slate-400 hover:text-slate-600">
                                      {editPwVisible ? <EyeOff size={11} /> : <Eye size={11} />}
                                    </button>
                                  </div>
                                )}
                                {p.affiliate_password ? (
                                  <div className="flex items-center gap-1 group"
                                    onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'affiliate_password' })}>
                                    <span className={cn('text-xs text-slate-600 font-mono', canEditCampFields && 'cursor-text')}>
                                      {isRevealed ? (decryptedPasswords.get(p.project_id) ?? '••••••') : '••••••'}
                                    </span>
                                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleRevealPassword(p.project_id) }}
                                      className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0">
                                      {isRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                                    </button>
                                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); handleCopyPassword(p.project_id) }}
                                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700"
                                      title="Copy (tự xóa sau 30s)">
                                      {copiedPassword === `pw-${p.project_id}` ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                    </button>
                                  </div>
                                ) : (
                                  <span
                                    onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'affiliate_password' })}
                                    className={cn('text-slate-300 text-xs', canEditCampFields && 'cursor-text hover:bg-slate-100 px-1 rounded')}
                                  >—</span>
                                )}
                              </div>
                            </td>
                            {/* Link Ref */}
                            <td
                              className={cn('px-4 py-3 max-w-[160px] transition-colors', canEditCampFields && 'cursor-text', selCls(rowIndex, 3), pastedCells.has(`${p.project_id}-ref_link`) && 'bg-yellow-50')}
                              onMouseDown={e => selMouseDown(rowIndex, 3, e.shiftKey, () => e.preventDefault())}
                              onMouseEnter={() => selMouseEnter(rowIndex, 3)}
                              onClick={e => { if (canEditCampFields && !(e.target as HTMLElement).closest('a, button, input')) setEditingCell({ id: p.project_id, field: 'ref_link' }) }}
                            >
                              <div className="relative">
                                {canEditCampFields && editingCell?.id === p.project_id && editingCell.field === 'ref_link' && (
                                  <input autoFocus defaultValue={p.ref_link ?? ''}
                                    className={cn('absolute left-0 top-1/2 -translate-y-1/2 z-20 w-full px-2.5 py-2 text-sm outline-none border-2 rounded-md bg-white shadow-lg', errorCells.has(`${p.project_id}-ref_link`) ? 'border-red-400' : 'border-blue-400')}
                                    onFocus={e => e.target.select()}
                                    onPaste={e => handleMultiRowPaste(e, rowIndex, 'ref_link', p)}
                                    onBlur={e => { if (!e.relatedTarget) saveCell(p, 'ref_link', e.target.value) }}
                                    onKeyDown={e => {
                                      if (e.key === 'Escape') { setEditingCell(null); return }
                                      if (e.key === 'Enter') { e.currentTarget.blur(); return }
                                      if (e.key === 'Tab') {
                                        e.preventDefault()
                                        if (e.shiftKey) {
                                          saveCell(p, 'ref_link', e.currentTarget.value, CELL_ORDER[2])
                                        } else {
                                          const nextRow = sorted[rowIndex + 1]
                                          saveCell(p, 'ref_link', e.currentTarget.value, undefined, true)
                                          if (nextRow) setEditingCell({ id: nextRow.project_id, field: 'affiliate_url' })
                                          else setEditingCell(null)
                                        }
                                      }
                                    }}
                                  />
                                )}
                                {p.ref_link ? (
                                  <div className="flex items-center gap-1.5 group"
                                    onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'ref_link' })}>
                                    <Link2 size={11} className="text-slate-400 shrink-0" />
                                    <span className={cn('text-xs text-slate-600 truncate', canEditCampFields && 'cursor-text')} title={p.ref_link}>
                                      {p.ref_link.replace(/^https?:\/\//, '').slice(0, 22)}{p.ref_link.length > 28 ? '…' : ''}
                                    </span>
                                    <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); copyText(p.ref_link!, `ref1-${p.project_id}`, v => setCopied(v)) }}
                                      className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                      {copied === `ref1-${p.project_id}` ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                    </button>
                                  </div>
                                ) : (
                                  <span
                                    onClick={() => canEditCampFields && setEditingCell({ id: p.project_id, field: 'ref_link' })}
                                    className={cn('text-slate-300 text-xs', canEditCampFields && 'cursor-text hover:bg-slate-100 px-1 rounded')}
                                  >—</span>
                                )}
                              </div>
                            </td>
                            {/* Affiliate Network */}
                            <td className="px-4 py-3">
                              <NetworkSelect
                                value={p.affiliate_network ?? null}
                                networks={affiliateNetworks}
                                canManage={isAdminOrManager}
                                disabled={!canEditCampFields}
                                onChange={async name => {
                                  const prev = p.affiliate_network
                                  patchProjectLocal({ ...p, affiliate_network: name })
                                  const res = await authFetch(`/api/projects/${p.project_id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ affiliate_network: name }),
                                  })
                                  if (!res.ok) patchProjectLocal({ ...p, affiliate_network: prev })
                                }}
                                onNetworkCreated={n => setAffiliateNetworks(prev => [...prev, n])}
                                onNetworkUpdated={n => setAffiliateNetworks(prev => prev.map(x => x.id === n.id ? n : x))}
                                onNetworkDeleted={id => setAffiliateNetworks(prev => prev.filter(x => x.id !== id))}
                                authFetch={authFetch}
                              />
                            </td>
                            {/* Tình trạng */}
                            <td className="px-4 py-3">
                              <StatusPicker
                                value={p.statuses ?? []}
                                onChange={canEditCampFields ? s => handleStatusChange(p, s) : () => {}}
                                inline={canEditCampFields}
                                compact={!canEditCampFields}
                              />
                            </td>
                            {/* Ngày lên camp */}
                            <td className="px-4 py-3">
                              {canEditCampFields ? (
                                <input type="date" value={p.camp_start_date ?? ''}
                                  onChange={async e => {
                                    const d = e.target.value || null
                                    patchProjectLocal({ ...p, camp_start_date: d })
                                    const res = await authFetch(`/api/projects/${p.project_id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ camp_start_date: d }),
                                    })
                                    if (!res.ok) patchProjectLocal({ ...p })
                                  }}
                                  className="text-xs px-1.5 py-1 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300 text-slate-600" />
                              ) : (
                                p.camp_start_date
                                  ? <span className="text-xs text-slate-600">{new Date(p.camp_start_date).toLocaleDateString('vi-VN')}</span>
                                  : <span className="text-slate-300 text-xs">—</span>
                              )}
                            </td>
                            {/* Người phụ trách */}
                            <td className="px-4 py-3 whitespace-nowrap">
                              <UserSelect
                                value={p.person_in_charge ?? null}
                                users={teamUsers}
                                disabled={!canEditCampFields || teamUsers.length === 0}
                                onChange={async id => {
                                  const prev = p.person_in_charge
                                  patchProjectLocal({ ...p, person_in_charge: id })
                                  const res = await authFetch(`/api/projects/${p.project_id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ person_in_charge: id }),
                                  })
                                  if (!res.ok) patchProjectLocal({ ...p, person_in_charge: prev })
                                }}
                              />
                            </td>
                            {/* Note */}
                            <td className="px-4 py-3 max-w-[160px]">
                              <div
                                onClick={e => canEditCampFields && openNotePopover(p, e.currentTarget as HTMLElement)}
                                className={cn('flex items-center gap-1 text-xs text-slate-600 min-h-[20px] truncate',
                                  canEditCampFields && 'cursor-text hover:bg-slate-100 px-1 rounded')}
                                title={p.note ?? undefined}
                              >
                                {p.note
                                  ? <><FileText size={11} className="text-slate-400 shrink-0" /><span className="truncate">{p.note}</span></>
                                  : <span className="text-slate-300">—</span>
                                }
                              </div>
                            </td>
                            {/* Reminder bell */}
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setReminderProject({ id: p.project_id, name: p.name })}
                                className={cn('p-1.5 rounded-md transition-colors',
                                  hasReminder ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100')}
                                title="Nhắc nhở">
                                <Bell size={14} />
                              </button>
                            </td>
                            {/* Người thêm */}
                            <td className="px-4 py-3 whitespace-nowrap">
                              {(() => {
                                const u = teamUsers.find(u => u.user_id === p.created_by)
                                return u
                                  ? <div className="flex items-center gap-1.5">
                                      <UserAvatar userId={u.user_id} name={u.full_name} size="sm" />
                                      <span className="text-xs text-slate-600">{u.full_name}</span>
                                    </div>
                                  : <span className="text-slate-300">—</span>
                              })()}
                            </td>
                            {/* Ngày thêm */}
                            <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                              {p.created_at ? new Date(p.created_at).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'}
                            </td>
                            {/* Actions */}
                            {isAdminOrManager && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1 justify-end">
                                  <button onClick={() => handleDeleteProject(p)}
                                    className="p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors">
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {sorted.length === 0 && (
                    <div className="py-10 text-center text-sm text-slate-400">Không tìm thấy dự án nào phù hợp.</div>
                  )}
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* ═══ TAB 2: ADS MAPPING ══════════════════════════════════════════ */}
      {tab === 'ads' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} type="text" placeholder="Tìm theo tên, ID, CID... (nhấn /)"
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Escape' && setSearch('')}
                className="pl-8 pr-3 py-1.5 w-full text-sm border border-slate-200 rounded-md bg-white outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <span className="text-xs text-slate-400">{sorted.length} dự án đang hoạt động</span>
          </div>

          {selectedCount > 0 && isAdminOrManager && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 rounded-lg text-white text-sm">
              <span className="font-medium">{selectedCount} đã chọn</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-white text-xs underline">Bỏ chọn</button>
              <div className="flex-1" />
              <button onClick={() => handleBulkDelete()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-md text-xs font-medium">
                <Trash2 size={13} /> Xóa {selectedCount}
              </button>
            </div>
          )}

          {isLoading ? <TableSkeleton rows={8} cols={9} /> : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <input ref={headerCheckboxRef} type="checkbox" checked={allFilteredSelected} onChange={toggleAll}
                          className="rounded border-slate-300 cursor-pointer accent-slate-700" />
                      </th>
                      <th onClick={() => handleSort('project_id')}
                        className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">Project ID {sortKey === 'project_id' ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="text-slate-400" />}</span>
                      </th>
                      <th onClick={() => handleSort('name')}
                        className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">Tên dự án {sortKey === 'name' ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="text-slate-400" />}</span>
                      </th>
                      {['Tình trạng', 'CID', 'ID Campaign', 'MCC', 'ID MCC', 'Tổng Dự Án', 'Link Ref', 'Username', 'Bank Nhận'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                      {isAdminOrManager && <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">Chia sẻ</th>}
                      {isAdminOrManager && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(p => {
                      const isSelected = selectedIds.has(p.project_id)
                      return (
                        <tr key={p.project_id}
                          className={cn('border-b border-slate-100 transition-colors', isSelected ? 'bg-slate-50' : 'hover:bg-slate-50')}>
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleOne(p.project_id)}
                              className="rounded border-slate-300 cursor-pointer accent-slate-700" />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.project_id}</td>
                          <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{p.name}</td>
                          {/* Tình trạng */}
                          <td className="px-4 py-3">
                            <StatusPicker value={p.statuses ?? []} onChange={() => {}} compact />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{fmtCustomerId(campaignInfoMap.get(p.project_id)?.customer_id ?? p.cid)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">{campaignInfoMap.get(p.project_id)?.campaign_id ?? <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {campaignInfoMap.get(p.project_id)?.mcc_name
                              ? campaignInfoMap.get(p.project_id)!.mcc_name
                              : campaignInfoMap.has(p.project_id)
                                ? <button onClick={refreshMccInfo} disabled={syncingMcc}
                                    className="flex items-center gap-1 text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-50">
                                    {syncingMcc ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                    <span>Cập nhật</span>
                                  </button>
                                : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {(() => {
                              const info = campaignInfoMap.get(p.project_id)
                              if (!info?.mcc_id) return <span className="text-slate-300">—</span>
                              const mccClean = info.mcc_id.replace(/-/g, '')
                              const cidClean = (info.customer_id ?? '').replace(/-/g, '')
                              if (mccClean === cidClean) return <span className="text-slate-300">—</span>
                              return fmtCustomerId(info.mcc_id)
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {p.master_project_id
                              ? <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium whitespace-nowrap">{masterProjects.find(m => m.id === p.master_project_id)?.name ?? p.master_project_id}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 max-w-[160px]">
                            {p.ref_link ? (
                              <div className="flex items-center gap-1.5 group">
                                <Link2 size={11} className="text-slate-400 shrink-0" />
                                <span className="text-xs text-slate-600 truncate" title={p.ref_link}>{p.ref_link.replace(/^https?:\/\//, '').slice(0, 30)}{p.ref_link.length > 35 ? '…' : ''}</span>
                                <button onClick={() => copyText(p.ref_link!, p.project_id, v => setCopied(v))}
                                  className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                  {copied === p.project_id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                </button>
                              </div>
                            ) : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 max-w-[180px]">
                            {(() => { const username = p.affiliate_username ?? p.email_ref; return username ? (
                              <div className="flex items-center gap-1.5 group">
                                <span className="text-xs text-slate-600 truncate" title={username}>{username.length > 28 ? username.slice(0, 28) + '…' : username}</span>
                                <button onClick={() => copyText(username, `usr2-${p.project_id}`, v => setCopied(v))}
                                  className="opacity-0 group-hover:opacity-100 shrink-0 p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                  {copied === `usr2-${p.project_id}` ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                </button>
                              </div>
                            ) : <span className="text-slate-300 text-xs">—</span>; })()}
                          </td>
                          <td className="px-4 py-3 min-w-[180px]">
                            {p.bank_accounts ? (
                              p.bank_accounts.banks?.bank_category === 'crypto' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold bg-orange-50 text-orange-700 border border-orange-200">₿ {p.bank_accounts.banks?.name}</span>
                                    <span className="text-xs font-bold text-slate-800">{p.bank_accounts.coin_type}</span>
                                    {p.bank_accounts.network && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${networkBadge(p.bank_accounts.network)}`}>{p.bank_accounts.network}</span>}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono text-xs text-slate-500">{p.bank_accounts.wallet_address ? shortenAddr(p.bank_accounts.wallet_address) : '—'}</span>
                                    {p.bank_accounts.wallet_address && (
                                      <button onClick={() => copyText(p.bank_accounts!.wallet_address!, p.bank_accounts!.id, v => setCopiedWallet(v))}
                                        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                                        {copiedWallet === p.bank_accounts.id ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                                      </button>
                                    )}
                                    <span className="text-slate-300 text-xs">·</span>
                                    <span className="text-xs text-slate-500">{p.bank_accounts.owner_name}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-600 border border-slate-200">🏦 {p.bank_accounts.banks?.name}</span>
                                  <p className="text-xs text-slate-600 mt-0.5">
                                    {p.bank_accounts.account_identifier && <span className="font-mono">{p.bank_accounts.account_identifier} · </span>}
                                    {p.bank_accounts.owner_name}
                                  </p>
                                </div>
                              )
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium border border-amber-200 whitespace-nowrap">Chưa cấu hình</span>
                            )}
                          </td>
                          {isAdminOrManager && (
                            <td className="px-4 py-3">
                              {(shareCountMap.get(p.project_id) ?? 0) > 0 ? (
                                <button onClick={() => router.push(`/projects/${p.project_id}?tab=share`)}
                                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:underline">
                                  <Share2 size={11} />{shareCountMap.get(p.project_id)}
                                </button>
                              ) : <span className="text-slate-300 text-xs">—</span>}
                            </td>
                          )}
                          {isAdminOrManager && (
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => setDialog({ mode: 'edit', data: p })}
                                  className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><Pencil size={13} /></button>
                                <button onClick={() => handleDeleteProject(p)}
                                  className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {sorted.length === 0 && (
                  <div className="py-10 text-center text-sm text-slate-400">
                    Không có dự án nào đang hoạt động. Đặt trạng thái &quot;Chờ TT / Đang Scale / Dừng Camp / Tạm Dừng&quot; trong Tab Quản lý Dự Án để hiện ở đây.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ TAB 3: TỔNG DỰ ÁN ════════════════════════════════════════ */}
      {tab === 'master' && <MasterProjectsTab />}

      {/* ─── Project Detail Drawer ─────────────────────────────────────── */}
      <ProjectDetailDrawer
        project={drawerProject}
        onClose={() => setDrawerProject(null)}
        authFetch={authFetch}
        teamUsers={teamUsers}
        onProjectUpdated={updated => {
          patchProjectLocal(updated)
          setDrawerProject(updated)
        }}
      />

      {/* ─── Modals ────────────────────────────────────────────────────── */}
      {dialog && (
        <ProjectFormDialog
          mode={dialog.mode}
          initialData={dialog.data}
          existingIds={projects.map(p => p.project_id)}
          masterProjects={masterProjects}
          teamUsers={teamUsers}
          onSave={async (p) => {
            // Enrich category object so local state stays in sync without reload
            const enriched: typeof p = {
              ...p,
              category: p.category_id ? (categories.find(c => c.id === p.category_id) ?? p.category ?? null) : null,
            }
            const err = await (dialog.mode === 'add' ? addProject : updateProject)(enriched)
            if (err) { toast.error(err); return err }
            toast.success(dialog.mode === 'add' ? 'Đã tạo dự án' : 'Đã cập nhật dự án')
            return null
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {reminderProject && (
        <ReminderModal
          projectId={reminderProject.id}
          projectName={reminderProject.name}
          onClose={() => setReminderProject(null)}
          authFetch={authFetch}
          onReminderChange={(projectId, hasActive) => {
            setReminderMap(prev => {
              const next = new Map(prev)
              if (hasActive) next.set(projectId, true)
              else next.delete(projectId)
              return next
            })
          }}
        />
      )}

      {notePopover && createPortal(
        <div
          style={{ position: 'fixed', top: notePopover.pos.top, left: notePopover.pos.left, zIndex: 9999 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl p-3 w-80"
        >
          <textarea
            autoFocus
            defaultValue={notePopover.initValue}
            rows={5}
            placeholder="Nhập ghi chú..."
            className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-2 outline-none focus:ring-1 focus:ring-blue-400 resize-none"
            onKeyDown={e => {
              if (e.key === 'Escape') { setNotePopover(null); return }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                const proj = projects.find(x => x.project_id === notePopover.id)
                if (proj) saveCell(proj, 'note', e.currentTarget.value)
                setNotePopover(null)
              }
            }}
            onBlur={e => {
              const proj = projects.find(x => x.project_id === notePopover.id)
              if (proj) saveCell(proj, 'note', e.currentTarget.value)
              setNotePopover(null)
            }}
          />
          <span className="text-[10px] text-slate-400 mt-1 block">⌘+Enter lưu · Esc hủy · Click ngoài lưu</span>
        </div>,
        document.body
      )}

    </div>
  )
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-400">Đang tải...</div>}>
      <ProjectsPageInner />
    </Suspense>
  )
}
