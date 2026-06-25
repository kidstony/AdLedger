-- =====================================================
-- Migration: Project Sharing với granular permissions
-- Chạy trong Supabase SQL Editor theo từng BLOCK
-- =====================================================

-- ─────────────────────────────────────────
-- BLOCK 1: Enum + bảng project_shares
-- ─────────────────────────────────────────
CREATE TYPE share_access_level AS ENUM ('viewer', 'reporter', 'editor');

CREATE TABLE project_shares (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_by    uuid REFERENCES auth.users(id),
  access_level share_access_level NOT NULL DEFAULT 'viewer',
  created_at   timestamptz DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- ─────────────────────────────────────────
-- BLOCK 2: Bảng project_share_permissions
-- ─────────────────────────────────────────
CREATE TABLE project_share_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id      uuid NOT NULL REFERENCES project_shares(id) ON DELETE CASCADE,
  permission_id text NOT NULL CHECK (permission_id IN (
    'view_revenue', 'view_profit', 'view_adspend',
    'input_revenue', 'input_expense', 'confirm_payment'
  )),
  granted       boolean NOT NULL,
  UNIQUE (share_id, permission_id)
);

-- ─────────────────────────────────────────
-- BLOCK 3: Migrate dữ liệu từ project_members
-- (Chạy SAU BLOCK 1 để bảng đã tồn tại)
-- ─────────────────────────────────────────
INSERT INTO project_shares (project_id, user_id, access_level, shared_by)
SELECT project_id, user_id, 'editor', NULL
FROM project_members
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ─────────────────────────────────────────
-- BLOCK 4: RLS cho project_shares
-- ─────────────────────────────────────────
ALTER TABLE project_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa_shares" ON project_shares FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_shares" ON project_shares FOR ALL
  USING (
    get_user_role() = 'manager' AND
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.project_id = project_shares.project_id
        AND p.team_id = get_user_team_id()
    )
  );

CREATE POLICY "member_view_own_shares" ON project_shares FOR SELECT
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────
-- BLOCK 5: RLS cho project_share_permissions
-- ─────────────────────────────────────────
ALTER TABLE project_share_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa_share_perms" ON project_share_permissions FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_share_perms" ON project_share_permissions FOR ALL
  USING (
    get_user_role() = 'manager' AND
    EXISTS (
      SELECT 1 FROM project_shares ps
      JOIN projects p ON p.project_id = ps.project_id
      WHERE ps.id = project_share_permissions.share_id
        AND p.team_id = get_user_team_id()
    )
  );

CREATE POLICY "member_view_own_perms" ON project_share_permissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM project_shares ps
      WHERE ps.id = share_id AND ps.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 6: Cập nhật RLS projects — thêm policy cho shared users
-- (Không xóa policy member_select_projects cũ vì đang dùng project_members)
-- ─────────────────────────────────────────
CREATE POLICY "shared_select_projects" ON projects FOR SELECT
  USING (
    get_user_role() = 'member' AND
    EXISTS (
      SELECT 1 FROM project_shares
      WHERE project_id = projects.project_id AND user_id = auth.uid()
    )
  );

-- Sau khi xác nhận project_shares hoạt động, chạy lệnh sau để bỏ policy cũ:
-- DROP POLICY IF EXISTS "member_select_projects" ON projects;

-- ─────────────────────────────────────────
-- BLOCK 7: SQL Function check_project_permission
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_project_permission(
  p_user_id    uuid,
  p_project_id text,
  p_permission text
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER STABLE AS
$$
DECLARE
  v_role       text;
  v_share_id   uuid;
  v_access     share_access_level;
  v_granted    boolean;
BEGIN
  -- Lấy role của user
  SELECT role INTO v_role
  FROM user_profiles WHERE user_id = p_user_id;

  -- Super admin: luôn true
  IF v_role = 'super_admin' THEN RETURN true; END IF;

  -- Manager của team sở hữu dự án: true
  IF v_role = 'manager' AND EXISTS (
    SELECT 1 FROM projects p
    JOIN user_profiles up ON up.team_id = p.team_id
    WHERE p.project_id = p_project_id AND up.user_id = p_user_id
  ) THEN RETURN true; END IF;

  -- Tìm share record
  SELECT id, access_level INTO v_share_id, v_access
  FROM project_shares
  WHERE project_id = p_project_id AND user_id = p_user_id;

  IF v_share_id IS NULL THEN RETURN false; END IF;

  -- Kiểm tra override riêng
  SELECT granted INTO v_granted
  FROM project_share_permissions
  WHERE share_id = v_share_id AND permission_id = p_permission;

  IF v_granted IS NOT NULL THEN RETURN v_granted; END IF;

  -- Default theo access_level
  RETURN CASE v_access
    WHEN 'viewer'   THEN false
    WHEN 'reporter' THEN p_permission IN ('view_revenue', 'view_profit', 'view_adspend')
    WHEN 'editor'   THEN true
    ELSE false
  END;
END;
$$;
