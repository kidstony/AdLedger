-- =====================================================
-- Migration: Organizations (Multi-tenancy layer)
-- Chạy trong Supabase SQL Editor theo từng BLOCK
-- Quy tắc: SA với organization_id=NULL thấy tất cả (Global Admin)
--          SA với organization_id có giá trị chỉ thấy data của org đó
-- =====================================================

-- ─────────────────────────────────────────
-- BLOCK 1: Bảng organizations
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
-- BLOCK 2: Thêm organization_id vào teams và user_profiles
-- ─────────────────────────────────────────
ALTER TABLE teams         ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────
-- BLOCK 3: Helper function
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM user_profiles WHERE user_id = auth.uid()
$$;

-- ─────────────────────────────────────────
-- BLOCK 4: RLS cho bảng organizations
-- ─────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sa_see_orgs"           ON organizations;
DROP POLICY IF EXISTS "global_sa_manage_orgs" ON organizations;

-- SA thấy org của mình (hoặc tất cả nếu org_id null = Global Admin)
CREATE POLICY "sa_see_orgs" ON organizations FOR SELECT
  USING (
    get_user_role() = 'super_admin'
    AND (get_user_org_id() IS NULL OR id = get_user_org_id())
  );

-- Chỉ Global SA (org_id null) được tạo/sửa/xóa org
CREATE POLICY "global_sa_manage_orgs" ON organizations FOR ALL
  USING (get_user_role() = 'super_admin' AND get_user_org_id() IS NULL);

-- ─────────────────────────────────────────
-- BLOCK 5: Cập nhật RLS — teams
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_teams" ON teams;
CREATE POLICY "sa_all_teams" ON teams FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (get_user_org_id() IS NULL OR organization_id = get_user_org_id())
  );

-- ─────────────────────────────────────────
-- BLOCK 6: Cập nhật RLS — user_profiles
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_profiles" ON user_profiles;
CREATE POLICY "sa_all_profiles" ON user_profiles FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR organization_id = get_user_org_id()
      OR user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 7: Cập nhật RLS — projects
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_projects" ON projects;
CREATE POLICY "sa_all_projects" ON projects FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 8: Cập nhật RLS — project_members
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_pm" ON project_members;
CREATE POLICY "sa_all_pm" ON project_members FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 9: Cập nhật RLS — project_shares
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_shares" ON project_shares;
CREATE POLICY "sa_shares" ON project_shares FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 10: Cập nhật RLS — project_share_permissions
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_share_perms" ON project_share_permissions;
CREATE POLICY "sa_share_perms" ON project_share_permissions FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR EXISTS (
        SELECT 1 FROM project_shares ps
        JOIN projects p ON p.project_id = ps.project_id
        WHERE ps.id = project_share_permissions.share_id
          AND p.team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 11: Cập nhật RLS — affiliate_revenue
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_revenue" ON affiliate_revenue;
CREATE POLICY "sa_all_revenue" ON affiliate_revenue FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 12: Cập nhật RLS — other_costs
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_other_costs" ON other_costs;
CREATE POLICY "sa_all_other_costs" ON other_costs FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 13: Cập nhật RLS — ad_spend
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_adspend" ON ad_spend;
CREATE POLICY "sa_all_adspend" ON ad_spend FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR campaign_id IN (
        SELECT google_campaign_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
          AND google_campaign_id IS NOT NULL
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 14: Cập nhật RLS — rental_group_cids
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_rgc" ON rental_group_cids;
CREATE POLICY "sa_all_rgc" ON rental_group_cids FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 15: Cập nhật RLS — rental_groups
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_rental" ON rental_groups;
CREATE POLICY "sa_all_rental" ON rental_groups FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR id IN (
        SELECT group_id FROM rental_group_cids rgc
        JOIN projects p ON p.project_id = rgc.project_id
        WHERE p.team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 16: Cập nhật RLS — account_rental_rates
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "sa_all_arr" ON account_rental_rates;
CREATE POLICY "sa_all_arr" ON account_rental_rates FOR ALL
  USING (
    get_user_role() = 'super_admin'
    AND (
      get_user_org_id() IS NULL
      OR project_id IS NULL
      OR project_id IN (
        SELECT project_id FROM projects
        WHERE team_id IN (SELECT id FROM teams WHERE organization_id = get_user_org_id())
      )
    )
  );

-- ─────────────────────────────────────────
-- BLOCK 17: banks & bank_accounts — không org-scoped (global tables)
-- Nếu muốn org-scoped sau này: thêm team_id vào banks rồi filter
-- ─────────────────────────────────────────
-- (Không thay đổi policies banks/bank_accounts)
