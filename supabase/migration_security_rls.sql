-- Security RLS migration: enable row-level security on tables missing policies

-- ─────────────────────────────────────────
-- FIX: member_select_projects — cập nhật policy để check project_shares + person_in_charge
-- Policy cũ chỉ check project_members (bảng cũ), code hiện tại dùng project_shares
-- ─────────────────────────────────────────
DROP POLICY IF EXISTS "member_select_projects" ON projects;
CREATE POLICY "member_select_projects" ON projects FOR SELECT
  USING (
    get_user_role() = 'member' AND (
      project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
      OR project_id IN (SELECT project_id FROM project_shares WHERE user_id = auth.uid())
      OR person_in_charge = auth.uid()
    )
  );

-- FIX: project_shares — member phải thấy được record của mình để code query được
DROP POLICY IF EXISTS "member_self_ps" ON project_shares;
CREATE POLICY "member_self_ps" ON project_shares FOR SELECT
  USING (user_id = auth.uid());

-- master_projects: scoped by role
-- Member chỉ thấy master_projects có ít nhất 1 project họ được truy cập
ALTER TABLE master_projects ENABLE ROW LEVEL SECURITY;

-- Member: thấy master_projects có ít nhất 1 project được truy cập
CREATE OR REPLACE FUNCTION public.get_my_accessible_master_project_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.master_project_id
  FROM projects p
  WHERE p.master_project_id IS NOT NULL
    AND (
      p.project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
      OR p.project_id IN (SELECT project_id FROM project_shares WHERE user_id = auth.uid())
      OR p.person_in_charge = auth.uid()
    )
$$;

-- Manager: chỉ thấy master_projects có project thuộc team của mình
CREATE OR REPLACE FUNCTION public.get_my_manager_master_project_ids()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.master_project_id
  FROM projects p
  WHERE p.master_project_id IS NOT NULL
    AND p.team_id IS NOT NULL
    AND p.team_id = (SELECT team_id FROM user_profiles WHERE user_id = auth.uid())
$$;

DROP POLICY IF EXISTS "auth_read_master_projects" ON master_projects;
DROP POLICY IF EXISTS "sa_mgr_write_master_projects" ON master_projects;
CREATE POLICY "auth_read_master_projects" ON master_projects FOR SELECT
  TO authenticated USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() = 'manager' AND id IN (SELECT get_my_manager_master_project_ids()))
    OR id IN (SELECT get_my_accessible_master_project_ids())
  );
CREATE POLICY "sa_mgr_write_master_projects" ON master_projects FOR ALL
  USING (get_user_role() IN ('super_admin', 'manager'));

-- project_categories: authenticated users can read, super_admin/manager can write
ALTER TABLE project_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_categories" ON project_categories;
DROP POLICY IF EXISTS "sa_mgr_write_categories" ON project_categories;
CREATE POLICY "auth_read_categories" ON project_categories FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "sa_mgr_write_categories" ON project_categories FOR ALL
  USING (get_user_role() IN ('super_admin', 'manager'));

-- project_history: scoped by project access
ALTER TABLE project_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sa_all_history" ON project_history;
DROP POLICY IF EXISTS "mgr_team_history" ON project_history;
DROP POLICY IF EXISTS "member_shared_history" ON project_history;
CREATE POLICY "sa_all_history" ON project_history FOR ALL
  USING (get_user_role() = 'super_admin');
CREATE POLICY "mgr_team_history" ON project_history FOR SELECT
  USING (get_user_role() = 'manager' AND
    project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id()));
CREATE POLICY "member_shared_history" ON project_history FOR SELECT
  USING (get_user_role() = 'member' AND
    project_id IN (SELECT project_id FROM project_shares WHERE user_id = auth.uid()));

-- project_reminders: scoped by project access
ALTER TABLE project_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sa_all_reminders" ON project_reminders;
DROP POLICY IF EXISTS "mgr_team_reminders" ON project_reminders;
DROP POLICY IF EXISTS "member_shared_reminders" ON project_reminders;
CREATE POLICY "sa_all_reminders" ON project_reminders FOR ALL
  USING (get_user_role() = 'super_admin');
CREATE POLICY "mgr_team_reminders" ON project_reminders FOR ALL
  USING (get_user_role() = 'manager' AND
    project_id IN (SELECT project_id FROM projects WHERE team_id = get_user_team_id()));
CREATE POLICY "member_shared_reminders" ON project_reminders FOR SELECT
  USING (get_user_role() = 'member' AND
    project_id IN (SELECT project_id FROM project_shares WHERE user_id = auth.uid()));

-- notifications: each user sees only their own
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_notifications" ON notifications;
DROP POLICY IF EXISTS "sa_all_notifications" ON notifications;
CREATE POLICY "own_notifications" ON notifications FOR ALL
  USING (user_id = auth.uid());
CREATE POLICY "sa_all_notifications" ON notifications FOR ALL
  USING (get_user_role() = 'super_admin');

-- affiliate_networks: authenticated read, super_admin write
ALTER TABLE affiliate_networks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_read_networks" ON affiliate_networks;
DROP POLICY IF EXISTS "sa_write_networks" ON affiliate_networks;
CREATE POLICY "auth_read_networks" ON affiliate_networks FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "sa_write_networks" ON affiliate_networks FOR ALL
  USING (get_user_role() = 'super_admin');
