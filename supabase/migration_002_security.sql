-- supabase/migration_002_security.sql
-- ============================================================
-- Security Hardening Migration
--
-- DEPLOYMENT ORDER:
--   1. Run PART A in Supabase SQL Editor (Dashboard > SQL Editor)
--   2. Deploy application code (Tasks 5–12)
--   3. Run PART B in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- PART A — Run BEFORE deploying code
-- ============================================================

-- 1. Restricted answer key table
--    No SELECT policy for anon — only service_role can read.
--    Correct options are no longer visible via the public REST API.
create table if not exists question_answers (
  question_id    uuid primary key references questions(id) on delete cascade,
  correct_options jsonb not null
);
alter table question_answers enable row level security;

-- 2. Migrate existing correct_options from questions table
insert into question_answers (question_id, correct_options)
select id, correct_options
from questions
on conflict (question_id) do nothing;

-- 3. Exam sessions for server-side timer enforcement
--    No policies — only service_role can read/write.
create table if not exists exam_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  test_id     uuid not null references tests(id) on delete cascade,
  started_at  timestamptz default now(),
  unique(user_id, test_id)
);
alter table exam_sessions enable row level security;

-- Index for fast timer lookups in the submit API
create index if not exists idx_exam_sessions_user_test
  on exam_sessions(user_id, test_id);

-- 4. Unique constraint on submissions to prevent concurrent double-submit
alter table submissions
  add constraint if not exists submissions_user_test_unique
  unique (user_id, test_id);

-- ============================================================
-- PART B — Run AFTER deploying code
-- ============================================================

-- 4. Drop correct_options from questions
--    New code reads from question_answers via service_role.
--    Only run after the app code is deployed.
-- alter table questions drop column if exists correct_options;

-- 5. Remove permissive submissions INSERT policy
--    New code uses service_role client to insert submissions.
--    Direct Supabase REST API calls with anon key can no longer insert.
-- drop policy if exists "Anyone can submit" on submissions;

-- 6. Remove permissive users INSERT policy
--    New code uses service_role client for login upsert.
-- drop policy if exists "Anyone can create user" on users;
