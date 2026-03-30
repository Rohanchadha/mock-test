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
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { testId, answers } = parsed.data
  const supabase = await createClient()
  const adminClient = createAdminClient()

  // Check for existing submission (prevent double-submit)
  const { data: existing, error: existingError } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existingError) {
    return NextResponse.json({ error: 'Failed to check submission status' }, { status: 500 })
  }

  if (existing) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
  }

  // Server-side timer: verify an exam session exists and time hasn't expired
  const { data: examSession, error: sessionError } = await adminClient
    .from('exam_sessions')
    .select('started_at')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (sessionError) {
    return NextResponse.json({ error: 'Failed to verify exam session' }, { status: 500 })
  }

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

  // started_at is timestamptz — Supabase returns ISO 8601 UTC (e.g. "2026-03-30T10:00:00+00:00")
  // new Date() correctly parses this as UTC; the 60-second grace covers any NTP clock drift
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

  // Filter answers to only question IDs belonging to this test
  const validQuestionIds = new Set(questions.map((q) => q.id))
  const filteredAnswers = Object.fromEntries(
    Object.entries(answers).filter(([id]) => validQuestionIds.has(id))
  )

  const { total } = scoreSubmission(questionsWithAnswers as Question[], filteredAnswers)

  // Insert using service_role client — does not require anon INSERT policy
  const { error: insertError } = await adminClient.from('submissions').insert({
    user_id: session.userId,
    test_id: testId,
    answers: filteredAnswers,
    score: total,
  })

  if (insertError) {
    return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
  }

  return NextResponse.json({ score: total })
}
