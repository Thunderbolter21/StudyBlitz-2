-- ============================================================================
-- StudyBlitz 2 — initial schema (0001_init.sql)
-- Paste this ENTIRE file into the Supabase SQL editor and press Run.
-- Safe to run once on a fresh project.
--
-- Design notes (why two timestamp columns):
--   updated_at        — set by the CLIENT at the moment of the edit.
--                       Per-row conflict resolution compares THIS value, so
--                       "latest edit wins" stays true even when an offline
--                       edit is replayed days later.
--   server_updated_at — set by a trigger to server time on every write.
--                       Sync pulls use it as a cursor ("rows changed since
--                       X") because server time is monotonic and trustworthy.
--   deleted_at        — soft delete. Rows are tombstoned, never removed, so
--                       a stale device can never resurrect or wipe data.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Shared trigger: maintain sync columns ───────────────────────────────────
create or replace function public.handle_sync_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.server_updated_at := now();
  if new.updated_at is null then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ── Tables ──────────────────────────────────────────────────────────────────
-- Hierarchy: semesters → classes → decks → questions.

create table public.semesters (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null,
  sort_order        int  not null default 0,
  archived_at       timestamptz,          -- hidden without deleting
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create table public.classes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  semester_id       uuid not null references public.semesters (id) on delete cascade,
  name              text not null,
  color             text not null default '#1d4f91',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

create table public.decks (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  class_id                uuid not null references public.classes (id) on delete cascade,
  name                    text not null,
  color                   text,              -- null = inherit the class color
  last_score              numeric,
  generation_instructions text not null default '',
  generation_notes        text not null default '',
  generation_count        int  not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  server_updated_at       timestamptz not null default now(),
  deleted_at              timestamptz
);

create table public.questions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id           uuid not null references public.decks (id) on delete cascade,
  type              text not null default 'mc'
                    check (type in ('mc', 'free-response', 'multi-select')),
  q                 text not null,
  opts              jsonb,                 -- array of 4 strings; null for free-response
  ans               jsonb not null,        -- mc: number · multi-select: number[] · free-response: string[]
  explain           text not null default '',
  cat               text not null default 'General',
  sort_order        int  not null default 0,
  source_image_path text,                  -- Storage path of an attached source image
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

-- SM-2 memory, one row per (user, question).
create table public.card_memory (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id       uuid not null references public.questions (id) on delete cascade,
  correct           int  not null default 0,
  total             int  not null default 0,
  ever_wrong        boolean not null default false,
  last_result       text,                  -- 'correct' | 'wrong' | null
  reps              int  not null default 0,
  ease              double precision not null default 2.5,
  interval_days     int  not null default 1,
  due               bigint not null default 0,   -- Unix ms, matching v1
  response_times    jsonb not null default '[]', -- last 20 of {ms, ts, correct}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (user_id, question_id)
);

-- User-saved instruction presets (built-ins ship in app code, not here).
create table public.presets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null,
  body              text not null,
  sort_order        int  not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

-- One row per user: API key, model override, misc preferences.
create table public.user_settings (
  user_id           uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  anthropic_api_key text,
  model             text,
  preferences       jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

-- Metadata for uploaded source material. The file bytes themselves live in
-- the private 'source-files' Storage bucket at: user_id/deck_id/file_id
create table public.source_files (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id           uuid not null references public.decks (id) on delete cascade,
  name              text not null,
  kind              text not null check (kind in ('pdf', 'image', 'docx', 'pptx', 'url', 'text')),
  media_type        text,
  size_bytes        bigint,
  original_size     bigint,
  storage_path      text,                  -- null for kind='url'
  source_url        text,                  -- set for kind='url'
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz
);

-- Time-challenge best scores, one row per (user, deck, seconds).
create table public.high_scores (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  deck_id           uuid not null references public.decks (id) on delete cascade,
  seconds           int not null,
  correct           int not null default 0,
  total             int not null default 0,
  achieved_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (user_id, deck_id, seconds)
);

-- ── Indexes for sync pulls and foreign keys ─────────────────────────────────
create index semesters_sync_idx    on public.semesters    (user_id, server_updated_at);
create index classes_sync_idx      on public.classes      (user_id, server_updated_at);
create index classes_semester_idx  on public.classes      (semester_id);
create index decks_sync_idx        on public.decks        (user_id, server_updated_at);
create index decks_class_idx       on public.decks        (class_id);
create index questions_sync_idx    on public.questions    (user_id, server_updated_at);
create index questions_deck_idx    on public.questions    (deck_id);
create index card_memory_sync_idx  on public.card_memory  (user_id, server_updated_at);
create index presets_sync_idx      on public.presets      (user_id, server_updated_at);
create index settings_sync_idx     on public.user_settings (user_id, server_updated_at);
create index source_files_sync_idx on public.source_files (user_id, server_updated_at);
create index source_files_deck_idx on public.source_files (deck_id);
create index high_scores_sync_idx  on public.high_scores  (user_id, server_updated_at);

-- ── RLS + sync trigger on every table ───────────────────────────────────────
-- Four explicit policies per table (select / insert / update / delete), each
-- scoped to auth.uid() = user_id. The loop just avoids 36 copies of the same
-- statement — the effect is identical to writing them out by hand.
do $$
declare
  t text;
begin
  foreach t in array array[
    'semesters', 'classes', 'decks', 'questions', 'card_memory',
    'presets', 'user_settings', 'source_files', 'high_scores'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "select own rows" on public.%I for select using (auth.uid() = user_id)', t);
    execute format(
      'create policy "insert own rows" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "update own rows" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "delete own rows" on public.%I for delete using (auth.uid() = user_id)', t);

    execute format(
      'create trigger %I before insert or update on public.%I
         for each row execute function public.handle_sync_columns()',
      t || '_sync_columns', t);
  end loop;
end $$;

-- ── Private Storage bucket for source files ─────────────────────────────────
insert into storage.buckets (id, name, public)
values ('source-files', 'source-files', false)
on conflict (id) do nothing;

-- Each user may only touch objects inside their own top-level folder:
-- the object path is always  user_id/deck_id/file_id
create policy "read own source files" on storage.objects
  for select using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "upload own source files" on storage.objects
  for insert with check (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "update own source files" on storage.objects
  for update using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own source files" on storage.objects
  for delete using (
    bucket_id = 'source-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
