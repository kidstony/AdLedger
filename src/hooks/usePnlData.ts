'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { aggregatePnl } from '@/lib/utils'
import { AdDevice, DateRange, PnlSummary, Project, RentalGroup, OtherCost, DailyPnlRow } from '@/lib/types'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useDateRange } from '@/context/DateRangeContext'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { computeCidCost, computeCidCostForDay } from '@/lib/costs'
import { allocateSpendRow, buildSiblingsByCampaign, splitSpend } from '@/lib/attribution'
import { type FilterProject } from '@/components/revenue/ProjectFilterDropdown'

interface AdSpendRow {
  campaign_id: string
  date: string
  spend: number
  device: AdDevice
  ad_group_id: string
}

interface CampaignInfo {
  campaign_id: string
  customer_id: string
  mcc_id: string | null
  project_id: string | null
}

interface RevenueRow {
  project_id: string
  date: string
  type: 'confirmed' | 'pending'
  amount: number
  cycle_end?: boolean | null
}

export function usePnlData() {
  const { projects } = useProjectsContext()
  const { dateRange, setDateRange } = useDateRange()
  const { role } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [pnlView, setPnlView] = useState<'screen' | 'confirmed'>('screen')
  const [search, setSearch] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const [adSpendRows, setAdSpendRows] = useState<AdSpendRow[] | null>(null)
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([])
  const [rentalGroups, setRentalGroups] = useState<RentalGroup[]>([])
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [campaignInfoByProjectId, setCampaignInfoByProjectId] = useState<Map<string, CampaignInfo>>(new Map())
  const [prevCumulativeMap, setPrevCumulativeMap] = useState<Map<string, number>>(new Map())

  // Map google_campaign_id → các ref-link project chung campaign (siblings)
  const siblingsByCampaign = useMemo(() => buildSiblingsByCampaign(projects), [projects])

  // Map google_campaign_id → cid (các sibling chung campaign ⇒ chung ad account)
  const cidByCampaign = useMemo(() => {
    const m = new Map<string, string>()
    siblingsByCampaign.forEach((sibs, campId) => {
      const cid = sibs.find(s => s.cid)?.cid
      if (cid) m.set(campId, cid)
    })
    return m
  }, [siblingsByCampaign])

  // Map cid → các project dùng chung ad account (để chia thuê TK giữa các sibling)
  const projectsByCidFull = useMemo(() => {
    const m = new Map<string, Project[]>()
    projects.forEach(p => {
      if (!p.cid) return
      const arr = m.get(p.cid) ?? []
      arr.push(p)
      m.set(p.cid, arr)
    })
    return m
  }, [projects])

  const activeProjectIds = useMemo(
    () => new Set(projects.map(p => p.project_id)),
    [projects]
  )
  const cumulativePids = useMemo(
    () => projects.filter(p => p.screen_revenue_type === 'cumulative').map(p => p.project_id),
    [projects]
  )

  async function fetchAdSpend(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const { data } = await supabase
      .from('ad_spend')
      .select('campaign_id, date, spend, device, ad_group_id')
      .gte('date', from)
      .lte('date', to)
    setAdSpendRows((data ?? []) as AdSpendRow[])
  }

  async function fetchRevenue(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const { data } = await supabase
      .from('affiliate_revenue')
      .select('*')
      .gte('date', from)
      .lte('date', to)
    setRevenueRows((data ?? []) as RevenueRow[])
  }

  async function authFetch(url: string) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, { headers: { 'Authorization': `Bearer ${session?.access_token ?? ''}` } })
  }

  async function fetchCosts(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const [rgRes, otherRes] = await Promise.all([
      authFetch('/api/expenses/rental-groups').then(r => r.json()),
      authFetch(`/api/expenses/other?from=${from}&to=${to}`).then(r => r.json()),
    ])
    setRentalGroups(Array.isArray(rgRes) ? rgRes : [])
    setOtherCosts(Array.isArray(otherRes) ? otherRes : [])
  }

  async function fetchCampaignInfo() {
    const res = await fetch('/api/integrations/campaigns').catch(() => null)
    if (!res?.ok) return
    const list: Array<CampaignInfo & { projects?: { project_id: string }[] }> = await res.json().catch(() => [])
    if (!Array.isArray(list)) return
    // Một campaign có thể gán cho nhiều dự án → set info cho tất cả project của nó.
    const map = new Map<string, CampaignInfo>()
    list.forEach(c => {
      const pids = c.projects?.length ? c.projects.map(p => p.project_id) : (c.project_id ? [c.project_id] : [])
      pids.forEach(pid => map.set(pid, { campaign_id: c.campaign_id, customer_id: c.customer_id, mcc_id: c.mcc_id, project_id: pid }))
    })
    setCampaignInfoByProjectId(map)
  }

  async function fetchLastSync() {
    const { data } = await supabase
      .from('sync_log')
      .select('synced_at')
      .eq('status', 'success')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single()
    if (data) setLastSyncedAt(data.synced_at)
  }

  useEffect(() => {
    fetchCampaignInfo()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAdSpend(dateRange)
    fetchRevenue(dateRange)
    fetchCosts(dateRange)
    fetchLastSync()
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch baseline cumulative value before date range — depends on both dateRange AND projects
  // (separate effect so it re-runs when projects load after initial render)
  useEffect(() => {
    const from = dateRange.from.toISOString().split('T')[0]
    if (cumulativePids.length === 0) {
      setPrevCumulativeMap(new Map())
      return
    }
    supabase
      .from('affiliate_revenue')
      .select('*')
      .in('project_id', cumulativePids)
      .eq('type', 'pending')
      .lt('date', from)
      .order('date', { ascending: false })
      .then(({ data }) => {
        const prevMap = new Map<string, number>()
        // If the last entry before the range is a cycle_end (đã chốt kỳ), the effective
        // baseline is 0 — the next cycle starts fresh.
        data?.forEach(r => { if (!prevMap.has(r.project_id)) prevMap.set(r.project_id, r.cycle_end ? 0 : r.amount) })
        setPrevCumulativeMap(prevMap)
      })
  }, [dateRange, cumulativePids]) // eslint-disable-line react-hooks/exhaustive-deps

  const dataSource: 'real' | 'mock' = (adSpendRows && adSpendRows.length > 0) ? 'real' : 'mock'

  const allSummaries = useMemo(() => {
    const fromStr = dateRange.from.toISOString().split('T')[0]
    const toStr   = dateRange.to.toISOString().split('T')[0]

    // adSpendByCid: needed for percentage rental rate calculation. Tổng theo CID
    // không đổi bởi cách chia sibling (các sibling chung campaign ⇒ chung cid).
    const adSpendByCid = new Map<string, number>()
    adSpendRows?.forEach(row => {
      const cid = cidByCampaign.get(row.campaign_id)
      if (cid) adSpendByCid.set(cid, (adSpendByCid.get(cid) ?? 0) + row.spend)
    })

    // Other cost per project (only those linked to a project)
    const otherByProject = new Map<string, number>()
    otherCosts.forEach(c => {
      if (c.project_id) otherByProject.set(c.project_id, (otherByProject.get(c.project_id) ?? 0) + c.amount)
    })

    if (dataSource === 'real' && adSpendRows && adSpendRows.length > 0) {
      // Aggregate revenue from affiliate_revenue by project_id
      const cumulativePidSet = new Set(
        projects.filter(p => p.screen_revenue_type === 'cumulative').map(p => p.project_id)
      )
      const revenueByProject = new Map<string, number>()
      const screenByProject  = new Map<string, number>()
      const cumulativeRowsByPid = new Map<string, RevenueRow[]>()

      revenueRows.forEach(r => {
        if (r.type === 'confirmed') {
          revenueByProject.set(r.project_id, (revenueByProject.get(r.project_id) ?? 0) + r.amount)
        } else if (cumulativePidSet.has(r.project_id)) {
          // Pending cumulative entries store the running total, not per-day earnings.
          // Collect rows; per-day deltas (honoring cycle_end resets) are summed below.
          const arr = cumulativeRowsByPid.get(r.project_id) ?? []
          arr.push(r)
          cumulativeRowsByPid.set(r.project_id, arr)
        } else {
          screenByProject.set(r.project_id, (screenByProject.get(r.project_id) ?? 0) + r.amount)
        }
      })
      // Sum per-day deltas. A day marked cycle_end (đã chốt kỳ) resets the baseline to 0
      // for the following day, matching the Revenue page's getCumulativeDelta.
      cumulativeRowsByPid.forEach((rows, pid) => {
        rows.sort((a, b) => a.date.localeCompare(b.date))
        let prev = prevCumulativeMap.get(pid) ?? 0
        let total = 0
        rows.forEach(r => {
          total += r.amount - prev
          prev = r.cycle_end ? 0 : r.amount
        })
        screenByProject.set(pid, (screenByProject.get(pid) ?? 0) + total)
      })

      // Cơ sở chia sibling khi không tách được ở nguồn: ưu tiên doanh thu màn hình
      // (screen) để có tín hiệu sớm, fallback doanh thu đã xác nhận.
      const revenueBasis = new Map<string, number>()
      new Set([...revenueByProject.keys(), ...screenByProject.keys()]).forEach(pid => {
        revenueBasis.set(pid, (screenByProject.get(pid) || revenueByProject.get(pid)) ?? 0)
      })

      // Chi phí QC per project qua resolver (device / ad_group / date_window /
      // fallback chia theo doanh thu khi nhiều ref-link project chung 1 campaign).
      const spendByProject = new Map<string, number>()
      adSpendRows.forEach(row => {
        const sibs = siblingsByCampaign.get(row.campaign_id)
        if (!sibs?.length) return
        allocateSpendRow(row, sibs, revenueBasis).forEach((portion, pid) => {
          spendByProject.set(pid, (spendByProject.get(pid) ?? 0) + portion)
        })
      })

      // Rental cost per project — chia giữa các sibling chung 1 CID.
      const rentalByProject = new Map<string, number>()
      rentalGroups.forEach(rg => {
        rg.rental_group_cids?.forEach(cidEntry => {
          const cost = computeCidCost(cidEntry.cid, rg, fromStr, toStr, adSpendByCid)
          if (!cost) return
          if (cidEntry.project_id) {
            rentalByProject.set(cidEntry.project_id, (rentalByProject.get(cidEntry.project_id) ?? 0) + cost)
            return
          }
          const sibs = projectsByCidFull.get(cidEntry.cid) ?? []
          if (sibs.length > 1) {
            splitSpend(cost, sibs, revenueBasis).forEach((v, pid) =>
              rentalByProject.set(pid, (rentalByProject.get(pid) ?? 0) + v))
          } else if (sibs[0]) {
            rentalByProject.set(sibs[0].project_id, (rentalByProject.get(sibs[0].project_id) ?? 0) + cost)
          }
        })
      })

      // Build a summary entry for every project that has spend/revenue/cost.
      const projectById = new Map(projects.map(p => [p.project_id, p]))
      const map = new Map<string, PnlSummary>()
      for (const pid of new Set([
        ...spendByProject.keys(),
        ...revenueByProject.keys(),
        ...screenByProject.keys(),
        ...rentalByProject.keys(),
        ...otherByProject.keys(),
      ])) {
        const project = projectById.get(pid)
        if (!project) continue
        const campaignInfo = campaignInfoByProjectId.get(pid)
        map.set(pid, {
          project_id: pid,
          cid:        campaignInfo?.customer_id ?? project.cid ?? null,
          name:       project.name,
          mcc_id:     campaignInfo?.mcc_id ?? project.mcc_id ?? null,
          total_spend: spendByProject.get(pid) ?? 0,
          total_rental: 0, total_other: 0,
          total_revenue: 0, total_profit: 0, avg_roi: 0,
          total_screen_revenue: 0, screen_profit: 0, screen_roi: 0, total_pending: 0,
          share_access_level:    project.share_access_level ?? null,
          effective_permissions: project.effective_permissions ?? null,
        })
      }

      // Apply revenue, rental, other costs, then compute profit/ROI
      map.forEach(s => {
        s.total_revenue        = revenueByProject.get(s.project_id) ?? 0
        s.total_screen_revenue = screenByProject.get(s.project_id) ?? 0
        s.total_rental         = rentalByProject.get(s.project_id) ?? 0
        s.total_other          = otherByProject.get(s.project_id) ?? 0
        const totalCost        = s.total_spend + s.total_rental + s.total_other
        s.total_profit         = s.total_revenue - totalCost
        s.screen_profit        = s.total_screen_revenue - totalCost
        s.total_pending        = s.total_screen_revenue
        s.avg_roi              = totalCost > 0 ? (s.total_profit / totalCost) * 100 : 0
        s.screen_roi           = totalCost > 0 ? (s.screen_profit / totalCost) * 100 : 0
      })

      return Array.from(map.values())
    }

    // Fallback: mock data (rental/other = 0)
    const projectByIdMap = new Map(projects.map(p => [p.project_id, p]))
    const filteredDaily = MOCK_PNL_DAILY.filter(row => activeProjectIds.has(row.project_id))
    const summaries = aggregatePnl(filteredDaily, dateRange)
    summaries.forEach(s => {
      const p = projectByIdMap.get(s.project_id)
      if (p?.name) s.name = p.name
      s.total_screen_revenue = 0
      s.total_pending = 0
      s.share_access_level = p?.share_access_level ?? null
      s.effective_permissions = p?.effective_permissions ?? null
    })
    return summaries
  }, [dataSource, adSpendRows, revenueRows, rentalGroups, otherCosts, siblingsByCampaign, cidByCampaign, projectsByCidFull, activeProjectIds, dateRange, campaignInfoByProjectId, prevCumulativeMap, projects])

  const filterProjectData = useMemo<FilterProject[]>(() =>
    allSummaries.map(s => ({
      project_id: s.project_id,
      name: s.name,
      isActive: s.total_spend > 0 || s.total_revenue > 0,
      monthlyRevenue: s.total_revenue,
    })),
    [allSummaries]
  )

  // For members: mask unauthorized numeric fields to 0 so totals are correct
  const maskedSummaries = useMemo(() => {
    if (role !== 'member') return allSummaries
    return allSummaries.map(s => {
      const p = s.effective_permissions
      if (!p) return s
      return {
        ...s,
        total_spend:          p.view_adspend  ? s.total_spend          : 0,
        total_rental:         p.view_adspend  ? s.total_rental         : 0,
        total_other:          p.view_adspend  ? s.total_other          : 0,
        total_revenue:        p.view_revenue  ? s.total_revenue        : 0,
        total_screen_revenue: p.view_revenue  ? s.total_screen_revenue : 0,
        total_pending:        p.view_revenue  ? s.total_pending        : 0,
        total_profit:         p.view_profit   ? s.total_profit         : 0,
        avg_roi:              p.view_profit   ? s.avg_roi              : 0,
        screen_profit:        p.view_profit   ? s.screen_profit        : 0,
        screen_roi:           p.view_profit   ? s.screen_roi           : 0,
      }
    })
  }, [allSummaries, role])

  const filtered = useMemo(() => {
    let result = maskedSummaries
    if (selectedProjectIds.size > 0)
      result = result.filter(s => selectedProjectIds.has(s.project_id))
    if (!search.trim()) return result
    const q = search.toLowerCase()
    return result.filter(s => s.name.toLowerCase().includes(q) || s.project_id.includes(q))
  }, [maskedSummaries, search, selectedProjectIds])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        spend:          acc.spend   + s.total_spend,
        rental:         acc.rental  + s.total_rental,
        other:          acc.other   + s.total_other,
        revenue:        acc.revenue + s.total_revenue,
        profit:         acc.profit  + s.total_profit,
        screen_revenue: acc.screen_revenue + s.total_screen_revenue,
        screen_profit:  acc.screen_profit + s.screen_profit,
        pending:        acc.pending + s.total_pending,
      }),
      { spend: 0, rental: 0, other: 0, revenue: 0, profit: 0, screen_revenue: 0, screen_profit: 0, pending: 0 }
    )
  }, [filtered])

  const totalCost = totals.spend + totals.rental + totals.other
  const avgRoi    = totalCost > 0 ? (totals.profit / totalCost) * 100 : 0
  const screenRoi = totalCost > 0 ? (totals.screen_profit / totalCost) * 100 : 0

  // Table rows resolved to the active view: override profit/ROI so PnlTable's
  // sort, filter and row-coloring (which read total_profit/avg_roi) follow the toggle.
  const viewData = useMemo(() =>
    pnlView === 'screen'
      ? filtered.map(s => ({ ...s, total_profit: s.screen_profit, avg_roi: s.screen_roi }))
      : filtered,
    [filtered, pnlView]
  )

  const refresh = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([fetchAdSpend(dateRange), fetchRevenue(dateRange), fetchCosts(dateRange), fetchLastSync(), fetchCampaignInfo()])
    setIsLoading(false)
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const dailyChartData = useMemo<DailyPnlRow[]>(() => {
    if (dataSource !== 'real' || !adSpendRows?.length) return []
    const fromStr = dateRange.from.toISOString().split('T')[0]
    const toStr   = dateRange.to.toISOString().split('T')[0]
    const projectIds = selectedProjectIds.size > 0 ? selectedProjectIds : null
    const cumulativePidSet = new Set(cumulativePids)
    // Cơ sở chia sibling: tái dùng doanh thu đã tính ở allSummaries (screen ưu tiên).
    const revenueBasis = new Map(allSummaries.map(s => [s.project_id, s.total_screen_revenue || s.total_revenue]))
    const byDate = new Map<string, { date: string; spend: number; revenue: number }>()
    // daySpendByCid: chi phí QC theo ngày theo cid (dùng cho rental rate_type 'percentage')
    const daySpendByCid = new Map<string, Map<string, number>>()
    adSpendRows.forEach(row => {
      const sibs = siblingsByCampaign.get(row.campaign_id)
      if (!sibs?.length) return
      const cid = cidByCampaign.get(row.campaign_id)
      allocateSpendRow(row, sibs, revenueBasis).forEach((portion, pid) => {
        if (projectIds && !projectIds.has(pid)) return
        const e = byDate.get(row.date) ?? { date: row.date, spend: 0, revenue: 0 }
        e.spend += portion
        byDate.set(row.date, e)
        if (cid) {
          const m = daySpendByCid.get(row.date) ?? new Map<string, number>()
          m.set(cid, (m.get(cid) ?? 0) + portion)
          daySpendByCid.set(row.date, m)
        }
      })
    })

    // Screen (pending) revenue per date. Daily-mode: sum directly.
    // Cumulative-mode: per-day delta vs previous entry (baseline before range = prevCumulativeMap).
    const screenByDate = new Map<string, number>()
    const cumulativeRows = new Map<string, RevenueRow[]>()
    revenueRows.forEach(r => {
      if (projectIds && !projectIds.has(r.project_id)) return
      if (r.type === 'confirmed') {
        const e = byDate.get(r.date) ?? { date: r.date, spend: 0, revenue: 0 }
        e.revenue += r.amount
        byDate.set(r.date, e)
      } else if (cumulativePidSet.has(r.project_id)) {
        const arr = cumulativeRows.get(r.project_id) ?? []
        arr.push(r)
        cumulativeRows.set(r.project_id, arr)
      } else {
        screenByDate.set(r.date, (screenByDate.get(r.date) ?? 0) + r.amount)
      }
    })
    cumulativeRows.forEach((rows, pid) => {
      rows.sort((a, b) => a.date.localeCompare(b.date))
      let prev = prevCumulativeMap.get(pid) ?? 0
      rows.forEach(r => {
        screenByDate.set(r.date, (screenByDate.get(r.date) ?? 0) + (r.amount - prev))
        // Ngày đã "chốt kỳ" → reset mốc về 0 cho ngày kế (platform reset sau thanh toán)
        prev = r.cycle_end ? 0 : r.amount
      })
    })

    // Chi phí thuê TK (rental) + CP khác (other) theo từng ngày lịch trong khoảng.
    // Cộng theo tất cả ngày ≡ tổng ở summary cards (per-day sum == range-level cost).
    const rentalByDate = new Map<string, number>()
    for (let d = new Date(fromStr + 'T00:00:00Z'); d.toISOString().split('T')[0] <= toStr; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().split('T')[0]
      const daySpend = daySpendByCid.get(day) ?? new Map<string, number>()
      let total = 0
      rentalGroups.forEach(rg => {
        rg.rental_group_cids?.forEach(cidEntry => {
          const dayCost = computeCidCostForDay(cidEntry.cid, rg, day, daySpend)
          if (!dayCost) return
          if (cidEntry.project_id) {
            if (!projectIds || projectIds.has(cidEntry.project_id)) total += dayCost
            return
          }
          const sibs = projectsByCidFull.get(cidEntry.cid) ?? []
          if (sibs.length > 1) {
            splitSpend(dayCost, sibs, revenueBasis).forEach((v, pid) => {
              if (!projectIds || projectIds.has(pid)) total += v
            })
          } else if (sibs[0]) {
            if (!projectIds || projectIds.has(sibs[0].project_id)) total += dayCost
          }
        })
      })
      if (total > 0) rentalByDate.set(day, total)
    }

    const otherByDate = new Map<string, number>()
    otherCosts.forEach(c => {
      if (!c.project_id) return
      if (projectIds && !projectIds.has(c.project_id)) return
      otherByDate.set(c.date, (otherByDate.get(c.date) ?? 0) + c.amount)
    })

    const dates = new Set([...byDate.keys(), ...screenByDate.keys(), ...rentalByDate.keys(), ...otherByDate.keys()])
    return Array.from(dates)
      .sort((a, b) => a.localeCompare(b))
      .map(date => {
        const e = byDate.get(date) ?? { date, spend: 0, revenue: 0 }
        const rentalDay = rentalByDate.get(date) ?? 0
        const otherDay  = otherByDate.get(date) ?? 0
        const cost = e.spend + rentalDay + otherDay
        const screenRevenue = screenByDate.get(date) ?? 0
        const profit = e.revenue - cost
        const screenProfit = screenRevenue - cost
        return {
          date,
          spend: e.spend,
          rentalDay,
          otherDay,
          cost,
          revenue: e.revenue,
          screenRevenue,
          profit,
          screenProfit,
          roi: cost > 0 ? (profit / cost) * 100 : 0,
          screenRoi: cost > 0 ? (screenProfit / cost) * 100 : 0,
        }
      })
  }, [dataSource, adSpendRows, revenueRows, selectedProjectIds, siblingsByCampaign, cidByCampaign, projectsByCidFull, cumulativePids, prevCumulativeMap, rentalGroups, otherCosts, dateRange, allSummaries])

  return {
    data: viewData as PnlSummary[],
    allSummaries,
    totals: { ...totals, avgRoi, screenRoi },
    pnlView,
    setPnlView,
    isLoading,
    dateRange,
    setDateRange,
    search,
    setSearch,
    selectedProjectIds,
    setSelectedProjectIds,
    filterProjectData,
    refresh,
    dataSource,
    lastSyncedAt,
    dailyChartData,
  }
}
