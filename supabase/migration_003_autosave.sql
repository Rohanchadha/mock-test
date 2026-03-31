-- ============================================================
-- Migration 003 — Exam Progress Auto-Save + pg_cron Sweep
--
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor).
-- Prerequisite: migration_002_security.sql must be applied first.
-- ============================================================

-- 1. Exam progress table for auto-saving answers mid-test
--    No SELECT/INSERT policies for anon — only service_role can read/write.
create table if not exists exam_progress (
  user_id             uuid not null references users(id) on delete cascade,
  test_id             uuid not null references tests(id) on delete cascade,
  answers             jsonb not null default '{}',
  statuses            jsonb not null default '{}',
  active_section_id   uuid,
  active_question_id  uuid,
  last_saved_at       timestamptz not null default now(),
  primary key (user_id, test_id)
);

alter table exam_progress enable row level security;
-- No policies — only service_role can access

-- Index for fast lookups by user + test
create index if not exists idx_exam_progress_user_test
  on exam_progress(user_id, test_id);

-- ============================================================
-- 2. pg_cron auto-submit function for abandoned exams
--
-- Finds expired exam sessions with saved progress but no submission,
-- scores them, inserts into submissions, and cleans up.
--
-- PREREQUISITE: Enable pg_cron in Supabase Dashboard →
--   Database → Extensions → search "pg_cron" → Enable
-- ============================================================

create or replace function auto_submit_expired_exams()
returns void
language plpgsql
security definer
as $$
declare
  rec record;
  q record;
  total_score int;
  selected jsonb;
  correct jsonb;
begin
  -- Find expired sessions with progress but no submission
  for rec in
    select
      es.user_id,
      es.test_id,
      ep.answers
    from exam_sessions es
    join tests t on t.id = es.test_id
    join exam_progress ep on ep.user_id = es.user_id and ep.test_id = es.test_id
    left join submissions s on s.user_id = es.user_id and s.test_id = es.test_id
    where s.id is null
      and es.started_at + (t.duration_mins * interval '1 minute') < now()
  loop
    total_score := 0;

    -- Score each question
    for q in
      select qa.question_id, qa.correct_options
      from question_answers qa
      join questions qs on qs.id = qa.question_id
      where qs.test_id = rec.test_id
    loop
      selected := rec.answers -> (q.question_id::text);

      if selected is null or jsonb_array_length(selected) = 0 then
        -- Unanswered: 0 points
        continue;
      end if;

      correct := q.correct_options;

      if selected @> correct and correct @> selected then
        -- Exact match: +4
        total_score := total_score + 4;
      else
        -- Wrong answer: -1
        total_score := total_score - 1;
      end if;
    end loop;

    -- Insert submission
    insert into submissions (user_id, test_id, answers, score)
    values (rec.user_id, rec.test_id, rec.answers, total_score)
    on conflict (user_id, test_id) do nothing;

    -- Clean up progress
    delete from exam_progress
    where user_id = rec.user_id and test_id = rec.test_id;
  end loop;
end;
$$;

-- ============================================================
-- 3. Schedule the sweep — runs once daily at 11 PM UTC
--
-- If pg_cron is not enabled, skip this section.
-- The lazy auto-submit in the app code handles real-time cases.
-- ============================================================

-- Uncomment the lines below after enabling pg_cron extension:
-- select cron.schedule(
--   'auto-submit-expired-exams',
--   '0 23 * * *',
--   $$ select auto_submit_expired_exams(); $$
-- );
