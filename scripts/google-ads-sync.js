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
  syncSpend(cid, range); // P&L (spend) — cốt lõi, không bọc để lỗi nổi rõ

  // Các phần Tối Ưu Camp: bọc riêng để một truy vấn lỗi KHÔNG chặn spend/P&L,
  // và log rõ phần nào lỗi (xem Logs của Google Ads Script).
  try { syncCampaignMetrics(cid, range); } catch (e) { Logger.log('campaign_metrics lỗi: ' + e); }
  try { syncKeywords(cid, range); }        catch (e) { Logger.log('keyword_metrics lỗi: ' + e); }
  try { syncSearchTerms(cid, range); }     catch (e) { Logger.log('search_terms lỗi: ' + e); }
  try { syncSegments(cid, range); }        catch (e) { Logger.log('segment_metrics lỗi: ' + e); }
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

/**
 * Campaign metrics: số liệu hiệu suất cấp campaign × ngày cho tính năng "Tối Ưu
 * Camp" (impressions, clicks, cost, conversions, Search Impression Share...).
 * Tách riêng khỏi syncSpend — KHÔNG ảnh hưởng P&L.
 */
function syncCampaignMetrics(cid, range) {
  var query =
    'SELECT campaign.id, segments.date, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, ' +
    'metrics.search_impression_share, ' +
    'metrics.search_budget_lost_impression_share, ' +
    'metrics.search_rank_lost_impression_share ' +
    'FROM campaign ' +
    "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' " +
    'AND metrics.impressions > 0';

  var records = [];
  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    var m = r.metrics || {};
    records.push({
      campaign_id:             String(r.campaign.id),
      date:                    r.segments.date,
      impressions:             Number(m.impressions || 0),
      clicks:                  Number(m.clicks || 0),
      cost:                    Number(m.costMicros || 0) / 1e6,
      conversions:             m.conversions == null ? null : Number(m.conversions),
      conversions_value:       m.conversionsValue == null ? null : Number(m.conversionsValue),
      // IS metrics là tỉ lệ 0..1; Google trả null nếu không đủ dữ liệu.
      search_impression_share: m.searchImpressionShare == null ? null : Number(m.searchImpressionShare),
      search_budget_lost_is:   m.searchBudgetLostImpressionShare == null ? null : Number(m.searchBudgetLostImpressionShare),
      search_rank_lost_is:     m.searchRankLostImpressionShare == null ? null : Number(m.searchRankLostImpressionShare),
    });
    if (records.length >= BATCH) {
      post({ secret: SECRET, type: 'campaign_metrics', records: records });
      records = [];
    }
  }
  if (records.length) post({ secret: SECRET, type: 'campaign_metrics', records: records });
}

/**
 * Keyword metrics (Tối Ưu Camp P2): keyword × ngày (impressions/clicks/cost/
 * quality_score) để gợi ý tắt keyword kém hiệu suất.
 */
function syncKeywords(cid, range) {
  var query =
    'SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ' +
    'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
    'ad_group_criterion.quality_info.quality_score, ' +
    'segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM keyword_view ' +
    "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' " +
    'AND metrics.impressions > 0';

  var records = [];
  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    var c = r.adGroupCriterion || {};
    var kw = c.keyword || {};
    var qi = c.qualityInfo || {};
    var m = r.metrics || {};
    records.push({
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
    if (records.length >= BATCH) {
      post({ secret: SECRET, type: 'keyword_metrics', records: records });
      records = [];
    }
  }
  if (records.length) post({ secret: SECRET, type: 'keyword_metrics', records: records });
}

/**
 * Search term metrics (Tối Ưu Camp P2): truy vấn thật × ngày → gợi ý negative keyword.
 */
function syncSearchTerms(cid, range) {
  var query =
    'SELECT campaign.id, ad_group.id, search_term_view.search_term, ' +
    'segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions ' +
    'FROM search_term_view ' +
    "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' " +
    'AND metrics.impressions > 0';

  var records = [];
  var rows = AdsApp.search(query);
  while (rows.hasNext()) {
    var r = rows.next();
    var m = r.metrics || {};
    records.push({
      campaign_id:  String(r.campaign.id),
      ad_group_id:  String(r.adGroup.id),
      search_term:  r.searchTermView.searchTerm,
      date:         r.segments.date,
      impressions:  Number(m.impressions || 0),
      clicks:       Number(m.clicks || 0),
      cost:         Number(m.costMicros || 0) / 1e6,
      conversions:  m.conversions == null ? null : Number(m.conversions)
    });
    if (records.length >= BATCH) {
      post({ secret: SECRET, type: 'search_terms', records: records });
      records = [];
    }
  }
  if (records.length) post({ secret: SECRET, type: 'search_terms', records: records });
}

/**
 * Segment metrics (Tối Ưu Camp P3): phân khúc device/giờ/geo × ngày để gợi ý
 * bid adjustment & dayparting.
 */
function syncSegments(cid, range) {
  var base = "WHERE segments.date BETWEEN '" + range.from + "' AND '" + range.to + "' AND metrics.impressions > 0";
  var cols = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions';
  var records = [];

  function push(campId, date, stype, sval, m) {
    records.push({
      campaign_id: String(campId), date: date, segment_type: stype, segment_value: String(sval),
      impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0),
      cost: Number(m.costMicros || 0) / 1e6, conversions: m.conversions == null ? null : Number(m.conversions)
    });
    if (records.length >= BATCH) { post({ secret: SECRET, type: 'segment_metrics', records: records }); records = []; }
  }

  var dr = AdsApp.search('SELECT campaign.id, segments.date, segments.device, ' + cols + ' FROM campaign ' + base);
  while (dr.hasNext()) { var r = dr.next(); push(r.campaign.id, r.segments.date, 'device', mapDevice(r.segments.device), r.metrics || {}); }

  var hr = AdsApp.search('SELECT campaign.id, segments.date, segments.hour, ' + cols + ' FROM campaign ' + base);
  while (hr.hasNext()) { var r2 = hr.next(); push(r2.campaign.id, r2.segments.date, 'hour', r2.segments.hour, r2.metrics || {}); }

  var gr = AdsApp.search('SELECT campaign.id, segments.date, geographic_view.country_criterion_id, ' + cols + ' FROM geographic_view ' + base);
  while (gr.hasNext()) { var r3 = gr.next(); push(r3.campaign.id, r3.segments.date, 'geo', r3.geographicView.countryCriterionId, r3.metrics || {}); }

  if (records.length) post({ secret: SECRET, type: 'segment_metrics', records: records });
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
