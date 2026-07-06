/**
 * Google Ads Script — đồng bộ chi phí QC về P&L Tracker
 * ------------------------------------------------------
 * Gửi chi phí theo granularity: campaign × ngày × device × ad_group
 * để app tách được chi phí cho từng link ref (nhiều ref / 1 CID).
 *
 * CÁCH DÙNG:
 *  1. Google Ads → Tools → Bulk actions → Scripts → + New script.
 *  2. Dán toàn bộ file này vào.
 *  3. Sửa 3 hằng số trong phần CẤU HÌNH bên dưới (ENDPOINT, SECRET, DAYS_BACK).
 *  4. Authorize → Preview để test, rồi Run. Đặt Schedule chạy hằng ngày (vd 6:00).
 *
 * Chạy được ở CẢ tài khoản thường lẫn tài khoản MCC (manager) — tự nhận diện.
 */

// ─────────────────────────── CẤU HÌNH ───────────────────────────
var ENDPOINT  = 'https://YOUR_DOMAIN/api/sync/ads-script'; // đổi thành domain thật của app
var SECRET    = 'YOUR_ADS_SCRIPT_SECRET';                  // = ADS_SCRIPT_SECRET (hoặc organizations.ads_secret)
var DAYS_BACK = 7;    // đồng bộ N ngày gần nhất (backfill để cập nhật chi phí chốt muộn)
var BATCH     = 1000; // số record mỗi request POST
// ─────────────────────────────────────────────────────────────────

function main() {
  // MCC (manager) → lặp qua từng tài khoản con; tài khoản thường → chạy trực tiếp.
  if (typeof AdsManagerApp !== 'undefined') {
    var it = AdsManagerApp.accounts().get();
    while (it.hasNext()) {
      var acc = it.next();
      AdsManagerApp.select(acc);
      try {
        syncAccount();
      } catch (e) {
        Logger.log('LỖI ở account ' + acc.getCustomerId() + ': ' + e);
      }
    }
  } else {
    syncAccount();
  }
}

function syncAccount() {
  var account = AdsApp.currentAccount();
  var cid = account.getCustomerId().replace(/-/g, ''); // '123-456-7890' → '1234567890'
  var range = dateRange(account.getTimeZone(), DAYS_BACK);

  Logger.log('Sync CID ' + cid + ' | ' + range.from + ' → ' + range.to);

  discoverCampaigns(cid);
  syncSpend(cid, range);
}

/**
 * Discovery: đẩy danh sách campaign (kể cả campaign chưa có spend) để app map
 * campaign → cid → project.
 */
function discoverCampaigns(cid) {
  var query =
    'SELECT campaign.id, campaign.name ' +
    'FROM campaign ' +
    "WHERE campaign.status IN ('ENABLED', 'PAUSED')";

  var campaigns = [];
  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    campaigns.push({
      campaign_id:   String(r.campaign.id),
      campaign_name: r.campaign.name,
      customer_id:   cid,
    });
  }
  if (!campaigns.length) return;

  // Discover không giới hạn số lượng nhiều → vẫn chia batch cho an toàn.
  for (var i = 0; i < campaigns.length; i += BATCH) {
    post({ secret: SECRET, type: 'discover', campaigns: campaigns.slice(i, i + BATCH) });
  }
}

/**
 * Spend: chi phí theo campaign × ngày × device × ad_group.
 * Query từ resource ad_group với segments.date + segments.device.
 */
function syncSpend(cid, range) {
  var query =
    'SELECT campaign.id, campaign.name, ad_group.id, ' +
    'segments.date, segments.device, metrics.cost_micros ' +
    'FROM ad_group ' +
    "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' " +
    'AND metrics.cost_micros > 0';

  var records = [];
  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    records.push({
      campaign_id:   String(r.campaign.id),
      campaign_name: r.campaign.name,
      customer_id:   cid,
      date:          r.segments.date,                    // 'yyyy-MM-dd'
      device:        mapDevice(r.segments.device),       // MOBILE | DESKTOP | TABLET | ALL
      ad_group_id:   String(r.adGroup.id),
      spend:         Number(r.metrics.costMicros) / 1e6,  // micros → đơn vị tiền tài khoản
    });

    if (records.length >= BATCH) {
      post({ secret: SECRET, records: records });
      records = [];
    }
  }
  if (records.length) post({ secret: SECRET, records: records });
}

// Map enum device của Google Ads về MOBILE/DESKTOP/TABLET. Còn lại (CONNECTED_TV,
// OTHER, UNKNOWN...) → 'OTHER' (nhãn riêng, tách khỏi 'ALL' legacy).
function mapDevice(device) {
  var d = String(device || '').toUpperCase();
  if (d === 'MOBILE' || d === 'DESKTOP' || d === 'TABLET') return d;
  return 'OTHER'; // Connected TV / Unknown — nhãn riêng, không gộp vào 'ALL' legacy
}

function dateRange(timeZone, daysBack) {
  var to = new Date();
  var from = new Date();
  from.setDate(from.getDate() - (daysBack - 1));
  return {
    from: Utilities.formatDate(from, timeZone, 'yyyy-MM-dd'),
    to:   Utilities.formatDate(to,   timeZone, 'yyyy-MM-dd'),
  };
}

function post(payload) {
  var res = UrlFetchApp.fetch(ENDPOINT, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  Logger.log('POST → ' + code + ' ' + res.getContentText());
  if (code >= 300) {
    throw new Error('Sync thất bại (' + code + '): ' + res.getContentText());
  }
}
