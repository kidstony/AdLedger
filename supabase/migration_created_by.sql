-- Add created_by column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
