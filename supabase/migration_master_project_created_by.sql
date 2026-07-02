-- Add created_by to master_projects
ALTER TABLE master_projects ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- super_admin và manager có thể insert bất kỳ master project nào
DO $$ BEGIN
  CREATE POLICY "admin_manager_insert_master_projects" ON master_projects FOR INSERT
    WITH CHECK (get_user_role() IN ('super_admin', 'manager'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- super_admin và manager có thể update bất kỳ master project nào
DO $$ BEGIN
  CREATE POLICY "admin_manager_update_master_projects" ON master_projects FOR UPDATE
    USING (get_user_role() IN ('super_admin', 'manager'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Member chỉ update được master project do chính họ tạo
DO $$ BEGIN
  CREATE POLICY "member_update_own_master_projects" ON master_projects FOR UPDATE
    USING (get_user_role() = 'member' AND created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
