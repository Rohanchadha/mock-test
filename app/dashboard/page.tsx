import { getSession } from '@/lib/session'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Test, Section, Submission } from '@/lib/types'
import LogoutButton from '@/components/LogoutButton'
import Link from 'next/link'

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) redirect('/')

  const supabase = await createClient()

  // Fetch visible tests
  const { data: tests } = await supabase
    .from('tests')
    .select('*')
    .eq('is_visible', true)
    .order('created_at', { ascending: true })

  // Fetch sections for all visible tests
  const testIds = (tests ?? []).map((t: Test) => t.id)
  const { data: sections } = await supabase
    .from('sections')
    .select('*')
    .in('test_id', testIds.length ? testIds : ['none'])
    .order('display_order', { ascending: true })

  // Fetch user's submissions to know which tests are already done
  const { data: submissions } = await supabase
    .from('submissions')
    .select('test_id')
    .eq('user_id', session.userId)

  const submittedTestIds = new Set((submissions ?? []).map((s: Pick<Submission, 'test_id'>) => s.test_id))

  // Group sections by test
  const sectionsByTest: Record<string, Section[]> = {}
  for (const sec of sections ?? []) {
    if (!sectionsByTest[sec.test_id]) sectionsByTest[sec.test_id] = []
    sectionsByTest[sec.test_id].push(sec)
  }

  return (
    <div className="min-h-screen bg-[#F8F8F9]">
      {/* Header */}
      <header className="bg-[#2F1238] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Shiksha" width={28} height={28} />
          <span className="text-white font-bold text-sm">Shiksha</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-white/60 text-xs">{session.phone}</span>
          <LogoutButton />
        </div>
      </header>

      {/* Body */}
      <main className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-lg font-bold text-[#2F1238]">Hey, {session.name}!</h1>
        <p className="text-sm text-[#8A8A8A] mt-0.5 mb-6">Ready to practice? Pick a test below.</p>

        <p className="text-xs font-bold uppercase tracking-widest text-[#CACACA] mb-3">Available Tests</p>

        {(tests ?? []).length === 0 && (
          <p className="text-sm text-[#8A8A8A]">No tests available right now. Check back soon.</p>
        )}

        <div className="space-y-3">
          {(tests ?? []).map((test: Test) => {
            const testSections = sectionsByTest[test.id] ?? []
            const totalQuestions = testSections.reduce((s: number, sec: Section) => s + sec.question_count, 0)
            const alreadySubmitted = submittedTestIds.has(test.id)

            return (
              <div
                key={test.id}
                className="bg-white border border-[#E0E0E0] rounded-sm p-4 flex items-center justify-between gap-4"
              >
                <div>
                  <p className="text-sm font-bold text-[#2F1238]">{test.name}</p>
                  <p className="text-xs text-[#8A8A8A] mt-0.5">
                    {testSections.map((s: Section) => s.name).join(' · ')}
                  </p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs bg-[#F8F8F9] border border-[#E0E0E0] text-[#666] px-2 py-0.5 rounded">
                      ⏱ {test.duration_mins} min
                    </span>
                    <span className="text-xs bg-[#F8F8F9] border border-[#E0E0E0] text-[#666] px-2 py-0.5 rounded">
                      {totalQuestions} questions
                    </span>
                  </div>
                </div>

                {alreadySubmitted ? (
                  <Link
                    href={`/test/${test.id}/results`}
                    className="bg-[#2F1238] text-white text-xs font-semibold rounded-full px-4 py-2 whitespace-nowrap hover:bg-[#3d1a4a] transition-colors"
                  >
                    View Results
                  </Link>
                ) : (
                  <Link
                    href={`/test/${test.id}/instructions`}
                    className="bg-[#00AD33] text-white text-xs font-semibold rounded-full px-4 py-2 whitespace-nowrap hover:bg-[#009929] transition-colors"
                  >
                    Start →
                  </Link>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
