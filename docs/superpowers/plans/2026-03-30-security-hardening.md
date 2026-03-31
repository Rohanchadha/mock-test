# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all CRITICAL/HIGH/MEDIUM security findings from the audit: dead middleware, exposed correct_options, missing SESSION_SECRET guard, weak input validation, client-side-only exam timer, permissive RLS, unnecessary PII in leaderboard queries, and zero-factor authentication (replaced with email OTP).

**Architecture:** Changes fall into three layers. (1) Pure code fixes requiring no DB changes (Tasks 1–4). (2) A two-part DB migration that creates a `question_answers` table (moves `correct_options` out of public view), adds an `exam_sessions` table for server-side timer enforcement, and tightens RLS INSERT policies — deployed in two steps around the code release. (3) App code changes that depend on the new tables (Tasks 5–10), using a new `lib/supabase/admin.ts` service-role client for all privileged server operations.

**Tech Stack:** Next.js 16.2 App Router, Supabase, jose, zod (new dep), TypeScript

---

## ⚠️ Prerequisites — Do These Before Anything Else

The following require manual action in external systems and are **not** covered by this plan:

1. **Rotate `SUPABASE_SERVICE_ROLE_KEY`** — Supabase Dashboard → Settings → API → Regenerate service_role key. Update `.env.local` and any deployment environment.
2. **Regenerate `SESSION_SECRET`** — Run `openssl rand -base64 32` and replace the value in `.env.local` and deployment environment. All existing sessions will be invalidated (users must log in again — acceptable).
3. **Enable Supabase Email OTP (required for Task 12)** — Dashboard → Authentication → Providers → Email → toggle **"Enable Email OTP"** on. Then go to Authentication → Settings and set **"OTP expiry"** to `600` (10 minutes). Without this, `signInWithOtp` sends a magic link instead of a 6-digit code.
4. **Rate limiting (Finding #7)** — Requires an Upstash Redis instance. Tracked separately.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `middleware.ts` | **Create** | Edge-compatible route protection (replaces dead `proxy.ts`) |
| `proxy.ts` | **Delete** | Dead code — was never invoked by Next.js |
| `lib/session.ts` | **Modify** | Add SESSION_SECRET startup guard + pending login helpers (Tasks 2, 12) |
| `lib/types.ts` | **Modify** | Remove `phone` from `LeaderboardEntry` |
| `app/test/[testId]/results/page.tsx` | **Modify** | Drop phone from user query; use admin client for `correct_options` |
| `app/actions/auth.ts` | **Modify** | Add Zod validation + use admin client for upsert |
| `app/api/test/submit/route.ts` | **Rewrite** | Zod validation, server-side timer, admin client for answers + insert |
| `app/test/[testId]/page.tsx` | **Modify** | Create exam session (start timer) on page load |
| `lib/supabase/admin.ts` | **Create** | Service-role Supabase client for server-only privileged operations |
| `scripts/seed-test.ts` | **Modify** | Insert into `question_answers` table separately |
| `supabase/migration_002_security.sql` | **Create** | New tables, data migration, RLS tightening |
| `package.json` | **Modify** | Add `zod` dependency |
| `components/OtpForm.tsx` | **Create** | Client component for 6-digit OTP input (Task 12) |
| `app/verify/page.tsx` | **Create** | OTP verification page — public route (Task 12) |

---

## Deployment Order

Run **Migration Part A** → deploy code changes → run **Migration Part B**.
Do NOT reverse this order — Part B drops the `correct_options` column that old code still reads.

---

## Task 1: Activate Route Protection (Rename Middleware)

**Files:**
- Create: `mock-test-platform/middleware.ts`
- Delete: `mock-test-platform/proxy.ts`

`proxy.ts` exports a function named `proxy` but Next.js App Router only invokes `middleware.ts` at the project root, with the function exported as `default` or named `middleware`. The current file is dead code. The new file inlines JWT verification directly (avoids importing `lib/session.ts` which uses `server-only` and `next/headers` — incompatible with the Edge runtime that middleware runs on).

- [ ] **Step 1: Create `middleware.ts`**

```typescript
// middleware.ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Routes accessible without a session
const PUBLIC_PATHS = new Set(['/', '/favicon.ico'])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('session')?.value

  if (!token) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  try {
    const secret = process.env.SESSION_SECRET
    if (!secret) throw new Error('SESSION_SECRET not configured')
    const key = new TextEncoder().encode(secret)
    await jwtVerify(token, key, { algorithms: ['HS256'] })
    return NextResponse.next()
  } catch {
    // Invalid/expired token — clear the cookie and redirect to login
    const response = NextResponse.redirect(new URL('/', request.url))
    response.cookies.delete('session')
    return response
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 2: Delete `proxy.ts`**

```bash
rm mock-test-platform/proxy.ts
```

- [ ] **Step 3: Verify middleware is active**

```bash
cd mock-test-platform && npm run dev
```

Open a private/incognito browser window. Navigate to `http://localhost:3000/dashboard` without logging in.
Expected: Redirect to `http://localhost:3000/` (login page).

Then log in normally and navigate to `/dashboard`.
Expected: Page loads correctly.

- [ ] **Step 4: Commit**

```bash
cd mock-test-platform
git add middleware.ts
git rm proxy.ts
git commit -m "fix: activate Next.js middleware for route protection

proxy.ts was never invoked by Next.js (wrong filename).
Replaces with middleware.ts using edge-compatible JWT
verification that protects all non-public routes."
```

---

## Task 2: SESSION_SECRET Startup Guard

**Files:**
- Modify: `lib/session.ts:5-6`

If `SESSION_SECRET` is missing, `TextEncoder.encode(undefined)` silently encodes the string `"undefined"` as the signing key. This makes all tokens forgeable by anyone who knows the fallback. Fail fast instead.

- [ ] **Step 1: Add the guard in `lib/session.ts`**

Replace lines 5–6:
```typescript
// BEFORE
const secretKey = process.env.SESSION_SECRET
const encodedKey = new TextEncoder().encode(secretKey)
```

With:
```typescript
// AFTER
const secretKey = process.env.SESSION_SECRET
if (!secretKey) {
  throw new Error(
    'SESSION_SECRET environment variable is not set. ' +
    'Generate one with: openssl rand -base64 32'
  )
}
const encodedKey = new TextEncoder().encode(secretKey)
```

- [ ] **Step 2: Verify it fails fast when the var is missing**

Temporarily comment out `SESSION_SECRET=...` in `.env.local`, then run:
```bash
cd mock-test-platform && npm run dev
```
Expected: Server startup fails with `Error: SESSION_SECRET environment variable is not set.`

Restore the value in `.env.local` and confirm the server starts normally.

- [ ] **Step 3: Commit**

```bash
git add lib/session.ts
git commit -m "fix: fail fast when SESSION_SECRET is not set

Previously TextEncoder silently encoded 'undefined' as the
signing key, making all JWT tokens forgeable."
```

---

## Task 3: Remove Phone PII From Leaderboard Query

**Files:**
- Modify: `app/test/[testId]/results/page.tsx:40,43-44`
- Modify: `lib/types.ts:41`

The results page fetches `phone` for all leaderboard users but never renders it. It's loaded into server memory and the `usersById` map unnecessarily. The `LeaderboardEntry` type also carries `phone`.

- [ ] **Step 1: Update the query in `results/page.tsx`**

Line 40 — change:
```typescript
// BEFORE
.select('id, name, phone')
```
To:
```typescript
// AFTER
.select('id, name')
```

- [ ] **Step 2: Update the `usersById` type in `results/page.tsx`**

Line 43 — change:
```typescript
// BEFORE
const usersById: Record<string, { name: string; phone: string }> = {}
```
To:
```typescript
// AFTER
const usersById: Record<string, { name: string }> = {}
```

- [ ] **Step 3: Remove `phone` from `LeaderboardEntry` in `lib/types.ts`**

```typescript
// BEFORE
export interface LeaderboardEntry {
  rank: number
  user_id: string
  name: string
  phone: string
  score: number
  submitted_at: string
}
```
```typescript
// AFTER
export interface LeaderboardEntry {
  rank: number
  user_id: string
  name: string
  score: number
  submitted_at: string
}
```

- [ ] **Step 4: Verify the results page still renders**

```bash
cd mock-test-platform && npm run dev
```
Submit a test and navigate to the results page. The leaderboard should show names and scores correctly.

- [ ] **Step 5: Commit**

```bash
git add app/test/\[testId\]/results/page.tsx lib/types.ts
git commit -m "fix: stop fetching phone numbers in leaderboard query

Phone was fetched from the users table but never displayed.
Removes unnecessary PII from server memory."
```

---

## Task 4: Add Zod Input Validation

> **Note:** The `app/actions/auth.ts` changes in this task are superseded by Task 12, which fully rewrites that file with OTP support. Skip the `auth.ts` steps here if executing in order; execute only the `route.ts` steps and the `npm install zod` step.

**Files:**
- Modify: `package.json`
- Modify: `app/api/test/submit/route.ts`
- ~~Modify: `app/actions/auth.ts`~~ ← superseded by Task 12

Neither the login action nor the submit API validate input structure. TypeScript type casts are erased at runtime. This adds server-side schema enforcement.

- [ ] **Step 1: Install zod**

```bash
cd mock-test-platform && npm install zod
```

Expected: `package.json` updated, `package-lock.json` updated.

- [ ] **Step 2: Add validation to `app/actions/auth.ts`**

Full file after changes:
```typescript
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createSession, deleteSession } from '@/lib/session'
import { z } from 'zod'

const loginSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z
    .string()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      'Enter a valid phone number (10–15 digits, optional + prefix)'
    ),
  email: z
    .string()
    .email('Enter a valid email address')
    .optional()
    .or(z.literal('')),
})

export async function login(_prevState: unknown, formData: FormData) {
  const raw = {
    name: (formData.get('name') as string)?.trim() ?? '',
    phone: (formData.get('phone') as string)?.trim() ?? '',
    email: (formData.get('email') as string)?.trim() ?? '',
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  const { name, phone, email } = parsed.data

  const supabase = await createClient()

  const { data: user, error } = await supabase
    .from('users')
    .upsert(
      { phone, name, email: email || null },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error || !user) {
    return { error: 'Something went wrong. Please try again.' }
  }

  await createSession({ userId: user.id, phone: user.phone, name: user.name })
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
```

- [ ] **Step 3: Add validation to `app/api/test/submit/route.ts`**

Replace the existing body parsing and type cast (lines 13–21) with:
```typescript
import { z } from 'zod'

const submitSchema = z.object({
  testId: z.string().uuid('testId must be a valid UUID'),
  answers: z.record(
    z.string().uuid(),
    z.array(z.number().int().min(0))
  ),
})
```

And replace the body parsing block:
```typescript
// BEFORE
const body = await request.json()
const { testId, answers } = body as {
  testId: string
  answers: Record<string, number[]>
}

if (!testId || !answers) {
  return NextResponse.json({ error: 'Missing testId or answers' }, { status: 400 })
}
```
With:
```typescript
// AFTER
let body: unknown
try {
  body = await request.json()
} catch {
  return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
}

const parsed = submitSchema.safeParse(body)
if (!parsed.success) {
  return NextResponse.json(
    { error: parsed.error.errors[0].message },
    { status: 400 }
  )
}

const { testId, answers } = parsed.data
```

- [ ] **Step 4: Verify login rejects invalid phone**

Start dev server. On the login page, enter name `"Test"`, phone `"abc"`, and submit.
Expected: Error message `"Enter a valid phone number (10–15 digits, optional + prefix)"`.

Enter a valid phone number. Expected: Login succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app/actions/auth.ts app/api/test/submit/route.ts
git commit -m "feat: add Zod schema validation to login and submit endpoints

Phone numbers now validated against E.164 format.
testId validated as UUID. answers validated as
Record<uuid, number[]>. TypeScript type casts replaced
with runtime schema parsing."
```

---

## Task 5: Create Admin Client

**Files:**
- Create: `lib/supabase/admin.ts`

The service-role client bypasses all RLS. It must only ever be instantiated in server-side code and used for operations where per-user RLS is intentionally bypassed (reading `correct_options`, inserting `exam_sessions`, inserting `submissions` after the RLS INSERT policy is removed).

- [ ] **Step 1: Create `lib/supabase/admin.ts`**

```typescript
import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client using the service_role key.
 * Bypasses all Row Level Security.
 * ONLY use in server-side code (Server Components, API Routes, Server Actions).
 * NEVER import this in Client Components or expose to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set'
    )
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd mock-test-platform && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/admin.ts
git commit -m "feat: add service-role admin client for privileged server operations

Used for reading question_answers, inserting submissions,
and managing exam_sessions — operations that require
bypassing RLS with explicit server-side identity checks."
```

---

## Task 6: Database Migration

**Files:**
- Create: `supabase/migration_002_security.sql`

This migration has two parts. **Part A** creates new tables and migrates data — safe to run before deploying code. **Part B** drops the old `correct_options` column and removes the permissive submissions INSERT policy — must only run after the new code is deployed.

Run each part in **Supabase Dashboard → SQL Editor**.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migration_002_security.sql
-- ============================================================
-- Security Hardening Migration
--
-- DEPLOYMENT ORDER:
--   1. Run PART A
--   2. Deploy application code (Tasks 5–10)
--   3. Run PART B
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
```

> Note: Part B statements are commented out. Uncomment and run them only after the new code is deployed and verified working.

- [ ] **Step 2: Run Part A in Supabase SQL Editor**

Copy everything under `-- PART A` (lines between the PART A and PART B comments, excluding the PART B section) and run it in Supabase Dashboard → SQL Editor.

Expected output: `Success. No rows returned.`

Verify in Table Editor:
- `question_answers` table exists with rows matching the `questions` table count
- `exam_sessions` table exists (empty)

- [ ] **Step 3: Commit the migration file**

```bash
cd mock-test-platform
git add supabase/migration_002_security.sql
git commit -m "feat: add security migration for question_answers and exam_sessions

question_answers: moves correct_options out of public-readable
questions table. No RLS SELECT policy for anon key.

exam_sessions: records when each user started each exam,
enabling server-side time limit enforcement.

Part B (drop column, tighten RLS) runs after code deploy."
```

---

## Task 7: Rewrite Submit API Route

**Files:**
- Modify: `app/api/test/submit/route.ts`

After Part A of the migration, this route must fetch `correct_options` from `question_answers` via the admin client, validate elapsed time against `exam_sessions`, and insert the submission using the admin client (so we can later remove the anon INSERT policy).

- [ ] **Step 1: Rewrite `app/api/test/submit/route.ts`**

Complete file:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSession } from '@/lib/session'
import { scoreSubmission } from '@/lib/scoring'
import type { Question } from '@/lib/types'
import { z } from 'zod'

const submitSchema = z.object({
  testId: z.string().uuid('testId must be a valid UUID'),
  answers: z.record(
    z.string().uuid(),
    z.array(z.number().int().min(0))
  ),
})

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    )
  }

  const { testId, answers } = parsed.data
  const supabase = await createClient()
  const adminClient = createAdminClient()

  // Check for existing submission (prevent double-submit)
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
  }

  // Server-side timer: verify an exam session exists and time hasn't expired
  const { data: examSession } = await adminClient
    .from('exam_sessions')
    .select('started_at')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (!examSession) {
    return NextResponse.json(
      { error: 'No active exam session. Please start the exam from the dashboard.' },
      { status: 403 }
    )
  }

  const { data: test } = await supabase
    .from('tests')
    .select('duration_mins')
    .eq('id', testId)
    .single()

  if (!test) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  const elapsedSeconds =
    (Date.now() - new Date(examSession.started_at).getTime()) / 1000
  const allowedSeconds = test.duration_mins * 60 + 60 // 60-second grace period

  if (elapsedSeconds > allowedSeconds) {
    return NextResponse.json(
      { error: 'Exam time has expired' },
      { status: 403 }
    )
  }

  // Fetch questions (without correct_options — those are in question_answers)
  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('id, test_id, section_id, display_order, type, text, options')
    .eq('test_id', testId)

  if (qError || !questions || questions.length === 0) {
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  // Fetch correct_options from restricted table via service_role
  const { data: questionAnswers, error: qaError } = await adminClient
    .from('question_answers')
    .select('question_id, correct_options')
    .in('question_id', questions.map((q) => q.id))

  if (qaError || !questionAnswers) {
    return NextResponse.json({ error: 'Failed to fetch answer key' }, { status: 500 })
  }

  // Merge correct_options into questions for scoring
  const answerMap = new Map(
    questionAnswers.map((qa) => [qa.question_id, qa.correct_options as number[]])
  )
  const questionsWithAnswers = questions.map((q) => ({
    ...q,
    correct_options: answerMap.get(q.id) ?? [],
  }))

  const { total } = scoreSubmission(questionsWithAnswers as Question[], answers)

  // Insert using service_role client — does not require anon INSERT policy
  const { error: insertError } = await adminClient.from('submissions').insert({
    user_id: session.userId,
    test_id: testId,
    answers,
    score: total,
  })

  if (insertError) {
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }

  return NextResponse.json({ score: total })
}
```

- [ ] **Step 2: Verify the submit route works end-to-end**

Start dev server. Log in, start a test, answer questions, submit.
Expected: Submission succeeds and redirects to results page with correct score.

Also verify timer rejection: in the browser console, call:
```javascript
fetch('/api/test/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ testId: 'not-a-uuid', answers: {} })
}).then(r => r.json()).then(console.log)
```
Expected: `{ error: "testId must be a valid UUID" }` with status 400.

- [ ] **Step 3: Commit**

```bash
git add app/api/test/submit/route.ts
git commit -m "feat: server-side timer validation and restricted answer key in submit API

- Validates elapsed time against exam_sessions table
- Fetches correct_options from question_answers via service_role
- Inserts submission via service_role (removes need for anon INSERT policy)
- Adds Zod schema validation for request body"
```

---

## Task 8: Create Exam Session on Page Load

**Files:**
- Modify: `app/test/[testId]/page.tsx`

The server-side timer requires knowing when the user started the exam. Record this when the exam page is first loaded. Using `ignoreDuplicates: true` means a page refresh does NOT reset the timer.

- [ ] **Step 1: Update `app/test/[testId]/page.tsx`**

Add import at the top:
```typescript
import { createAdminClient } from '@/lib/supabase/admin'
```

After the `if (!test) redirect('/dashboard')` block (currently line 36), add:
```typescript
// Record exam start time for server-side timer enforcement.
// ignoreDuplicates: true means refreshing the page does NOT reset the clock.
const adminClient = createAdminClient()
await adminClient
  .from('exam_sessions')
  .upsert(
    { user_id: session.userId, test_id: testId },
    { onConflict: 'user_id,test_id', ignoreDuplicates: true }
  )
```

Full updated file:
```typescript
import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import type { Test, Section, Question } from '@/lib/types'
import ExamShell from '@/components/ExamShell'

export default async function ExamPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const session = await getSession()
  if (!session) redirect('/')

  const supabase = await createClient()

  // Check if already submitted
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existing) redirect(`/test/${testId}/results`)

  // Fetch test
  const { data: test } = await supabase
    .from('tests')
    .select('*')
    .eq('id', testId)
    .eq('is_visible', true)
    .single()

  if (!test) redirect('/dashboard')

  // Record exam start time for server-side timer (upsert — refresh does NOT reset clock)
  const adminClient = createAdminClient()
  await adminClient
    .from('exam_sessions')
    .upsert(
      { user_id: session.userId, test_id: testId },
      { onConflict: 'user_id,test_id', ignoreDuplicates: true }
    )

  // Fetch sections
  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .eq('test_id', testId)
    .order('display_order', { ascending: true })

  // Fetch questions WITHOUT correct_options — those stay server-side in question_answers
  const { data: questions } = await supabase
    .from('questions')
    .select('id, test_id, section_id, display_order, type, text, options')
    .eq('test_id', testId)
    .order('display_order', { ascending: true })

  return (
    <ExamShell
      test={test as Test}
      sections={(sections ?? []) as Section[]}
      questions={(questions ?? []) as Omit<Question, 'correct_options'>[]}
      userId={session.userId}
    />
  )
}
```

- [ ] **Step 2: Verify exam session is created**

Start dev server. Log in and navigate to a test. Then in the Supabase Dashboard → Table Editor → `exam_sessions`, verify a row was created with the correct `user_id` and `test_id`.

Refresh the exam page and verify the `started_at` timestamp is unchanged (upsert with `ignoreDuplicates: true`).

- [ ] **Step 3: Commit**

```bash
git add app/test/\[testId\]/page.tsx
git commit -m "feat: record exam start time in exam_sessions on page load

Creates an exam session row when the exam page is loaded.
Refresh-safe: ignoreDuplicates:true means the timer does not
reset on page refresh. Used by submit API for server-side
time limit enforcement."
```

---

## Task 9: Update Results Page to Use Admin Client for Correct Options

**Files:**
- Modify: `app/test/[testId]/results/page.tsx`

After the migration, `correct_options` is no longer in the `questions` table. The results page needs to fetch them from `question_answers` via the admin client to compute the score breakdown.

- [ ] **Step 1: Update imports in `results/page.tsx`**

Add:
```typescript
import { createAdminClient } from '@/lib/supabase/admin'
```

- [ ] **Step 2: Replace the questions fetch block**

Find the current questions fetch (around line 47):
```typescript
// BEFORE
const { data: questions } = await supabase
  .from('questions')
  .select('id, test_id, section_id, display_order, type, text, options, correct_options')
  .eq('test_id', testId)
```

Replace with:
```typescript
// AFTER
const adminClient = createAdminClient()

// Fetch questions (no correct_options — moved to question_answers table)
const { data: rawQuestions } = await supabase
  .from('questions')
  .select('id, test_id, section_id, display_order, type, text, options')
  .eq('test_id', testId)

// Fetch correct_options from restricted table via service_role
const { data: questionAnswers } = await adminClient
  .from('question_answers')
  .select('question_id, correct_options')
  .in('question_id', (rawQuestions ?? []).map((q) => q.id))

// Merge for scoring
const qaMap = new Map(
  (questionAnswers ?? []).map((qa) => [qa.question_id, qa.correct_options as number[]])
)
const questions = (rawQuestions ?? []).map((q) => ({
  ...q,
  correct_options: qaMap.get(q.id) ?? [],
}))
```

- [ ] **Step 3: Update the `allQs` assignment that follows**

Find:
```typescript
const allQs = (questions ?? []) as Question[]
```
Replace with:
```typescript
const allQs = questions as Question[]
```
(The nullish coalescing `?? []` is no longer needed since `questions` is always an array after the merge above.)

- [ ] **Step 4: Verify results page renders with correct scores**

Submit a test and navigate to the results page. Confirm:
- Score matches the submission
- Section breakdown shows correct/incorrect/skipped counts
- Leaderboard renders

- [ ] **Step 5: Commit**

```bash
git add app/test/\[testId\]/results/page.tsx
git commit -m "feat: fetch correct_options from question_answers via admin client in results page

correct_options are no longer in the questions table.
Results page now uses service_role to read from question_answers
for score breakdown computation."
```

---

## Task 10: Update Seed Script

**Files:**
- Modify: `scripts/seed-test.ts`

After the migration, `questions` no longer has a `correct_options` column. The seed script must insert question metadata into `questions` and the answer key into `question_answers` separately. The script already uses the service_role key (bypasses RLS), so it can insert into `question_answers`.

- [ ] **Step 1: Update the questions insert in `seed-test.ts`**

Find the `questionsToInsert` block and update it to remove `correct_options`:

```typescript
// BEFORE
const questionsToInsert = sec.questions.map((q, idx) => ({
  test_id: test.id,
  section_id: section.id,
  display_order: idx + 1,
  type: q.type,
  text: q.text,
  options: q.options,
  correct_options: q.correct_options,
}))

const { error: qError } = await supabase
  .from('questions')
  .insert(questionsToInsert)

if (qError) {
  console.error(`❌ Failed to insert questions for "${sec.name}":`, qError.message)
  process.exit(1)
}
```

Replace with:
```typescript
// AFTER
const questionsToInsert = sec.questions.map((q, idx) => ({
  test_id: test.id,
  section_id: section.id,
  display_order: idx + 1,
  type: q.type,
  text: q.text,
  options: q.options,
  // correct_options removed — stored in question_answers
}))

const { data: insertedQuestions, error: qError } = await supabase
  .from('questions')
  .insert(questionsToInsert)
  .select('id')

if (qError || !insertedQuestions) {
  console.error(`❌ Failed to insert questions for "${sec.name}":`, qError?.message)
  process.exit(1)
}

// Insert answer key into restricted table (service_role bypasses RLS)
const questionAnswersToInsert = sec.questions.map((q, idx) => ({
  question_id: insertedQuestions[idx].id,
  correct_options: q.correct_options,
}))

const { error: qaError } = await supabase
  .from('question_answers')
  .insert(questionAnswersToInsert)

if (qaError) {
  console.error(
    `❌ Failed to insert question_answers for "${sec.name}":`,
    qaError.message
  )
  process.exit(1)
}
```

- [ ] **Step 2: Verify the seed script runs end-to-end**

```bash
cd mock-test-platform && npm run seed data/sample-test.json
```

Expected output (no errors):
```
🌱 Seeding: JEE Main Mock Test 1
✅ Test created: <uuid>
  ✅ Section: Physics (30 questions)
  ✅ Section: Chemistry (30 questions)
  ✅ Section: Maths (30 questions)

🎉 Done! Test "JEE Main Mock Test 1" seeded with 90 questions.
```

Verify in Supabase Dashboard:
- `questions` rows exist with no `correct_options` column (after Part B migration)
- `question_answers` rows match the question count

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-test.ts
git commit -m "fix: update seed script to insert into question_answers table

correct_options are no longer a column in questions.
Seed script now inserts questions and answer keys separately,
using the service_role client which can write to question_answers."
```

---

## Task 11: Run Migration Part B and Tighten Login

> **Note:** The `app/actions/auth.ts` changes in this task are superseded by Task 12. Task 12's `verifyOtp` already uses `createAdminClient()` for the user upsert. If executing in order (12 before 11), skip Step 1 of this task and go straight to Steps 2–7 (migration Part B only).

**Files:**
- Modify: `supabase/migration_002_security.sql` (uncomment Part B)
- ~~Modify: `app/actions/auth.ts`~~ ← superseded by Task 12

After the new code is deployed and verified, drop the `correct_options` column and remove the permissive RLS INSERT policies. Task 12's login flow already uses the admin client for the user upsert, enabling removal of the `Anyone can create user` policy.

- [ ] **Step 1: Update login action to use admin client**

In `app/actions/auth.ts`, replace:
```typescript
// BEFORE
import { createClient } from '@/lib/supabase/server'
// ...
const supabase = await createClient()
const { data: user, error } = await supabase
  .from('users')
  .upsert(...)
```

With:
```typescript
// AFTER
import { createAdminClient } from '@/lib/supabase/admin'
// ...
const adminClient = createAdminClient()
const { data: user, error } = await adminClient
  .from('users')
  .upsert(
    { phone, name, email: email || null },
    { onConflict: 'phone', ignoreDuplicates: false }
  )
  .select()
  .single()
```

Full updated `app/actions/auth.ts`:
```typescript
'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSession, deleteSession } from '@/lib/session'
import { z } from 'zod'

const loginSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z
    .string()
    .regex(
      /^\+?[1-9]\d{9,14}$/,
      'Enter a valid phone number (10–15 digits, optional + prefix)'
    ),
  email: z
    .string()
    .email('Enter a valid email address')
    .optional()
    .or(z.literal('')),
})

export async function login(_prevState: unknown, formData: FormData) {
  const raw = {
    name: (formData.get('name') as string)?.trim() ?? '',
    phone: (formData.get('phone') as string)?.trim() ?? '',
    email: (formData.get('email') as string)?.trim() ?? '',
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  const { name, phone, email } = parsed.data

  // Use admin client so the anon INSERT policy on users can be removed
  const adminClient = createAdminClient()
  const { data: user, error } = await adminClient
    .from('users')
    .upsert(
      { phone, name, email: email || null },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (error || !user) {
    return { error: 'Something went wrong. Please try again.' }
  }

  await createSession({ userId: user.id, phone: user.phone, name: user.name })
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
```

- [ ] **Step 2: Verify login still works**

Start dev server. Log in with a valid phone number. Expected: Login succeeds, redirected to dashboard.

- [ ] **Step 3: Commit the login change**

```bash
git add app/actions/auth.ts
git commit -m "fix: use admin client in login action to remove need for anon INSERT policy

Login upsert now uses service_role so the permissive
'Anyone can create user' RLS policy can be safely removed."
```

- [ ] **Step 4: Run Migration Part B in Supabase SQL Editor**

In `supabase/migration_002_security.sql`, uncomment Part B and run only those statements in Supabase Dashboard → SQL Editor:

```sql
-- Drop correct_options from questions
alter table questions drop column if exists correct_options;

-- Remove permissive submissions INSERT policy
drop policy if exists "Anyone can submit" on submissions;

-- Remove permissive users INSERT policy
drop policy if exists "Anyone can create user" on users;
```

- [ ] **Step 5: Verify the app still works after Part B**

- Log in → dashboard should load
- Start a test → exam page should load with questions
- Submit test → results page should show correct scores
- Navigate to results → leaderboard should display

- [ ] **Step 6: Verify direct API calls are now blocked**

In a terminal (replace `<URL>` and `<ANON_KEY>` with values from `.env.local`):

```bash
# This should now return empty results (no correct_options column) or an error
curl -s \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  "<SUPABASE_URL>/rest/v1/questions?select=id,correct_options&limit=1"
```
Expected: Error response (column does not exist) or empty `correct_options` field.

```bash
# This should return 401 or empty (no INSERT policy for anon)
curl -s -X POST \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000001","test_id":"00000000-0000-0000-0000-000000000002","answers":{},"score":999}' \
  "<SUPABASE_URL>/rest/v1/submissions"
```
Expected: `{"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"submissions\""}` (RLS blocks it).

- [ ] **Step 7: Final commit**

```bash
git add supabase/migration_002_security.sql
git commit -m "fix: run migration Part B — drop correct_options column and tighten RLS

Drops questions.correct_options (now in question_answers).
Removes 'Anyone can submit' and 'Anyone can create user' RLS
INSERT policies. Server uses service_role for all writes."
```

---

---

## Task 12: Email OTP Verification at Login (Addresses Finding #2)

**Files:**
- Modify: `middleware.ts` — add `/verify` to PUBLIC_PATHS
- Modify: `lib/session.ts` — add pending login cookie helpers
- Modify: `app/actions/auth.ts` — **full rewrite**: `sendOtp` + `verifyOtp` + `logout` (supersedes Task 4 and Task 11 auth.ts changes)
- Modify: `components/LoginForm.tsx` — make email required, point to `sendOtp`
- Modify: `app/page.tsx` — update footer copy
- Create: `components/OtpForm.tsx` — OTP input client component
- Create: `app/verify/page.tsx` — OTP verification server page

**How the flow works:**
1. User fills name + phone + email on `/` → `sendOtp` validates inputs, calls `supabase.auth.signInWithOtp({ email })`, stores `{ name, phone, email }` in a 15-minute signed JWT cookie (`pending_login`), redirects to `/verify`
2. User enters the 6-digit code on `/verify` → `verifyOtp` reads the pending cookie, calls `supabase.auth.verifyOtp(...)`, upserts user in custom `users` table via admin client, creates custom session, deletes pending cookie, redirects to `/dashboard`

The custom session system is unchanged — Supabase Email OTP is used only as the verification gate. A Supabase Auth user is created as a side effect (harmless; separate from the custom `users` table).

---

- [ ] **Step 1: Add `/verify` to PUBLIC_PATHS in `middleware.ts`**

```typescript
// BEFORE
const PUBLIC_PATHS = new Set(['/', '/favicon.ico'])

// AFTER
const PUBLIC_PATHS = new Set(['/', '/verify', '/favicon.ico'])
```

- [ ] **Step 2: Add pending login helpers to `lib/session.ts`**

Append to the end of `lib/session.ts` (after the `deleteSession` function):

```typescript
// ─── Pending login cookie ──────────────────────────────────────────────────
// Carries { name, phone, email } between the login form and OTP verify step.
// Signed with SESSION_SECRET; expires in 15 minutes.

const PENDING_LOGIN_COOKIE = 'pending_login'

export interface PendingLoginPayload {
  name: string
  phone: string
  email: string
}

export async function createPendingLogin(data: PendingLoginPayload) {
  const token = await new SignJWT(data as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(encodedKey)

  const cookieStore = await cookies()
  cookieStore.set(PENDING_LOGIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 15 * 60,
    path: '/',
  })
}

export async function getPendingLogin(): Promise<PendingLoginPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(PENDING_LOGIN_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ['HS256'] })
    return payload as unknown as PendingLoginPayload
  } catch {
    return null
  }
}

export async function deletePendingLogin() {
  const cookieStore = await cookies()
  cookieStore.delete(PENDING_LOGIN_COOKIE)
}
```

- [ ] **Step 3: Rewrite `app/actions/auth.ts`**

Complete file replacement:

```typescript
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  createSession,
  deleteSession,
  createPendingLogin,
  getPendingLogin,
  deletePendingLogin,
} from '@/lib/session'
import { z } from 'zod'

const loginSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  phone: z.string().regex(
    /^\+?[1-9]\d{9,14}$/,
    'Enter a valid phone number (10–15 digits, optional + prefix)'
  ),
  email: z.string().email('Enter a valid email address'),
})

const otpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
})

// Step 1: validate inputs, send OTP email, store pending data in cookie
export async function sendOtp(_prevState: unknown, formData: FormData) {
  const raw = {
    name: (formData.get('name') as string)?.trim() ?? '',
    phone: (formData.get('phone') as string)?.trim() ?? '',
    email: (formData.get('email') as string)?.trim() ?? '',
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  const { name, phone, email } = parsed.data
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  })

  if (error) {
    if (error.status === 429) {
      return { error: 'Too many attempts. Please wait a few minutes and try again.' }
    }
    return { error: 'Failed to send verification code. Please try again.' }
  }

  await createPendingLogin({ name, phone, email })
  redirect('/verify')
}

// Step 2: verify the OTP, upsert user, create custom session
export async function verifyOtp(_prevState: unknown, formData: FormData) {
  const pending = await getPendingLogin()
  if (!pending) redirect('/') // cookie expired — restart

  const raw = { otp: (formData.get('otp') as string)?.trim() ?? '' }
  const parsed = otpSchema.safeParse(raw)
  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  const { email, name, phone } = pending
  const supabase = await createClient()

  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: parsed.data.otp,
    type: 'email',
  })

  if (verifyError) {
    return { error: 'Invalid or expired code. Check your email and try again.' }
  }

  // OTP verified — upsert user in custom table via admin client
  const adminClient = createAdminClient()
  const { data: user, error: upsertError } = await adminClient
    .from('users')
    .upsert(
      { phone, name, email },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select()
    .single()

  if (upsertError || !user) {
    return { error: 'Something went wrong. Please try again.' }
  }

  await createSession({ userId: user.id, phone: user.phone, name: user.name })
  await deletePendingLogin()
  redirect('/dashboard')
}

export async function logout() {
  await deleteSession()
  redirect('/')
}
```

- [ ] **Step 4: Update `components/LoginForm.tsx`**

Complete file replacement:

```tsx
'use client'

import { useActionState } from 'react'
import { sendOtp } from '@/app/actions/auth'

type FormState = { error?: string } | undefined

export default function LoginForm() {
  const [state, action, pending] = useActionState(sendOtp, undefined)

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Your Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="e.g. Rohan Chadha"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Phone Number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="+91 98765 43210"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="your@email.com"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#00AD33] text-white font-semibold rounded-full py-2.5 text-sm hover:bg-[#009929] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
      >
        {pending ? 'Sending code…' : 'Send Verification Code →'}
      </button>
    </form>
  )
}
```

- [ ] **Step 5: Update footer copy in `app/page.tsx`**

Line 27 — change:
```tsx
{/* BEFORE */}
<p className="text-xs text-[#CACACA] mt-4">
  No password needed · Your phone number identifies you
</p>
```
To:
```tsx
{/* AFTER */}
<p className="text-xs text-[#CACACA] mt-4">
  A one-time code will be sent to your email
</p>
```

- [ ] **Step 6: Create `components/OtpForm.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { verifyOtp } from '@/app/actions/auth'

type FormState = { error?: string } | undefined

interface Props {
  maskedEmail: string
}

export default function OtpForm({ maskedEmail }: Props) {
  const [state, action, pending] = useActionState(verifyOtp, undefined)

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-[#8A8A8A]">
        We sent a 6-digit code to{' '}
        <span className="font-semibold text-[#2F1238]">{maskedEmail}</span>.
        Enter it below.
      </p>

      <div>
        <label htmlFor="otp" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Verification Code
        </label>
        <input
          id="otp"
          name="otp"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          className="w-full bg-white text-[#2F1238] border border-[#CACACA] rounded px-3 py-2 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#00AD33] text-white font-semibold rounded-full py-2.5 text-sm hover:bg-[#009929] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Verifying…' : 'Verify & Continue →'}
      </button>

      <p className="text-xs text-center text-[#CACACA]">
        Wrong email?{' '}
        <a href="/" className="text-[#2F1238] underline">
          Go back
        </a>
      </p>
    </form>
  )
}
```

- [ ] **Step 7: Create `app/verify/page.tsx`**

```tsx
import { getPendingLogin } from '@/lib/session'
import { redirect } from 'next/navigation'
import OtpForm from '@/components/OtpForm'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2)
  return `${visible}***@${domain}`
}

export default async function VerifyPage() {
  const pending = await getPendingLogin()
  if (!pending) redirect('/') // no pending login — restart

  return (
    <main className="min-h-screen bg-[#F8F8F9] flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <img src="/logo.svg" alt="Shiksha" width={40} height={40} />
          <h1 className="text-2xl font-bold text-[#2F1238]">Shiksha</h1>
        </div>
        <p className="text-sm text-[#8A8A8A] mt-1">Check your email</p>
      </div>

      <div className="bg-white border border-[#E0E0E0] rounded-sm shadow-sm w-full max-w-sm p-7">
        <h2 className="text-base font-bold text-[#2F1238] mb-5">Enter Verification Code</h2>
        <OtpForm maskedEmail={maskEmail(pending.email)} />
      </div>

      <p className="text-xs text-[#CACACA] mt-4">Code expires in 10 minutes</p>
    </main>
  )
}
```

- [ ] **Step 8: Verify the full login flow end-to-end**

```bash
cd mock-test-platform && npm run dev
```

**Happy path:**
1. Go to `http://localhost:3000`
2. Enter name, valid phone, and your real email address
3. Click "Send Verification Code" → expected: redirect to `/verify` showing `ro***@yourdomain.com`
4. Check inbox for a 6-digit code from Supabase (subject: "Your OTP" or similar)
5. Enter the code → expected: redirect to `/dashboard`

**Error paths to verify manually:**
- Invalid phone on login form → `"Enter a valid phone number..."`
- Invalid email on login form → `"Enter a valid email address"`
- Wrong 6-digit code on verify page → `"Invalid or expired code..."`
- Navigate to `/verify` without first submitting the login form → redirect to `/`
- Try to access `/dashboard` without a session → redirect to `/`

- [ ] **Step 9: Commit**

```bash
git add middleware.ts lib/session.ts app/actions/auth.ts \
  components/LoginForm.tsx components/OtpForm.tsx \
  app/verify/page.tsx app/page.tsx
git commit -m "feat: add email OTP verification at login (Finding #2)

Login now requires a valid email. sendOtp calls Supabase
Email Auth to dispatch a 6-digit code; verifyOtp checks it
before issuing a custom session. Pending login state is
stored in a 15-minute signed JWT cookie between steps.

Email is now a required field (was optional). LoginForm
updated to call sendOtp. New /verify page with OtpForm
component handles the verification step."
```

---

## Self-Review Against Audit Findings

| Finding | Severity | Addressed? | Task |
|---------|----------|-----------|------|
| #1 — Live credentials in .env.local | CRITICAL | ⚠️ Prerequisites (manual key rotation) | Pre-req |
| #2 — Zero-factor auth | CRITICAL | ✅ Email OTP via Supabase Auth | Task 12 |
| #3 — correct_options readable via anon key | HIGH | ✅ | Tasks 6, 7, 9, 10 |
| #4 — Middleware is dead code | HIGH | ✅ | Task 1 |
| #5 — Client-side only timer | HIGH | ✅ | Tasks 6, 7, 8 |
| #6 — RLS WITH CHECK (true) allows user_id spoofing | HIGH | ✅ | Tasks 5, 7, 11 |
| #7 — No rate limiting | MEDIUM | ⚠️ Out of scope (requires Redis) | — |
| #8 — SESSION_SECRET fails silently | MEDIUM | ✅ | Task 2 |
| #9 — No schema validation | MEDIUM | ✅ | Tasks 4, 12 |
| #10 — Phone PII in leaderboard | LOW | ✅ | Task 3 |
