-- ============================================================
-- JEE Mock Test Platform — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Users identified by phone number (no password/OTP for now)
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  phone       text unique not null,
  name        text not null,
  email       text,
  created_at  timestamptz default now()
);

-- Test metadata
create table if not exists tests (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  duration_mins  int not null,
  is_visible     boolean default true,
  created_at     timestamptz default now()
);

-- Sections within a test (e.g. Physics, Chemistry, Maths)
create table if not exists sections (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references tests(id) on delete cascade,
  name            text not null,
  display_order   int not null,
  question_count  int not null
);

-- Questions (text/options may contain LaTeX, rendered via KaTeX on frontend)
create table if not exists questions (
  id              uuid primary key default gen_random_uuid(),
  test_id         uuid not null references tests(id) on delete cascade,
  section_id      uuid not null references sections(id) on delete cascade,
  display_order   int not null,
  type            text not null check (type in ('SCQ', 'MCQ')),
  text            text not null,
  options         jsonb not null,        -- string[]
  correct_options jsonb not null         -- number[] (0-indexed)
);

-- One submission per user per test
create table if not exists submissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  test_id       uuid not null references tests(id),
  answers       jsonb not null default '{}',  -- { "question_id": [option_indices] }
  score         int not null default 0,
  submitted_at  timestamptz default now(),
  unique(user_id, test_id)
);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

alter table users enable row level security;
alter table tests enable row level security;
alter table sections enable row level security;
alter table questions enable row level security;
alter table submissions enable row level security;

-- Tests: anyone can read visible tests
create policy "Public can read visible tests"
  on tests for select
  using (is_visible = true);

-- Sections: anyone can read
create policy "Public can read sections"
  on sections for select
  using (true);

-- Questions: anyone can read
create policy "Public can read questions"
  on questions for select
  using (true);

-- Users: anyone can insert (login/register), read own row
create policy "Anyone can create user"
  on users for insert
  with check (true);

create policy "Anyone can read users (for leaderboard)"
  on users for select
  using (true);

-- Submissions: anyone can insert, read all (for leaderboard)
create policy "Anyone can submit"
  on submissions for insert
  with check (true);

create policy "Anyone can read submissions (for leaderboard)"
  on submissions for select
  using (true);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_questions_test_section on questions(test_id, section_id);
create index if not exists idx_questions_section_order on questions(section_id, display_order);
create index if not exists idx_submissions_test_score on submissions(test_id, score desc);
create index if not exists idx_sections_test_order on sections(test_id, display_order);
