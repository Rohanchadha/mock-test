import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { scoreSubmission } from '@/lib/scoring'
import type { Question } from '@/lib/types'

/**
 * Auto-submit all expired exams for a given user.
 * Checks exam_sessions where time has elapsed and no submission exists.
 * If saved progress exists, scores it; otherwise submits with score 0.
 * Cleans up exam_progress rows after submission.
 *
 * Call from dashboard page load and test page load for "lazy" auto-submit.
 */
export async function autoSubmitExpiredExams(userId: string): Promise<void> {
  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Fetch all exam sessions for this user
  const { data: sessions } = await adminClient
    .from('exam_sessions')
    .select('user_id, test_id, started_at')
    .eq('user_id', userId)

  if (!sessions || sessions.length === 0) return

  // Fetch existing submissions for this user
  const { data: existingSubmissions } = await supabase
    .from('submissions')
    .select('test_id')
    .eq('user_id', userId)

  const submittedTestIds = new Set(
    (existingSubmissions ?? []).map((s: { test_id: string }) => s.test_id)
  )

  // Fetch test durations for all session test IDs
  const sessionTestIds = sessions.map((s) => s.test_id)
  const { data: tests } = await supabase
    .from('tests')
    .select('id, duration_mins')
    .in('id', sessionTestIds)

  if (!tests) return

  const testDurationMap = new Map(tests.map((t) => [t.id, t.duration_mins as number]))

  // Find expired sessions without submissions
  const now = Date.now()
  const expiredSessions = sessions.filter((s) => {
    if (submittedTestIds.has(s.test_id)) return false
    const duration = testDurationMap.get(s.test_id)
    if (duration === undefined) return false
    const elapsedSeconds = (now - new Date(s.started_at).getTime()) / 1000
    return elapsedSeconds > duration * 60
  })

  if (expiredSessions.length === 0) return

  // Fetch saved progress for expired sessions
  const expiredTestIds = expiredSessions.map((s) => s.test_id)
  const { data: progressRows } = await adminClient
    .from('exam_progress')
    .select('user_id, test_id, answers')
    .eq('user_id', userId)
    .in('test_id', expiredTestIds)

  const progressMap = new Map(
    (progressRows ?? []).map((p: { test_id: string; answers: Record<string, number[]> }) => [
      p.test_id,
      p.answers,
    ])
  )

  for (const session of expiredSessions) {
    const savedAnswers = progressMap.get(session.test_id) ?? {}

    // Fetch questions for this test
    const { data: questions } = await supabase
      .from('questions')
      .select('id, test_id, section_id, display_order, type, text, options')
      .eq('test_id', session.test_id)

    if (!questions || questions.length === 0) continue

    // Fetch correct_options via admin client
    const { data: questionAnswers } = await adminClient
      .from('question_answers')
      .select('question_id, correct_options')
      .in(
        'question_id',
        questions.map((q) => q.id)
      )

    if (!questionAnswers) continue

    // Merge correct_options into questions for scoring
    const answerMap = new Map(
      questionAnswers.map((qa: { question_id: string; correct_options: number[] }) => [
        qa.question_id,
        qa.correct_options,
      ])
    )
    const questionsWithAnswers = questions.map((q) => ({
      ...q,
      correct_options: answerMap.get(q.id) ?? [],
    }))

    // Filter answers to valid question IDs
    const validQuestionIds = new Set(questions.map((q) => q.id))
    const filteredAnswers = Object.fromEntries(
      Object.entries(savedAnswers).filter(([id]) => validQuestionIds.has(id))
    )

    const { total } = scoreSubmission(questionsWithAnswers as Question[], filteredAnswers)

    // Insert submission
    await adminClient.from('submissions').insert({
      user_id: userId,
      test_id: session.test_id,
      answers: filteredAnswers,
      score: total,
    })

    // Clean up progress
    await adminClient
      .from('exam_progress')
      .delete()
      .eq('user_id', userId)
      .eq('test_id', session.test_id)
  }
}

/**
 * Auto-submit a single expired exam for a specific test.
 * Returns true if a submission was created, false otherwise.
 */
export async function autoSubmitIfExpired(
  userId: string,
  testId: string
): Promise<boolean> {
  const adminClient = createAdminClient()
  const supabase = await createClient()

  // Check if already submitted
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existing) return false

  // Fetch exam session
  const { data: examSession } = await adminClient
    .from('exam_sessions')
    .select('started_at')
    .eq('user_id', userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (!examSession) return false

  // Fetch test duration
  const { data: test } = await supabase
    .from('tests')
    .select('duration_mins')
    .eq('id', testId)
    .maybeSingle()

  if (!test) return false

  const elapsedSeconds =
    (Date.now() - new Date(examSession.started_at).getTime()) / 1000
  if (elapsedSeconds <= test.duration_mins * 60) return false

  // Time expired — fetch progress and score
  const { data: progress } = await adminClient
    .from('exam_progress')
    .select('answers')
    .eq('user_id', userId)
    .eq('test_id', testId)
    .maybeSingle()

  const savedAnswers = (progress?.answers as Record<string, number[]>) ?? {}

  // Fetch questions
  const { data: questions } = await supabase
    .from('questions')
    .select('id, test_id, section_id, display_order, type, text, options')
    .eq('test_id', testId)

  if (!questions || questions.length === 0) return false

  const { data: questionAnswers } = await adminClient
    .from('question_answers')
    .select('question_id, correct_options')
    .in(
      'question_id',
      questions.map((q) => q.id)
    )

  if (!questionAnswers) return false

  const answerMap = new Map(
    questionAnswers.map((qa: { question_id: string; correct_options: number[] }) => [
      qa.question_id,
      qa.correct_options,
    ])
  )
  const questionsWithAnswers = questions.map((q) => ({
    ...q,
    correct_options: answerMap.get(q.id) ?? [],
  }))

  const validQuestionIds = new Set(questions.map((q) => q.id))
  const filteredAnswers = Object.fromEntries(
    Object.entries(savedAnswers).filter(([id]) => validQuestionIds.has(id))
  )

  const { total } = scoreSubmission(questionsWithAnswers as Question[], filteredAnswers)

  const { error } = await adminClient.from('submissions').insert({
    user_id: userId,
    test_id: testId,
    answers: filteredAnswers,
    score: total,
  })

  if (error) return false

  // Clean up progress
  await adminClient
    .from('exam_progress')
    .delete()
    .eq('user_id', userId)
    .eq('test_id', testId)

  return true
}
