import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Test, Section } from '@/lib/types'
import InstructionsConfirm from '@/components/InstructionsConfirm'
import Link from 'next/link'

export default async function InstructionsPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const session = await getSession()
  if (!session) redirect('/')

  const supabase = await createClient()

  // If already submitted, send straight to results
  const { data: existing } = await supabase
    .from('submissions')
    .select('id')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .maybeSingle()

  if (existing) redirect(`/test/${testId}/results`)

  const { data: test } = await supabase
    .from('tests')
    .select('*')
    .eq('id', testId)
    .eq('is_visible', true)
    .single()

  if (!test) redirect('/dashboard')

  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .eq('test_id', testId)
    .order('display_order', { ascending: true })

  const typedTest = test as Test
  const typedSections = (sections ?? []) as Section[]
  const totalQuestions = typedSections.reduce((s, sec) => s + sec.question_count, 0)

  return (
    <div className="min-h-screen bg-[#F8F8F9]">
      {/* Header */}
      <header className="bg-[#2F1238] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Shiksha" width={28} height={28} />
          <span className="text-white font-bold text-sm">Shiksha</span>
        </div>
        <Link
          href="/dashboard"
          className="text-white/60 text-xs hover:text-white transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* Test overview */}
        <h1 className="text-lg font-bold text-[#2F1238]">{typedTest.name}</h1>
        <div className="flex gap-2 mt-2 mb-6">
          <span className="text-xs bg-white border border-[#E0E0E0] text-[#666] px-2 py-0.5 rounded">
            ⏱ {typedTest.duration_mins} min
          </span>
          <span className="text-xs bg-white border border-[#E0E0E0] text-[#666] px-2 py-0.5 rounded">
            {totalQuestions} questions
          </span>
          <span className="text-xs bg-white border border-[#E0E0E0] text-[#666] px-2 py-0.5 rounded">
            {typedSections.map(s => s.name).join(' · ')}
          </span>
        </div>

        {/* Instructions card */}
        <div className="bg-white border border-[#E0E0E0] rounded-sm shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-[#2F1238] mb-3">Marking Scheme</h2>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <p className="font-bold text-green-700 text-base">+4</p>
                <p className="text-green-600 mt-0.5">Correct</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded p-2">
                <p className="font-bold text-red-700 text-base">−1</p>
                <p className="text-red-600 mt-0.5">Incorrect</p>
              </div>
              <div className="bg-[#F8F8F9] border border-[#E0E0E0] rounded p-2">
                <p className="font-bold text-[#666] text-base">0</p>
                <p className="text-[#8A8A8A] mt-0.5">Unattempted</p>
              </div>
            </div>
          </div>

          <hr className="border-[#F0F0F0]" />

          <div>
            <h2 className="text-sm font-bold text-[#2F1238] mb-3">General Instructions</h2>
            <ul className="space-y-2 text-xs text-[#555]">
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">1.</span>
                <span>The timer starts as soon as you click <strong>Start Test</strong>. It cannot be paused.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">2.</span>
                <span>You can navigate between questions and sections freely during the test.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">3.</span>
                <span>Use <strong>Save &amp; Next</strong> to record your answer before moving on. Unsaved answers will not be submitted.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">4.</span>
                <span>Use <strong>Mark for Review</strong> to flag questions you want to revisit. Marked questions with a saved answer will still be submitted.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">5.</span>
                <span>Some questions may be <strong>Multiple Correct (MCQ)</strong> — select all correct options. Partial credit is not awarded.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">6.</span>
                <span>The test auto-submits when the timer expires. Submit manually before time runs out to avoid any last-second issues.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2F1238] font-bold mt-0.5">7.</span>
                <span>Do not refresh the page mid-test. Your answers are saved in memory and a refresh will not reset the timer, but unsaved answers may be lost.</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Confirm + Start */}
        <InstructionsConfirm testId={testId} />
      </main>
    </div>
  )
}
