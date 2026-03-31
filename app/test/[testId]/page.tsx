import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import type { Test, Section, Question, QuestionStatus } from '@/lib/types'
import ExamShell from '@/components/ExamShell'
import { autoSubmitIfExpired } from '@/lib/auto-submit'

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

  // Fetch exam session to calculate remaining time
  const { data: examSession } = await adminClient
    .from('exam_sessions')
    .select('started_at')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .single()

  const elapsedSeconds = examSession
    ? (Date.now() - new Date(examSession.started_at).getTime()) / 1000
    : 0
  const totalSeconds = (test as Test).duration_mins * 60
  const remainingSeconds = Math.max(0, Math.floor(totalSeconds - elapsedSeconds))

  // If time has expired, auto-submit with whatever progress exists and redirect
  if (remainingSeconds === 0) {
    await autoSubmitIfExpired(session.userId, testId)
    redirect(`/test/${testId}/results`)
  }

  // Fetch saved progress (if resuming)
  const { data: progress } = await adminClient
    .from('exam_progress')
    .select('answers, statuses, active_section_id, active_question_id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  // Fetch sections
  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .eq('test_id', testId)
    .order('display_order', { ascending: true })

  // Fetch questions (without correct_options — those stay server-side only)
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
      initialAnswers={progress?.answers as Record<string, number[]> | undefined}
      initialStatuses={progress?.statuses as Record<string, QuestionStatus> | undefined}
      initialSectionId={progress?.active_section_id as string | undefined}
      initialQuestionId={progress?.active_question_id as string | undefined}
      initialSecondsLeft={remainingSeconds}
    />
  )
}
