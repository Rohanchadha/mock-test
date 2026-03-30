export interface Test {
  id: string
  name: string
  duration_mins: number
  is_visible: boolean
  created_at: string
}

export interface Section {
  id: string
  test_id: string
  name: string
  display_order: number
  question_count: number
}

export interface Question {
  id: string
  test_id: string
  section_id: string
  display_order: number
  type: 'SCQ' | 'MCQ'
  text: string
  options: string[]
  correct_options: number[]
}

export interface Submission {
  id: string
  user_id: string
  test_id: string
  answers: Record<string, number[]>
  score: number
  submitted_at: string
}

export interface LeaderboardEntry {
  rank: number
  user_id: string
  name: string
  score: number
  submitted_at: string
}

// Question status in the exam UI
export type QuestionStatus =
  | 'not_visited'
  | 'not_answered'
  | 'answered'
  | 'review'
