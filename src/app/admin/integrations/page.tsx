'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Eye, EyeOff, CheckCircle, XCircle, Loader2, RefreshCw, Zap, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProjectsContext } from '@/context/ProjectsContext'
import { CampaignDiscovery } from '@/lib/types'

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
  var accountIt = MccApp.accounts().get();
  while (accountIt.hasNext()) {
    var account = accountIt.next();
    MccApp.select(account);
    var customerId = account.getCustomerId().replace(/-/g, '');
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
  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: SECRET, type: 'discover', campaigns: campaigns })
  });
}`
}

function buildSpendScript(secret: string, webhookUrl: string) {
  return `function main() {
  var SECRET  = '${secret}';
  var WEBHOOK = '${webhookUrl}';

  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var dateStr = Utilities.formatDate(yesterday, 'UTC', 'yyyy-MM-dd');

  var mccName = AdsApp.currentAccount().getName();
  var mccId   = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');

  var records = [];
  var accountIt = MccApp.accounts().get();
  while (accountIt.hasNext()) {
    var account = accountIt.next();
    MccApp.select(account);
    var customerId = account.getCustomerId().replace(/-/g, '');
    var campaignIt = AdsApp.campaigns().get();
    while (campaignIt.hasNext()) {
      var c = campaignIt.next();
      var spend = c.getStatsFor(dateStr, dateStr).getCost();
      if (spend > 0) records.push({
        campaign_id:   c.getId().toString(),
        campaign_name: c.getName(),
        customer_id:   customerId,
        mcc_id:        mccId,
        mcc_name:      mccName,
        date: dateStr, spend: spend
      });
    }
  }
  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: SECRET, type: 'spend', records: records })
  });
}`
}

export default function IntegrationsPage() {
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

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/sync/ads-script`
    : '/api/sync/ads-script'

  useEffect(() => {
    fetch('/api/integrations/secret')
      .then(r => r.json())
      .then(d => { setSecret(d.full ?? ''); setSecretPreview(d.preview ?? '') })
  }, [])

  const loadLog = useCallback(async () => {
    setLogLoading(true)
    const res = await fetch('/api/integrations/sync-log')
    const data = await res.json()
    setSyncLog(Array.isArray(data) ? data : [])
    setLogLoading(false)
  }, [])

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    const res = await fetch('/api/integrations/campaigns')
    const data = await res.json()
    setCampaigns(Array.isArray(data) ? data : [])
    setCampaignsLoading(false)
  }, [])

  useEffect(() => { loadLog(); loadCampaigns() }, [loadLog, loadCampaigns])

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

  async function handleMapping(campaignId: string, projectId: string | null) {
    setMappingInProgress(prev => new Set(prev).add(campaignId))
    await fetch('/api/integrations/campaigns', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaignId, project_id: projectId }),
    })
    await loadCampaigns()
    setMappingInProgress(prev => { const next = new Set(prev); next.delete(campaignId); return next })
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const unmapped = campaigns.filter(c => !c.project_id)
  const mapped = campaigns.filter(c => c.project_id)
  const displayList = activeTab === 'unmapped' ? unmapped : mapped

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
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 1 — Thông tin kết nối</p>
        </div>
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
      </div>

      {/* Step 2 */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 2 — Script Google Ads MCC</p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-slate-700">Script quét chiến dịch</p>
                <p className="text-xs text-slate-400">Chạy 1 lần để hệ thống nhận danh sách campaign</p>
              </div>
              <CopyButton text={buildDiscoverScript(secret, webhookUrl)} label="Copy code" />
            </div>
            <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto leading-relaxed font-mono">
              {buildDiscoverScript(secret, webhookUrl)}
            </pre>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-medium text-slate-700">Script đồng bộ chi phí hàng ngày</p>
                <p className="text-xs text-slate-400">Đặt lịch: Daily 8:00 AM trong Google Ads Scripts</p>
              </div>
              <CopyButton text={buildSpendScript(secret, webhookUrl)} label="Copy code" />
            </div>
            <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto leading-relaxed font-mono">
              {buildSpendScript(secret, webhookUrl)}
            </pre>
          </div>
          <div className="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-md p-3 space-y-1">
            <p className="font-medium text-amber-800">Cách cài đặt trong Google Ads MCC:</p>
            <p>1. Vào <strong>Tools &amp; Settings → Scripts → + Create</strong></p>
            <p>2. Dán script quét, click <strong>Run</strong> → sau đó dán script hàng ngày</p>
            <p>3. Đặt lịch script hàng ngày: <strong>Daily — 8:00 AM</strong> → Save</p>
          </div>
        </div>
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
          <button onClick={loadCampaigns} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors" title="Làm mới">
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="p-4">
          {/* Tabs */}
          <div className="flex gap-1 mb-4 bg-slate-100 p-0.5 rounded-md w-fit">
            <button
              onClick={() => setActiveTab('unmapped')}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeTab === 'unmapped' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Chưa gán {unmapped.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-[10px]">{unmapped.length}</span>}
            </button>
            <button
              onClick={() => setActiveTab('mapped')}
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
              {displayList.map(c => (
                <div key={c.campaign_id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm ${c.project_id ? 'border-green-100 bg-green-50/50' : 'border-slate-100 bg-white'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{c.campaign_name}</p>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">{c.customer_id} · ID: {c.campaign_id}</p>
                  </div>

                  {c.project_id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-md font-medium">{c.project_name}</span>
                      <button
                        onClick={() => handleMapping(c.campaign_id, null)}
                        disabled={mappingInProgress.has(c.campaign_id)}
                        className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                        title="Bỏ gán"
                      >
                        {mappingInProgress.has(c.campaign_id) ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      </button>
                    </div>
                  ) : (
                    <div className="shrink-0">
                      {mappingInProgress.has(c.campaign_id) ? (
                        <Loader2 size={14} className="animate-spin text-slate-400" />
                      ) : (
                        <select
                          defaultValue=""
                          onChange={e => e.target.value && handleMapping(c.campaign_id, e.target.value)}
                          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 outline-none focus:ring-2 focus:ring-slate-300 max-w-[200px]"
                        >
                          <option value="">— Chọn dự án —</option>
                          {projects.map(p => (
                            <option key={p.project_id} value={p.project_id}>
                              {p.name} ({p.project_id})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sync status */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lịch sử đồng bộ</p>
          <button onClick={loadLog} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors">
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

          {logLoading ? (
            <div className="py-4 text-center text-sm text-slate-400">Đang tải...</div>
          ) : syncLog.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-400">Chưa có lịch sử đồng bộ.</div>
          ) : (
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
                        <span className="flex items-center gap-1 text-red-600 text-xs font-medium" title={entry.message ?? ''}><XCircle size={12} /> Lỗi</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
