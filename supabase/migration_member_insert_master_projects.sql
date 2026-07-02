-- Allow members to create master projects
CREATE POLICY "member_insert_master_projects" ON master_projects FOR INSERT
  WITH CHECK (get_user_role() = 'member');
