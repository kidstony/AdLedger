-- Đổi nhãn spend "thiết bị khác" (Connected TV / Unknown) từ 'ALL' → 'OTHER'.
-- Trước đây script gộp các device này vào 'ALL', trùng nghĩa với dòng tổng legacy.
-- Các dòng device='ALL' nhưng CÓ ad_group thật (<>'ALL') chính là spend other-device
-- → chuyển sang 'OTHER' để: (1) 'ALL' chỉ còn nghĩa tổng legacy, (2) lần sync sau
--    (script gửi 'OTHER') upsert đúng key, không tạo dòng trùng.
-- Chạy trong Supabase SQL Editor.

UPDATE ad_spend
SET device = 'OTHER'
WHERE device = 'ALL'
  AND ad_group_id <> 'ALL';
