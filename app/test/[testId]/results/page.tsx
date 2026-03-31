import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { scoreSubmission } from '@/lib/scoring'
import type { Question, Section, Submission } from '@/lib/types'
import Link from 'next/link'

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ testId: string }>
}) {
  const { testId } = await params
  const session = await getSession()
  if (!session) redirect('/')

  const supabase = await createClient()

  // Fetch current user's submission
  const { data: mySubmission } = await supabase
    .from('submissions')
    .select('*')
    .eq('user_id', session.userId)
    .eq('test_id', testId)
    .single()

  if (!mySubmission) redirect(`/test/${testId}`)

  // Fetch questions + sections for breakdown
  const adminClient = createAdminClient()

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

  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .eq('test_id', testId)
    .order('display_order', { ascending: true })

  // Score breakdown per section
  const myAnswers = (mySubmission as Submission).answers ?? {}
  const allQs = questions as Question[]
  const { breakdown } = scoreSubmission(allQs, myAnswers)

  const sectionBreakdown = (sections ?? []).map((sec: Section) => {
    const secQs = allQs.filter((q) => q.section_id === sec.id)
    let correct = 0, incorrect = 0, skipped = 0, sectionScore = 0
    for (const q of secQs) {
      const pts = breakdown[q.id] ?? 0
      if (pts === 4) correct++
      else if (pts === -1) incorrect++
      else skipped++
      sectionScore += pts
    }
    return { ...sec, correct, incorrect, skipped, sectionScore }
  })

  // Answer stats
  const totalCorrect = allQs.filter((q) => breakdown[q.id] === 4).length
  const totalIncorrect = allQs.filter((q) => breakdown[q.id] === -1).length
  const totalSkipped = allQs.filter((q) => (breakdown[q.id] ?? 0) === 0 && (myAnswers[q.id] ?? []).length === 0).length

  const maxScore = allQs.length * 4

  return (
    <div className="min-h-screen bg-[#F8F8F9]">
      {/* Header */}
      <header className="bg-[#2F1238] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Shiksha" width={24} height={24} />
          <span className="text-white font-bold text-sm">Shiksha</span>
        </div>
        <Link href="/dashboard" className="text-white/60 text-xs hover:text-white transition-colors">
          ← Back to Dashboard
        </Link>
      </header>

      {/* Score hero */}
      <div className="bg-[#2F1238] pb-8 px-4 text-center">
        <p className="text-white/50 text-xs uppercase tracking-widest mb-2 pt-2">Your Score</p>
        <p className="text-5xl font-black text-white leading-none">
          {(mySubmission as Submission).score}
          <span className="text-xl font-normal text-white/40"> / {maxScore}</span>
        </p>
        <div className="flex justify-center gap-8 mt-5">
          {[
            { val: totalCorrect, label: 'Correct', color: 'text-[#00AD33]' },
            { val: totalIncorrect, label: 'Incorrect', color: 'text-red-400' },
            { val: totalSkipped, label: 'Skipped', color: 'text-white/40' },
          ].map(({ val, label, color }) => (
            <div key={label} className="text-center">
              <p className={`text-xl font-bold ${color}`}>{val}</p>
              <p className="text-xs text-white/40 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Section breakdown */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#CACACA] mb-3">
            Section Breakdown
          </p>
          <div className="grid grid-cols-3 gap-3">
            {sectionBreakdown.map((sec) => (
              <div
                key={sec.id}
                className="bg-white border border-[#E0E0E0] rounded-sm p-4 text-center"
              >
                <p className="text-sm font-bold text-[#2F1238] mb-2">{sec.name}</p>
                <p className="text-2xl font-black text-[#2F1238]">{sec.sectionScore}</p>
                <p className="text-xs text-[#888] mt-1">
                  {sec.correct} Correct · {sec.incorrect} Wrong · {sec.skipped} Skipped
                </p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/dashboard"
          className="inline-block bg-[#2F1238] text-white font-semibold rounded-full px-6 py-2.5 text-sm hover:bg-[#3d1a4a] transition-colors"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
