'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Eye, EyeOff, CheckCircle, XCircle, Loader2, RefreshCw, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
    >
      <Copy size={12} />
      {copied ? 'Đã copy!' : label}
    </button>
  )
}

function buildScript(secret: string, webhookUrl: string) {
  return `function main() {
  var SECRET  = '${secret}';
  var WEBHOOK = '${webhookUrl}';

  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var dateStr = Utilities.formatDate(yesterday, 'UTC', 'yyyy-MM-dd');

  var records = [];
  var accountIt = MccApp.accounts().get();

  while (accountIt.hasNext()) {
    var account = accountIt.next();
    MccApp.select(account);
    var cid   = account.getCustomerId().replace(/-/g, '');
    var stats = account.getStatsFor(dateStr, dateStr);
    var spend = stats.getCost();
    if (spend > 0) records.push({ cid: cid, date: dateStr, spend: spend });
  }

  UrlFetchApp.fetch(WEBHOOK, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ secret: SECRET, records: records })
  });
}`
}

export default function IntegrationsPage() {
  const [secret, setSecret] = useState('')
  const [secretPreview, setSecretPreview] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [pingStatus, setPingStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [syncNowStatus, setSyncNowStatus] = useState<'idle' | 'loading'>('idle')

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

  useEffect(() => { loadLog() }, [loadLog])

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

  async function handleSyncNow() {
    setSyncNowStatus('loading')
    const today = new Date().toISOString().slice(0, 10)
    await fetch('/api/sync/ads-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, records: [{ cid: 'test', date: today, spend: 0 }] }),
    })
    await loadLog()
    setSyncNowStatus('idle')
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const script = buildScript(secret, webhookUrl)

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
              <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 font-mono truncate">
                {webhookUrl}
              </code>
              <CopyButton text={webhookUrl} label="Copy URL" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Secret Token</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-slate-700 font-mono">
                {showSecret ? secret : secretPreview}
              </code>
              <button
                onClick={() => setShowSecret(v => !v)}
                className="p-2 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-500 transition-colors"
                title={showSecret ? 'Ẩn' : 'Hiện'}
              >
                {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <CopyButton text={secret} label="Copy" />
            </div>
            <p className="text-xs text-slate-400 mt-1">Token này đã được điền sẵn vào script bên dưới.</p>
          </div>
        </div>
      </div>

      {/* Step 2 */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bước 2 — Dán script vào Google Ads MCC</p>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-slate-600 space-y-1">
            <p>1. Vào <strong>Google Ads MCC</strong> → <strong>Tools & Settings</strong> → <strong>Scripts</strong></p>
            <p>2. Click <strong>+ Create script</strong>, dán đoạn code bên dưới</p>
            <p>3. Click <strong>Authorize</strong> → đặt lịch <strong>Daily — 8:00 AM</strong> → <strong>Save</strong></p>
          </div>
          <div className="relative">
            <pre className="text-xs bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto leading-relaxed font-mono">
              {script}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={script} label="Copy code" />
            </div>
          </div>
        </div>
      </div>

      {/* Step 3 — Status */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Trạng thái đồng bộ</p>
          <button onClick={loadLog} className="p-1 rounded hover:bg-slate-200 text-slate-400 transition-colors">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePing}
              disabled={pingStatus === 'loading'}
              className="gap-1.5"
            >
              {pingStatus === 'loading' ? <Loader2 size={13} className="animate-spin" /> :
               pingStatus === 'ok' ? <CheckCircle size={13} className="text-green-500" /> :
               pingStatus === 'error' ? <XCircle size={13} className="text-red-500" /> :
               null}
              Kiểm tra kết nối
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncNow}
              disabled={syncNowStatus === 'loading'}
              className="gap-1.5"
            >
              {syncNowStatus === 'loading' && <Loader2 size={13} className="animate-spin" />}
              Ghi log test
            </Button>
            {pingStatus === 'ok' && <span className="text-xs text-green-600 font-medium">Kết nối thành công</span>}
            {pingStatus === 'error' && <span className="text-xs text-red-600 font-medium">Kết nối thất bại</span>}
          </div>

          {logLoading ? (
            <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
          ) : syncLog.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">
              Chưa có lịch sử đồng bộ. Chạy script Google Ads để bắt đầu.
            </div>
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
                        <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                          <CheckCircle size={12} /> Thành công
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-600 text-xs font-medium" title={entry.message ?? ''}>
                          <XCircle size={12} /> Lỗi
                        </span>
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
