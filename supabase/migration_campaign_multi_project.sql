-- Migration: cho phép NHIỀU dự án chung 1 google_campaign_id
-- (nhiều link ref chạy chung 1 campaign → tách chi phí QC theo device/ad group/thời gian).
-- Chạy trong Supabase SQL Editor.
--
-- Thiết kế cũ 1 campaign ↔ 1 dự án có thể để lại ràng buộc UNIQUE trên
-- projects.google_campaign_id, khiến gán dự án thứ 2 vào cùng campaign bị chặn.
-- Gỡ mọi UNIQUE (constraint hoặc index) đơn cột trên google_campaign_id.

-- 0) Gỡ tường minh constraint đã biết (tên _key = backing index của UNIQUE constraint).
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_google_campaign_id_key;

-- 1) Gỡ UNIQUE CONSTRAINT đơn cột google_campaign_id (nếu có tên khác)
DO $$
DECLARE con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'projects'::regclass
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND a.attname = 'google_campaign_id'
  LOOP
    EXECUTE format('ALTER TABLE projects DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- 2) Gỡ UNIQUE INDEX đơn cột google_campaign_id (nếu tạo dạng index thay vì constraint).
--    Khớp text định nghĩa index: chỉ trúng index đơn cột "(google_campaign_id)".
DO $$
DECLARE idx record;
BEGIN
  FOR idx IN
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'projects'
      AND indexdef ILIKE 'CREATE UNIQUE INDEX%(google_campaign_id)%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx.indexname);
  END LOOP;
END $$;

-- 3) Đảm bảo còn index thường (không unique) để truy vấn theo campaign nhanh.
CREATE INDEX IF NOT EXISTS idx_projects_google_campaign_id
  ON projects (google_campaign_id);
