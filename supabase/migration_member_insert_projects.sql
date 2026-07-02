-- Allow members to create projects within their own team
CREATE POLICY "member_insert_projects" ON projects FOR INSERT
  WITH CHECK (get_user_role() = 'member' AND team_id = get_user_team_id());
