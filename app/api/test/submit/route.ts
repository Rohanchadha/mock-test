import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { scoreSubmission } from '@/lib/scoring'
import type { Question } from '@/lib/types'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { testId, answers } = body as {
    testId: string
    answers: Record<string, number[]>
  }

  if (!testId || !answers) {
    return NextResponse.json({ error: 'Missing testId or answers' }, { status: 400 })
  }

  const supabase = await createClient()

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

  // Fetch all questions with correct_options for scoring (server-side only)
  const { data: questions, error: qError } = await supabase
    .from('questions')
    .select('id, test_id, section_id, display_order, type, text, options, correct_options')
    .eq('test_id', testId)

  if (qError || !questions) {
    return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
  }

  // Calculate score
  const { total } = scoreSubmission(questions as Question[], answers)

  // Insert submission
  const { error: insertError } = await supabase.from('submissions').insert({
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
