'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Copy, Eye, EyeOff, CheckCircle, XCircle, Loader2, RefreshCw, Zap, X, Search, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { CampaignDiscovery } from '@/lib/types'
import { toast } from 'sonner'

interface SyncLogEntry {
  id: string
  synced_at: string
  records: number
  status: 'success' | 'error'
  message: string | null
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors">
      <Copy size={12} />
      {copied ? 'Đã copy!' : label}
    </button>
  )
}

function buildDiscoverScript(secret: string, webhookUrl: string) {
  return `function main() {
  var SECRET  = '${secret}';
  var WEBHOOK = '${webhookUrl}';

  var mccName = AdsApp.currentAccount().getName();
  var mccId   = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

  var campaigns = [];

  function scanAccount(customerId) {
    var campaignIt = AdsApp.campaigns().get();
    while (campaignIt.hasNext()) {
      var c = campaignIt.next();
      campaigns.push({
        campaign_id:   c.getId().toString(),
        campaign_name: c.getName(),
        customer_id:   customerId,
        mcc_id:        mccId,
        mcc_name:      mccName
      });
    }
  }

  if (typeof MccApp !== 'undefined') {
    var accountIt = MccApp.accounts().get();
    while (accountIt.hasNext()) {
      var account = accountIt.next();
      MccApp.select(account);
      scanAccount(account.getCustomerId().replace(/-/g, ''));
    }
  } else {
    mccId = null;
    mccName = null;
    scanAccount(AdsApp.currentAccount().getCustomerId().replace(/-/g, ''));
  }

  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: SECRET, type: 'discover', campaigns: campaigns })
  });
}`
}

// Đoạn helper GAQL dùng chung cho cả spend hằng ngày lẫn backfill:
//  • quét chi phí theo campaign × ngày × device × ad_group (type:'spend') để tách
//    chi phí cho từng link ref (nguồn P&L);
//  • quét số liệu hiệu suất cấp campaign (type:'campaign_metrics') cho tính năng
//    "Tối Ưu Camp": impressions/clicks/CTR/CPC/Search Impression Share. Tách bảng
//    riêng campaign_metrics — KHÔNG ảnh hưởng P&L.
function gaqlScanFn() {
  return `  var metricRecords = [];

  function mapDevice(d) {
    d = String(d || '').toUpperCase();
    return (d === 'MOBILE' || d === 'DESKTOP' || d === 'TABLET') ? d : 'OTHER';
  }

  function flush() {
    for (var i = 0; i < records.length; i += BATCH) {
      UrlFetchApp.fetch(WEBHOOK, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ secret: SECRET, type: 'spend', records: records.slice(i, i + BATCH) })
      });
    }
    sent += records.length;
    records = [];
  }

  function flushMetrics() {
    for (var i = 0; i < metricRecords.length; i += BATCH) {
      UrlFetchApp.fetch(WEBHOOK, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ secret: SECRET, type: 'campaign_metrics', records: metricRecords.slice(i, i + BATCH) })
      });
    }
    metricRecords = [];
  }

  // Số liệu hiệu suất cấp campaign × ngày (Tối Ưu Camp). Google trả IS = null nếu
  // không đủ dữ liệu; conversions thường 0 vì affiliate không có conversion tracking.
  function scanCampaignMetrics() {
    var q =
      'SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, ' +
      'metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
      'metrics.search_impression_share, ' +
      'metrics.search_budget_lost_impression_share, ' +
      'metrics.search_rank_lost_impression_share ' +
      'FROM campaign ' +
      "WHERE segments.date BETWEEN '" + fromStr + "' AND '" + toStr + "' " +
      'AND metrics.impressions > 0';
    var rows = AdsApp.search(q);
    while (rows.hasNext()) {
      var r = rows.next();
      var m = r.metrics || {};
      metricRecords.push({
        campaign_id:             String(r.campaign.id),
        date:                    r.segments.date,
        impressions:             Number(m.impressions || 0),
        clicks:                  Number(m.clicks || 0),
        cost:                    Number(m.costMicros || 0) / 1e6,
        conversions:             m.conversions == null ? null : Number(m.conversions),
        conversions_value:       m.conversionsValue == null ? null : Number(m.conversionsValue),
        search_impression_share: m.searchImpressionShare == null ? null : Number(m.searchImpressionShare),
        search_budget_lost_is:   m.searchBudgetLostImpressionShare == null ? null : Number(m.searchBudgetLostImpressionShare),
        search_rank_lost_is:     m.searchRankLostImpressionShare == null ? null : Number(m.searchRankLostImpressionShare)
      });
      if (metricRecords.length >= 5000) flushMetrics();
    }
    flushMetrics();
  }

  function scanAccount(customerId) {
    var query =
      'SELECT campaign.id, campaign.name, ad_group.id, ' +
      'segments.date, segments.device, metrics.cost_micros ' +
      'FROM ad_group ' +
      "WHERE segments.date BETWEEN '" + fromStr + "' AND '" + toStr + "' " +
      'AND metrics.cost_micros > 0';
    var rows = AdsApp.search(query);
    while (rows.hasNext()) {
      var r = rows.next();
      records.push({
        campaign_id:   String(r.campaign.id),
        campaign_name: r.campaign.name,
        customer_id:   customerId,
        mcc_id:        mccId,
        mcc_name:      mccName,
        date:          r.segments.date,
        device:        mapDevice(r.segments.device),
        ad_group_id:   String(r.adGroup.id),
        spend:         Number(r.metrics.costMicros) / 1e6
      });
      if (records.length >= 5000) flush(); // giải phóng bộ nhớ định kỳ
    }
    try { scanCampaignMetrics(); } catch (e) { Logger.log('campaign_metrics lỗi: ' + e); } // Tối Ưu Camp — không chặn spend nếu lỗi
  }`
}

// Keyword + search term (Tối Ưu Camp P2). CHỈ dùng ở script Hàng ngày (không
// backfill nhiều năm — dữ liệu search term rất lớn, dễ timeout). Dùng lại
// fromStr/toStr/SECRET/WEBHOOK/BATCH của script gọi nó.
function gaqlKwStFn() {
  return `  var kwRecords = [];
  var stRecords = [];

  function flushKw() {
    for (var i = 0; i < kwRecords.length; i += BATCH) {
      UrlFetchApp.fetch(WEBHOOK, { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ secret: SECRET, type: 'keyword_metrics', records: kwRecords.slice(i, i + BATCH) }) });
    }
    kwRecords = [];
  }
  function flushSt() {
    for (var i = 0; i < stRecords.length; i += BATCH) {
      UrlFetchApp.fetch(WEBHOOK, { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ secret: SECRET, type: 'search_terms', records: stRecords.slice(i, i + BATCH) }) });
    }
    stRecords = [];
  }

  function scanKwSt() {
    try {
      var kq =
        'SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ' +
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
        'ad_group_criterion.quality_info.quality_score, ' +
        'segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
        'FROM keyword_view ' +
        "WHERE segments.date BETWEEN '" + fromStr + "' AND '" + toStr + "' " +
        'AND metrics.impressions > 0';
      var kr = AdsApp.search(kq);
      while (kr.hasNext()) {
        var r = kr.next();
        var c = r.adGroupCriterion || {};
        var kw = c.keyword || {};
        var qi = c.qualityInfo || {};
        var m = r.metrics || {};
        kwRecords.push({
          campaign_id:   String(r.campaign.id),
          ad_group_id:   String(r.adGroup.id),
          criterion_id:  String(c.criterionId),
          date:          r.segments.date,
          keyword_text:  kw.text || '',
          match_type:    kw.matchType || '',
          impressions:   Number(m.impressions || 0),
          clicks:        Number(m.clicks || 0),
          cost:          Number(m.costMicros || 0) / 1e6,
          conversions:   m.conversions == null ? null : Number(m.conversions),
          quality_score: qi.qualityScore == null ? null : Number(qi.qualityScore)
        });
        if (kwRecords.length >= BATCH) flushKw();
      }
      flushKw();
    } catch (e) { Logger.log('keyword_metrics lỗi: ' + e); }

    try {
      var sq =
        'SELECT campaign.id, ad_group.id, search_term_view.search_term, ' +
        'segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
        'FROM search_term_view ' +
        "WHERE segments.date BETWEEN '" + fromStr + "' AND '" + toStr + "' " +
        'AND metrics.impressions > 0';
      var sr = AdsApp.search(sq);
      while (sr.hasNext()) {
        var r2 = sr.next();
        var m2 = r2.metrics || {};
        stRecords.push({
          campaign_id:  String(r2.campaign.id),
          ad_group_id:  String(r2.adGroup.id),
          search_term:  r2.searchTermView.searchTerm,
          date:         r2.segments.date,
          impressions:  Number(m2.impressions || 0),
          clicks:       Number(m2.clicks || 0),
          cost:         Number(m2.costMicros || 0) / 1e6,
          conversions:  m2.conversions == null ? null : Number(m2.conversions)
        });
        if (stRecords.length >= BATCH) flushSt();
      }
      flushSt();
    } catch (e) { Logger.log('search_terms lỗi: ' + e); }
  }`
}

// Phân khúc device/giờ/geo (Tối Ưu Camp P3). CHỈ dùng ở script Hàng ngày. Dùng
// lại mapDevice() từ gaqlScanFn (cùng inline vào main) + fromStr/toStr/SECRET/...
function gaqlSegFn() {
  return `  var segRecords = [];

  function flushSeg() {
    for (var i = 0; i < segRecords.length; i += BATCH) {
      UrlFetchApp.fetch(WEBHOOK, { method: 'post', contentType: 'application/json',
        payload: JSON.stringify({ secret: SECRET, type: 'segment_metrics', records: segRecords.slice(i, i + BATCH) }) });
    }
    segRecords = [];
  }
  function pushSeg(campId, date, stype, sval, m) {
    segRecords.push({
      campaign_id: String(campId), date: date, segment_type: stype, segment_value: String(sval),
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      cost: Number(m.costMicros || 0) / 1e6, conversions: m.conversions == null ? null : Number(m.conversions)
    });
    if (segRecords.length >= BATCH) flushSeg();
  }
  function scanSegments() {
    var base = "WHERE segments.date BETWEEN '" + fromStr + "' AND '" + toStr + "' AND metrics.impressions > 0";
    var metricCols = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';
    // Thiết bị
    try {
      var dr = AdsApp.search('SELECT campaign.id, segments.date, segments.device, ' + metricCols + ' FROM campaign ' + base);
      while (dr.hasNext()) { var r = dr.next(); pushSeg(r.campaign.id, r.segments.date, 'device', mapDevice(r.segments.device), r.metrics || {}); }
    } catch (e) { Logger.log('segment device lỗi: ' + e); }
    // Khung giờ (0-23)
    try {
      var hr = AdsApp.search('SELECT campaign.id, segments.date, segments.hour, ' + metricCols + ' FROM campaign ' + base);
      while (hr.hasNext()) { var r2 = hr.next(); pushSeg(r2.campaign.id, r2.segments.date, 'hour', r2.segments.hour, r2.metrics || {}); }
    } catch (e) { Logger.log('segment hour lỗi: ' + e); }
    // Vị trí (country criterion id)
    try {
      var gr = AdsApp.search('SELECT campaign.id, segments.date, geographic_view.country_criterion_id, ' + metricCols + ' FROM geographic_view ' + base);
      while (gr.hasNext()) { var r3 = gr.next(); pushSeg(r3.campaign.id, r3.segments.date, 'geo', r3.geographicView.countryCriterionId, r3.metrics || {}); }
    } catch (e) { Logger.log('segment geo lỗi: ' + e); }
    flushSeg();
  }`
}

function buildBackfillScript(secret: string, webhookUrl: string) {
  return `function main() {
  var SECRET     = '${secret}';
  var WEBHOOK    = '${webhookUrl}';
  var START_DATE = '2020-01-01'; // đã set sẵn phủ toàn bộ lịch sử; rút gần lại nếu bị timeout
  var BATCH      = 1000;

  var mccName = AdsApp.currentAccount().getName();
  var mccId   = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
  var tz = AdsApp.currentAccount().getTimeZone();

  var end = new Date();
  end.setDate(end.getDate() - 1); // đến hôm qua
  var fromStr = START_DATE;
  var toStr   = Utilities.formatDate(end, tz, 'yyyy-MM-dd');

  var records = [];
  var sent = 0;

${gaqlScanFn()}

  if (typeof MccApp !== 'undefined') {
    var accountIt = MccApp.accounts().get();
    while (accountIt.hasNext()) {
      var account = accountIt.next();
      MccApp.select(account);
      scanAccount(account.getCustomerId().replace(/-/g, ''));
      flush(); // gửi & giải phóng sau mỗi tài khoản
    }
  } else {
    mccId = null;
    mccName = null;
    scanAccount(AdsApp.currentAccount().getCustomerId().replace(/-/g, ''));
    flush();
  }

  Logger.log('Backfill done: ' + sent + ' records sent (' + fromStr + ' → ' + toStr + ')');
}`
}

function buildSpendScript(secret: string, webhookUrl: string) {
  return `function main() {
  var SECRET    = '${secret}';
  var WEBHOOK   = '${webhookUrl}';
  var DAYS_BACK = 3;    // đồng bộ 3 ngày gần nhất để cập nhật chi phí chốt muộn
  var BATCH     = 1000;

  var mccName = AdsApp.currentAccount().getName();
  var mccId   = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
  var tz = AdsApp.currentAccount().getTimeZone();

  var to   = new Date();
  var from = new Date();
  from.setDate(from.getDate() - (DAYS_BACK - 1));
  var fromStr = Utilities.formatDate(from, tz, 'yyyy-MM-dd');
  var toStr   = Utilities.formatDate(to,   tz, 'yyyy-MM-dd');

  var records = [];
  var sent = 0;

${gaqlScanFn()}

${gaqlKwStFn()}

${gaqlSegFn()}

  if (typeof MccApp !== 'undefined') {
    var accountIt = MccApp.accounts().get();
    while (accountIt.hasNext()) {
      var account = accountIt.next();
      MccApp.select(account);
      scanAccount(account.getCustomerId().replace(/-/g, ''));
      flush(); // gửi & giải phóng sau mỗi tài khoản
      scanKwSt();     // keyword + search term (Tối Ưu Camp P2)
      scanSegments(); // device/giờ/geo (Tối Ưu Camp P3)
    }
  } else {
    mccId = null;
    mccName = null;
    scanAccount(AdsApp.currentAccount().getCustomerId().replace(/-/g, ''));
    flush();
    scanKwSt();
    scanSegments();
  }

  Logger.log('Spend sync done: ' + sent + ' records (' + fromStr + ' → ' + toStr + ')');
}`
}

function CampaignProjectSelect({ campaignId, currentProjectId, projects, inProgress, onSelect }: {
  campaignId: string
  currentProjectId: string | null
  projects: import('@/lib/types').Project[]
  inProgress: boolean
  onSelect: (campaignId: string, projectId: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) || p.project_id.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [projects, search])

  const selected = projects.find(p => p.project_id === currentProjectId)

  return (
    <div ref={ref} className="relative">
      <input
        className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-slate-300 w-[200px]"
        placeholder="Tìm dự án..."
        value={open ? search : (selected?.name ?? '')}
        onFocus={() => { setOpen(true); setSearch('') }}
        onChange={e => setSearch(e.target.value)}
        disabled={inProgress}
      />
      {open && (
        <div className="absolute z-50 right-0 mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          <button type="button"
            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-400 italic"
            onMouseDown={() => { onSelect(campaignId, null); setOpen(false) }}>
            — Chọn dự án —
          </button>
          {filtered.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">Không tìm thấy</div>
            : filtered.map(p => (
              <button key={p.project_id} type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 text-slate-700"
                onMouseDown={() => { onSelect(campaignId, p.project_id); setOpen(false) }}>
                {p.name}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  const { role, organizationId } = useAuth()
  const router = useRouter()
  const { projects } = useProjectsContext()
  const [secret, setSecret] = useState('')
  const [secretPreview, setSecretPreview] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [pingStatus, setPingStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [campaigns, setCampaigns] = useState<CampaignDiscovery[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [mappingInProgress, setMappingInProgress] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'unmapped' | 'mapped'>('unmapped')
  const [campaignSearch, setCampaignSearch] = useState('')
  const [syncPage, setSyncPage] = useState(0)
  const [hasMoreSync, setHasMoreSync] = useState(false)
  const [backfillStatus, setBackfillStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const [step1Open, setStep1Open] = useState(false)
  const [step2Open, setStep2Open] = useState(false)
  const [scriptTab, setScriptTab] = useState<'discover' | 'spend' | 'backfill'>('spend')

  // ── Telegram config ──
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [tgSaving, setTgSaving] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)
  const [tgMsg, setTgMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/sync/ads-script`
    : '/api/sync/ads-script'

  async function authFetch(url: string, options?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...options,
      headers: { ...options?.headers, Authorization: `Bearer ${session?.access_token ?? ''}` },
    })
  }

  useEffect(() => {
    if (role && role !== 'super_admin') router.replace('/dashboard')
  }, [role, router])

  useEffect(() => {
    if (role !== 'super_admin') return
    authFetch('/api/integrations/secret')
      .then(r => r.json())
      .then(d => { setSecret(d.full ?? ''); setSecretPreview(d.preview ?? '') })
  }, [role])

  const loadLog = useCallback(async (page = 0, append = false) => {
    setLogLoading(true)
    const res = await authFetch(`/api/integrations/sync-log?page=${page}`)
    const data = await res.json()
    const entries = Array.isArray(data) ? data : []
    setSyncLog(prev => append ? [...prev, ...entries] : entries)
    setHasMoreSync(entries.length === 10)
    setLogLoading(false)
  }, [])

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    const res = await authFetch('/api/integrations/campaigns')
    const data = await res.json()
    setCampaigns(Array.isArray(data) ? data : [])
    setCampaignsLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadLog(); loadCampaigns() }, [loadLog, loadCampaigns])

  useEffect(() => {
    if (role !== 'super_admin') return
    authFetch('/api/admin/telegram-config').then(r => r.json()).then(d => {
      setTgToken(d.telegram_bot_token ?? '')
      setTgChatId(d.telegram_chat_id ?? '')
    }).catch(() => {})
  }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTgSave() {
    setTgSaving(true); setTgMsg(null)
    const res = await authFetch('/api/admin/telegram-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_bot_token: tgToken, telegram_chat_id: tgChatId }),
    })
    setTgSaving(false)
    setTgMsg(res.ok ? { ok: true, text: 'Đã lưu cấu hình' } : { ok: false, text: 'Lưu thất bại' })
    setTimeout(() => setTgMsg(null), 3000)
  }

  async function handleTgTest() {
    setTgTesting(true); setTgMsg(null)
    const res = await authFetch('/api/admin/telegram-config', { method: 'PUT' })
    setTgTesting(false)
    const body = await res.json()
    setTgMsg(res.ok ? { ok: true, text: 'Gửi test thành công!' } : { ok: false, text: body.error ?? 'Thất bại' })
    setTimeout(() => setTgMsg(null), 4000)
  }

  async function handlePing() {
    setPingStatus('loading')
    try {
      const res = await fetch('/api/sync/ads-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, records: [] }),
      })
      setPingStatus(res.ok ? 'ok' : 'error')
    } catch {
      setPingStatus('error')
    }
    setTimeout(() => setPingStatus('idle'), 3000)
  }

  async function handleBackfillCid() {
    setBackfillStatus('loading')
    await authFetch('/api/integrations/campaigns', { method: 'POST' })
    setBackfillStatus('done')
    setTimeout(() => setBackfillStatus('idle'), 3000)
  }

  // assign=true gán thêm 1 dự án vào campaign; assign=false gỡ đúng dự án đó.
  async function handleMapping(campaignId: string, projectId: string | null, assign = true) {
    setMappingInProgress(prev => new Set(prev).add(campaignId))
    try {
      const res = await authFetch('/api/integrations/campaigns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, project_id: projectId, assign }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ? `Gán thất bại: ${body.error}` : 'Gán thất bại')
        return
      }
      await loadCampaigns()
    } finally {
      setMappingInProgress(prev => { const next = new Set(prev); next.delete(campaignId); return next })
    }
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const unmapped = campaigns.filter(c => !c.projects?.length)
  const mapped = campaigns.filter(c => c.projects?.length)
  const displayList = activeTab === 'unmapped' ? unmapped : mapped

  const filteredList = useMemo(() => {
    if (!campaignSearch.trim()) return displayList
    const q = campaignSearch.toLowerCase()
    return displayList.filter(c =>
      c.campaign_name.toLowerCase().includes(q) || c.campaign_id.includes(q)
    )
  }, [displayList, campaignSearch])

  if (role !== 'super_admin') return null

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <Zap size={18} className="text-amber-500" />
          <h2 className="text-xl font-semibold text-slate-800">Tích hợp Google Ads Scripts</h2>
        </div>
        <p className="text-sm text-slate-500">Đồng bộ chi phí tự động mỗi ngày từ tất cả MCC — không cần API key</p>
      </div>

      {/* Step 1 */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setStep1Open(v => !v)}
          className={`w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-left hover:bg-slate-100 transition-colors ${step1Open ? 'border-b border-slate-200' : ''}`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 1 — Thông tin kết nối</p>
            {!step1Open && (
              <p className="text-xs text-slate-400 mt-0.5 font-mono truncate">{webhookUrl}</p>
            )}
          </div>
          <ChevronDown size={15} className={`text-slate-400 transition-transform ml-3 shrink-0 ${step1Open ? '' : '-rotate-90'}`} />
        </button>
        {step1Open && (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Webhook URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 font-mono truncate">{webhookUrl}</code>
                <CopyButton text={webhookUrl} label="Copy URL" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Secret Token</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 font-mono">
                  {showSecret ? secret : secretPreview}
                </code>
                <button onClick={() => setShowSecret(v => !v)}
                  className="p-2 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors">
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <CopyButton text={secret} label="Copy" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Step 2 */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setStep2Open(v => !v)}
          className={`w-full bg-slate-50 px-4 py-3 flex items-center justify-between text-left hover:bg-slate-100 transition-colors ${step2Open ? 'border-b border-slate-200' : ''}`}
        >
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 2 — Script Google Ads MCC</p>
            {!step2Open && (
              <p className="text-xs text-slate-400 mt-0.5">3 scripts · Click để xem và copy</p>
            )}
          </div>
          <ChevronDown size={15} className={`text-slate-400 transition-transform ml-3 shrink-0 ${step2Open ? '' : '-rotate-90'}`} />
        </button>
        {step2Open && (
          <div className="p-4 space-y-4">
            {/* Script tabs */}
            <div className="flex gap-1 bg-slate-100 p-0.5 rounded-md w-fit">
              {([
                { key: 'discover' as const, label: 'Quét chiến dịch', sub: 'Chạy 1 lần' },
                { key: 'spend'    as const, label: 'Hàng ngày',       sub: 'Cài lịch Daily' },
                { key: 'backfill' as const, label: 'Lịch sử',         sub: 'Chạy 1 lần' },
              ]).map(t => (
                <button
                  key={t.key}
                  onClick={() => setScriptTab(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${scriptTab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {t.label}
                  <span className="ml-1 text-[10px] text-slate-400">{t.sub}</span>
                </button>
              ))}
            </div>

            {scriptTab === 'discover' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-400">Chạy 1 lần để hệ thống nhận danh sách campaign</p>
                  <CopyButton text={buildDiscoverScript(secret, webhookUrl)} label="Copy code" />
                </div>
                <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto overflow-y-auto leading-relaxed font-mono max-h-[400px]">
                  {buildDiscoverScript(secret, webhookUrl)}
                </pre>
              </div>
            )}

            {scriptTab === 'spend' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-slate-400">Đặt lịch: Daily 1:00 AM - 2:00 AM trong Google Ads Scripts. Đồng bộ chi phí + số liệu hiệu suất (CTR/CPC/Impression Share) + keyword/search term + device/giờ/geo cho <strong>Tối Ưu Camp</strong>.</p>
                  <CopyButton text={buildSpendScript(secret, webhookUrl)} label="Copy code" />
                </div>
                <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto overflow-y-auto leading-relaxed font-mono max-h-[400px]">
                  {buildSpendScript(secret, webhookUrl)}
                </pre>
              </div>
            )}

            {scriptTab === 'backfill' && (
              <div className="border border-dashed border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">Đổ toàn bộ dữ liệu (kèm device/ad group + số liệu hiệu suất cho Tối Ưu Camp) từ <code className="bg-slate-100 px-1 rounded">START_DATE</code> (đã set sẵn 2020) đến hôm qua. Chạy 1 lần để tách chi phí lịch sử.</p>
                  <CopyButton text={buildBackfillScript(secret, webhookUrl)} label="Copy code" />
                </div>
                <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto overflow-y-auto leading-relaxed font-mono max-h-[400px]">
                  {buildBackfillScript(secret, webhookUrl)}
                </pre>
              </div>
            )}

            <div className="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-md p-3 space-y-1">
              <p className="font-medium text-amber-800">Cách cài đặt trong Google Ads MCC:</p>
              <p>1. Vào <strong>Tools &amp; Settings → Scripts → + Create</strong></p>
              <p>2. Dán script quét, click <strong>Run</strong> → sau đó dán script hàng ngày</p>
              <p>3. Đặt lịch script hàng ngày: <strong>Daily — 1:00 AM - 2:00 AM</strong> → Save</p>
              <p>4. <strong>Lần đầu:</strong> chạy script lịch sử 1 lần để backfill dữ liệu quá khứ (đã có device/ad group để tách chi phí)</p>
            </div>
          </div>
        )}
      </div>

      {/* Step 3 — Campaign mapping */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 3 — Gán chiến dịch ↔ Dự án</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {campaigns.length} chiến dịch · {unmapped.length} chưa gán
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackfillCid}
              disabled={backfillStatus === 'loading'}
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
              title="Đồng bộ CID từ campaign_discoveries vào projects"
            >
              {backfillStatus === 'loading' ? <Loader2 size={11} className="animate-spin" /> :
               backfillStatus === 'done' ? <CheckCircle size={11} className="text-green-500" /> :
               <RefreshCw size={11} />}
              {backfillStatus === 'done' ? 'Đã đồng bộ' : 'Đồng bộ CID'}
            </button>
            <button onClick={loadCampaigns} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors" title="Làm mới">
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        <div className="p-4">
          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-slate-100 p-0.5 rounded-md w-fit">
            <button
              onClick={() => { setActiveTab('unmapped'); setCampaignSearch('') }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeTab === 'unmapped' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Chưa gán {unmapped.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px]">{unmapped.length}</span>}
            </button>
            <button
              onClick={() => { setActiveTab('mapped'); setCampaignSearch('') }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeTab === 'mapped' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Đã gán {mapped.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full text-[10px]">{mapped.length}</span>}
            </button>
          </div>

          {campaignsLoading ? (
            <div className="py-8 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Đang tải...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              Chưa có chiến dịch nào. Chạy script quét chiến dịch ở Bước 2 để bắt đầu.
            </div>
          ) : displayList.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">
              {activeTab === 'unmapped' ? 'Tất cả chiến dịch đã được gán.' : 'Chưa có chiến dịch nào được gán.'}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm campaign theo tên hoặc ID..."
                  value={campaignSearch}
                  onChange={e => setCampaignSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1">
                {filteredList.length === 0 && (
                  <div className="py-4 text-center text-xs text-slate-400">Không tìm thấy campaign nào.</div>
                )}
                {filteredList.map(c => {
                  const mappedProjects = c.projects ?? []
                  const mappedIds = new Set(mappedProjects.map(p => p.project_id))
                  const busy = mappingInProgress.has(c.campaign_id)
                  return (
                    <div key={c.campaign_id}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-sm ${mappedProjects.length ? 'border-green-100 bg-green-50/50' : 'border-slate-100 bg-white'}`}
                    >
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="font-medium text-slate-800 truncate">{c.campaign_name}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{c.customer_id} · ID: {c.campaign_id}</p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-[240px]">
                        {mappedProjects.length > 0 && (
                          <div className="flex flex-wrap justify-end gap-1">
                            {mappedProjects.map(p => (
                              <span key={p.project_id}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 rounded-md font-medium">
                                {p.project_name}
                                <button
                                  onClick={() => handleMapping(c.campaign_id, p.project_id, false)}
                                  disabled={busy}
                                  className="rounded hover:bg-red-100 text-green-600 hover:text-red-600 transition-colors"
                                  title="Bỏ gán dự án này"
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Luôn cho thêm dự án nữa (nhiều link ref chung 1 campaign) */}
                        <CampaignProjectSelect
                          campaignId={c.campaign_id}
                          currentProjectId={null}
                          projects={projects.filter(p => !mappedIds.has(p.project_id))}
                          inProgress={busy}
                          onSelect={(campaignId, projectId) => { if (projectId) handleMapping(campaignId, projectId, true) }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Telegram Bot Config */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">✈️ Telegram Bot</p>
          <p className="text-xs text-slate-400 mt-0.5">Nhận nhắc nhở qua Telegram khi reminders đến hạn</p>
        </div>
        <div className="p-4 space-y-4">
          {organizationId === null && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-md px-3 py-2">
              ⚠️ Tài khoản Global Admin không có tổ chức. Hãy gán tổ chức trước khi cấu hình Telegram.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Bot Token</label>
              <input
                type="password"
                placeholder="123456:ABC-DEF..."
                value={tgToken}
                onChange={e => setTgToken(e.target.value)}
                className="w-full text-sm font-mono border border-slate-200 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Chat ID</label>
              <input
                type="text"
                placeholder="-100123456789"
                value={tgChatId}
                onChange={e => setTgChatId(e.target.value)}
                className="w-full text-sm font-mono border border-slate-200 rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-slate-300"
              />
              <p className="text-xs text-slate-400 mt-1">Group ID (âm) hoặc User ID. Dùng @userinfobot để lấy ID.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" onClick={handleTgSave} disabled={tgSaving}>
              {tgSaving ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Lưu cấu hình
            </Button>
            <Button size="sm" variant="outline" onClick={handleTgTest} disabled={tgTesting || !tgToken || !tgChatId}>
              {tgTesting ? <Loader2 size={13} className="animate-spin mr-1" /> : null}
              Gửi test
            </Button>
            {tgMsg && (
              <span className={`text-sm font-medium ${tgMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                {tgMsg.ok ? '✅' : '❌'} {tgMsg.text}
              </span>
            )}
          </div>
          <div className="bg-slate-50 rounded-md p-3 text-xs text-slate-500 space-y-1">
            <p className="font-medium text-slate-600">Hướng dẫn nhanh:</p>
            <p>1. Tạo bot qua <strong>@BotFather</strong> → nhận Bot Token</p>
            <p>2. Thêm bot vào group hoặc nhắn tin trực tiếp</p>
            <p>3. Lấy Chat ID qua <strong>@userinfobot</strong></p>
            <p>4. Dán vào đây → Lưu → Gửi test để kiểm tra</p>
          </div>
        </div>
      </div>

      {/* Sync status */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lịch sử đồng bộ</p>
          <button onClick={() => { setSyncPage(0); loadLog(0, false) }} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <Button variant="outline" size="sm" onClick={handlePing} disabled={pingStatus === 'loading'} className="gap-1.5">
            {pingStatus === 'loading' ? <Loader2 size={13} className="animate-spin" /> :
             pingStatus === 'ok' ? <CheckCircle size={13} className="text-green-500" /> :
             pingStatus === 'error' ? <XCircle size={13} className="text-red-500" /> : null}
            Kiểm tra kết nối
            {pingStatus === 'ok' && <span className="text-green-600 font-medium">· Thành công</span>}
            {pingStatus === 'error' && <span className="text-red-600 font-medium">· Thất bại</span>}
          </Button>

          {!logLoading && syncLog.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">Chưa có lịch sử đồng bộ.</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Thời gian</th>
                    <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Records</th>
                    <th className="pb-2 text-xs font-medium text-slate-500 uppercase tracking-wide">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {syncLog.map(entry => (
                    <tr key={entry.id}>
                      <td className="py-2.5 text-slate-600 font-mono text-xs">{formatTime(entry.synced_at)}</td>
                      <td className="py-2.5 text-slate-500">{entry.records > 0 ? entry.records : '—'}</td>
                      <td className="py-2.5">
                        {entry.status === 'success' ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle size={12} /> Thành công</span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600 text-xs font-medium" title={entry.message ?? ''}><XCircle size={12} /> Lỗi: {entry.message}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMoreSync && (
                <button
                  onClick={() => { const next = syncPage + 1; setSyncPage(next); loadLog(next, true) }}
                  disabled={logLoading}
                  className="mt-3 text-xs text-slate-500 hover:text-slate-700 underline disabled:opacity-50">
                  {logLoading ? 'Đang tải...' : 'Tải thêm...'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
