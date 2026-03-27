import type { Question } from './types'

/**
 * Score a single question answer.
 * SCQ/MCQ: +4 if all correct options selected (and no extras), -1 if any wrong, 0 if unanswered.
 */
export function scoreQuestion(
  question: Question,
  selected: number[]
): number {
  if (selected.length === 0) return 0

  const correct = new Set(question.correct_options)
  const chosen = new Set(selected)

  // Check for any wrong selections
  for (const idx of chosen) {
    if (!correct.has(idx)) return -1
  }

  // Check all correct options are selected
  for (const idx of correct) {
    if (!chosen.has(idx)) return -1
  }

  return 4
}

/**
 * Score all answers for a test.
 * Returns total score and per-question breakdown.
 */
export function scoreSubmission(
  questions: Question[],
  answers: Record<string, number[]>
): { total: number; breakdown: Record<string, number> } {
  let total = 0
  const breakdown: Record<string, number> = {}

  for (const q of questions) {
    const selected = answers[q.id] ?? []
    const pts = scoreQuestion(q, selected)
    breakdown[q.id] = pts
    total += pts
  }

  return { total, breakdown }
}

/**
 * Calculate percentile: percentage of submissions scoring strictly less than this score.
 */
export function calcPercentile(score: number, allScores: number[]): number {
  if (allScores.length === 0) return 100
  const below = allScores.filter((s) => s < score).length
  return Math.round((below / allScores.length) * 100 * 10) / 10
}
