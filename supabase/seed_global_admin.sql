-- Tạo Global Admin (chỉ chạy khi setup hệ thống lần đầu hoặc cần thêm Global Admin)
--
-- Bước 1: Vào Supabase Dashboard → Authentication → Users → Add user
--         Điền email + password, tạo xong copy lại user_id (UUID)
--
-- Bước 2: Điền user_id và full_name bên dưới rồi chạy trong SQL Editor

INSERT INTO user_profiles (user_id, full_name, role, team_id, organization_id)
VALUES (
  'PASTE_USER_ID_HERE',   -- UUID từ Supabase Auth
  'Tên Global Admin',     -- tên hiển thị
  'super_admin',
  NULL,
  NULL                    -- NULL = Global Admin (không thuộc org nào)
)
ON CONFLICT (user_id) DO UPDATE
  SET role = 'super_admin',
      organization_id = NULL;
