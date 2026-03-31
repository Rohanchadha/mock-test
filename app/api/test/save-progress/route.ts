import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/session'
import { z } from 'zod'

const progressSchema = z.object({
  testId: z.string().uuid(),
  answers: z.record(z.string().uuid(), z.array(z.number().int().min(0))),
  statuses: z.record(z.string().uuid(), z.string()),
  activeSectionId: z.string().uuid().optional(),
  activeQuestionId: z.string().uuid().optional(),
})

async function parseBody(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''
  // navigator.sendBeacon sends as text/plain when using Blob
  if (contentType.includes('text/plain')) {
    const text = await request.text()
    return JSON.parse(text)
  }
  return request.json()
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await parseBody(request)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const parsed = progressSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { testId, answers, statuses, activeSectionId, activeQuestionId } = parsed.data
  const supabase = await createClient()
  const adminClient = createAdminClient()

  // Don't overwrite a submitted test
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'Already submitted' }, { status: 409 })
  }

  // Verify exam session exists and time hasn't fully expired (with grace)
  const { data: examSession } = await adminClient
    .from('exam_sessions')
    .select('started_at')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (!examSession) {
    return NextResponse.json({ error: 'No active exam session' }, { status: 403 })
  }

  const { data: test } = await supabase
    .from('tests')
    .select('duration_mins')
    .eq('id', testId)
    .maybeSingle()

  if (!test) {
    return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  }

  const elapsedSeconds =
    (Date.now() - new Date(examSession.started_at).getTime()) / 1000
  // Allow saving up to 2 minutes past expiry (grace for in-flight saves)
  const allowedSeconds = test.duration_mins * 60 + 120

  if (elapsedSeconds > allowedSeconds) {
    return NextResponse.json({ error: 'Exam time has expired' }, { status: 403 })
  }

  // Upsert progress — single DB call
  const { error: upsertError } = await adminClient
    .from('exam_progress')
    .upsert(
      {
        user_id: session.userId,
        test_id: testId,
        answers,
        statuses,
        active_section_id: activeSectionId ?? null,
        active_question_id: activeQuestionId ?? null,
        last_saved_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,test_id' }
    )

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to save progress' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
