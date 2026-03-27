import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
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
    />
  )
}
