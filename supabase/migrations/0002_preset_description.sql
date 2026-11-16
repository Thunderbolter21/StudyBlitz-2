-- 0002_preset_description.sql
-- Adds a one-line description to user-saved presets (shown in the Quiz
-- Builder's preset picker). Paste into the Supabase SQL editor and Run.

alter table public.presets
  add column if not exists description text not null default '';
