'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import PageHeader from '@/components/ui/PageHeader'
import TabBar from '@/components/ui/TabBar'
import EngineHealthStrip from './EngineHealthStrip'
import AccountsTab from './AccountsTab'
import MonitorTab from './MonitorTab'
import {
  ENGINE_API, SET_API, authFetch, workerState as computeWorkerState,
  type DayRow, type EngineAlert, type EngineRun, type Settings,
} from './shared'

export default function RevenueEnginePage() {
  const { role } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<'accounts' | 'monitor'>('accounts')

  // Dữ liệu monitor (runs / alerts / days) — page giữ để đếm cảnh báo cho health strip.
  const [runs, setRuns] = useState<EngineRun[]>([])
  const [alerts, setAlerts] = useState<EngineAlert[]>([])
  const [days, setDays] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(true)

  // Settings + heartbeat worker (poll 30s).
  const [settings, setSettings] = useState<Settings | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    if (role && role !== 'super_admin' && role !== 'manager') router.replace('/dashboard')
  }, [role, router])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch(ENGINE_API)
    if (res.ok) {
      const d = await res.json()
      setRuns(d.runs ?? [])
      setAlerts(d.alerts ?? [])
      setDays(d.days ?? [])
    }
    setLoading(false)
  }, [])

  const loadSettings = useCallback(async () => {
    const res = await authFetch(SET_API)
    if (res.ok) setSettings((await res.json()).settings)
    setNowTick(Date.now())
  }, [])

  const saveSettings = async (patch: Partial<Settings>) => {
    const res = await authFetch(SET_API, { method: 'PUT', body: JSON.stringify(patch) })
    if (res.ok) setSettings((await res.json()).settings)
    else toast.error((await res.json().catch(() => ({}))).error ?? 'Lỗi lưu cài đặt')
  }

  useEffect(() => { load(); loadSettings() }, [load, loadSettings])

  // Heartbeat: cập nhật trạng thái worker mỗi 30s.
  useEffect(() => {
    const t = setInterval(loadSettings, 30_000)
    return () => clearInterval(t)
  }, [loadSettings])

  if (role !== 'super_admin' && role !== 'manager') return null

  const wState = computeWorkerState(settings?.worker_last_seen_at, nowTick)
  const workerAgeSec = settings?.worker_last_seen_at
    ? Math.max(0, Math.round((nowTick - new Date(settings.worker_last_seen_at).getTime()) / 1000))
    : null

  return (
    <div className="p-6 max-w-4xl space-y-5">
      <PageHeader
        title="Doanh thu Engine"
        subtitle="Tự động lấy doanh thu từ dashboard các network về P&L"
        actions={
          tab === 'monitor' ? (
            <Button variant="outline" size="sm" onClick={load} title="Làm mới dữ liệu">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Làm mới
            </Button>
          ) : undefined
        }
      />

      <EngineHealthStrip
        settings={settings}
        workerState={wState}
        workerAgeSec={wState === 'online' ? workerAgeSec : null}
        onSaveSettings={saveSettings}
        alertCount={alerts.length}
        onShowAlerts={() => setTab('monitor')}
      />

      <TabBar
        tabs={[
          { key: 'accounts', label: 'Tài khoản & Đồng bộ' },
          { key: 'monitor', label: 'Dữ liệu & Lịch sử' },
        ]}
        active={tab}
        onChange={k => setTab(k as 'accounts' | 'monitor')}
      />

      {tab === 'accounts'
        ? <AccountsTab workerState={wState} onDataChanged={load} />
        : <MonitorTab loading={loading} runs={runs} alerts={alerts} days={days} />}
    </div>
  )
}
