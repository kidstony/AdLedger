-- Dọn dữ liệu ad_spend bị đếm gấp đôi: xoá dòng tổng legacy device='ALL'/ad_group='ALL'
-- CHỈ KHI đã tồn tại dòng chi tiết theo device/ad_group cho cùng (campaign_id, date).
-- An toàn: campaign chỉ có 'ALL' (chưa tách được, vd Performance Max) KHÔNG bị đụng.
-- Chạy trong Supabase SQL Editor.

DELETE FROM ad_spend a
WHERE a.device = 'ALL'
  AND a.ad_group_id = 'ALL'
  AND EXISTS (
    SELECT 1 FROM ad_spend b
    WHERE b.campaign_id = a.campaign_id
      AND b.date = a.date
      AND (b.device <> 'ALL' OR b.ad_group_id <> 'ALL')
  );
