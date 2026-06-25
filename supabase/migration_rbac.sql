-- =====================================================
-- RBAC Migration: Teams + Roles + RLS
-- Chạy trong Supabase SQL Editor
-- QUAN TRỌNG: Chạy từng block theo thứ tự, kiểm tra lỗi trước khi tiếp tục
-- =====================================================

-- ─────────────────────────────────────────
-- BLOCK 1: Tạo bảng teams
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- BLOCK 2: Cập nhật user_profiles
-- ─────────────────────────────────────────
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

-- Migrate role values (chạy SAU khi đã xác nhận schema)
UPDATE user_profiles SET role = 'super_admin' WHERE role = 'admin';
UPDATE user_profiles SET role = 'member'      WHERE role = 'employee';

-- ─────────────────────────────────────────
-- BLOCK 3: Thêm team_id vào projects
-- ─────────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────
-- BLOCK 4: Tạo bảng project_members
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- ─────────────────────────────────────────
-- BLOCK 5: Helper functions (SECURITY DEFINER để bypass RLS khi gọi trong policies)
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM user_profiles WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION get_user_team_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT team_id FROM user_profiles WHERE user_id = auth.uid()
$$;

-- ─────────────────────────────────────────
-- BLOCK 6: RLS — BẬT SAU KHI ĐÃ GÁN TEAMS VÀ PROJECTS
-- (Chạy sau khi đã tạo teams, gán users vào teams, gán projects vào teams)
-- ─────────────────────────────────────────

ALTER TABLE projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_spend         ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_revenue ENABLE ROW LEVEL SECURITY;
ALTER TABLE other_costs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_group_cids ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_rental_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members  ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- BLOCK 7: Policies — projects
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_projects"     ON projects;
DROP POLICY IF EXISTS "mgr_select_projects" ON projects;
DROP POLICY IF EXISTS "mgr_insert_projects" ON projects;
DROP POLICY IF EXISTS "mgr_update_projects" ON projects;
DROP POLICY IF EXISTS "member_select_projects" ON projects;

CREATE POLICY "sa_all_projects" ON projects FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_projects" ON projects FOR SELECT
  USING (get_user_role() = 'manager' AND team_id = get_user_team_id());

CREATE POLICY "mgr_insert_projects" ON projects FOR INSERT
  WITH CHECK (get_user_role() = 'manager' AND team_id = get_user_team_id());

CREATE POLICY "mgr_update_projects" ON projects FOR UPDATE
  USING (get_user_role() = 'manager' AND team_id = get_user_team_id());

CREATE POLICY "member_select_projects" ON projects FOR SELECT
  USING (
    get_user_role() = 'member' AND
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

-- ─────────────────────────────────────────
-- BLOCK 8: Policies — ad_spend
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_adspend" ON ad_spend;
DROP POLICY IF EXISTS "mgr_select_adspend" ON ad_spend;

CREATE POLICY "sa_all_adspend" ON ad_spend FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_adspend" ON ad_spend FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    campaign_id IN (
      SELECT google_campaign_id FROM projects
      WHERE team_id = get_user_team_id() AND google_campaign_id IS NOT NULL
    )
  );
-- member: không có policy → không thấy gì

-- ─────────────────────────────────────────
-- BLOCK 9: Policies — affiliate_revenue
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_revenue"  ON affiliate_revenue;
DROP POLICY IF EXISTS "mgr_select_revenue" ON affiliate_revenue;

CREATE POLICY "sa_all_revenue" ON affiliate_revenue FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_revenue" ON affiliate_revenue FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id())
  );

-- ─────────────────────────────────────────
-- BLOCK 10: Policies — other_costs
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_other_costs" ON other_costs;
DROP POLICY IF EXISTS "mgr_select_other_costs" ON other_costs;

CREATE POLICY "sa_all_other_costs" ON other_costs FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_other_costs" ON other_costs FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    (project_id IS NULL OR project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id()))
  );

-- ─────────────────────────────────────────
-- BLOCK 11: Policies — rental_group_cids & rental_groups
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_rgc" ON rental_group_cids;
DROP POLICY IF EXISTS "mgr_select_rgc" ON rental_group_cids;

CREATE POLICY "sa_all_rgc" ON rental_group_cids FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_rgc" ON rental_group_cids FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    (project_id IS NULL OR project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id()))
  );

DROP POLICY IF EXISTS "sa_all_rental" ON rental_groups;
DROP POLICY IF EXISTS "mgr_select_rental" ON rental_groups;

CREATE POLICY "sa_all_rental" ON rental_groups FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_rental" ON rental_groups FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    id IN (
      SELECT group_id FROM rental_group_cids rgc
      JOIN projects p ON p.project_id = rgc.project_id
      WHERE p.team_id = get_user_team_id()
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 12: Policies — account_rental_rates
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_arr" ON account_rental_rates;
DROP POLICY IF EXISTS "mgr_select_arr" ON account_rental_rates;

CREATE POLICY "sa_all_arr" ON account_rental_rates FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_arr" ON account_rental_rates FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    (project_id IS NULL OR project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id()))
  );

-- ─────────────────────────────────────────
-- BLOCK 13: Policies — banks & bank_accounts
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_banks" ON banks;
DROP POLICY IF EXISTS "mgr_select_banks" ON banks;

CREATE POLICY "sa_all_banks" ON banks FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_banks" ON banks FOR SELECT
  USING (get_user_role() = 'manager');

DROP POLICY IF EXISTS "sa_all_bank_accounts" ON bank_accounts;
DROP POLICY IF EXISTS "mgr_select_bank_accounts" ON bank_accounts;

CREATE POLICY "sa_all_bank_accounts" ON bank_accounts FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_bank_accounts" ON bank_accounts FOR SELECT
  USING (get_user_role() = 'manager');

-- ─────────────────────────────────────────
-- BLOCK 14: Policies — user_profiles
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_profiles"   ON user_profiles;
DROP POLICY IF EXISTS "mgr_select_profiles" ON user_profiles;
DROP POLICY IF EXISTS "member_self_profile" ON user_profiles;

CREATE POLICY "sa_all_profiles" ON user_profiles FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_select_profiles" ON user_profiles FOR SELECT
  USING (
    get_user_role() = 'manager' AND
    (user_id = auth.uid() OR team_id = get_user_team_id())
  );

CREATE POLICY "member_self_profile" ON user_profiles FOR SELECT
  USING (user_id = auth.uid());

-- ─────────────────────────────────────────
-- BLOCK 15: Policies — teams
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_teams"  ON teams;
DROP POLICY IF EXISTS "mgr_own_team" ON teams;

CREATE POLICY "sa_all_teams" ON teams FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_own_team" ON teams FOR SELECT
  USING (get_user_role() = 'manager' AND id = get_user_team_id());

-- ─────────────────────────────────────────
-- BLOCK 16: Policies — project_members
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_pm"      ON project_members;
DROP POLICY IF EXISTS "mgr_team_pm"   ON project_members;
DROP POLICY IF EXISTS "member_self_pm" ON project_members;

CREATE POLICY "sa_all_pm" ON project_members FOR ALL
  USING (get_user_role() = 'super_admin');

CREATE POLICY "mgr_team_pm" ON project_members FOR ALL
  USING (
    get_user_role() = 'manager' AND
    project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id())
  );

CREATE POLICY "member_self_pm" ON project_members FOR SELECT
  USING (user_id = auth.uid());
