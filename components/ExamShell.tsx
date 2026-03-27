'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Test, Section, QuestionStatus } from '@/lib/types'
import MathText from './MathText'

type QuestionClient = {
  id: string
  test_id: string
  section_id: string
  display_order: number
  type: 'SCQ' | 'MCQ'
  text: string
  options: string[]
}

interface Props {
  test: Test
  sections: Section[]
  questions: QuestionClient[]
  userId: string
}

export default function ExamShell({ test, sections, questions, userId }: Props) {
  const router = useRouter()
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? '')
  const [activeQuestionId, setActiveQuestionId] = useState<string>('')
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [statuses, setStatuses] = useState<Record<string, QuestionStatus>>({})
  const [secondsLeft, setSecondsLeft] = useState(test.duration_mins * 60)
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [warnFired, setWarnFired] = useState(false)
  const submitRef = useRef(false)

  const sectionQuestions = useCallback(
    (sectionId: string) => questions.filter((q) => q.section_id === sectionId),
    [questions]
  )

  // Set initial active question
  useEffect(() => {
    const first = sectionQuestions(activeSectionId)[0]
    if (first && !activeQuestionId) {
      setActiveQuestionId(first.id)
      setStatuses((prev) => ({
        ...prev,
        [first.id]: prev[first.id] ?? 'not_answered',
      }))
    }
  }, [activeSectionId, sectionQuestions, activeQuestionId])

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval)
          if (!submitRef.current) handleAutoSubmit()
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 5-minute warning
  useEffect(() => {
    if (secondsLeft === 300 && !warnFired) {
      setWarnFired(true)
      alert('⏰ 5 minutes remaining! Submit soon.')
    }
  }, [secondsLeft, warnFired])

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0')
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  const activeQuestion = questions.find((q) => q.id === activeQuestionId)
  const selectedOptions = answers[activeQuestionId] ?? []

  function openQuestion(qId: string) {
    setActiveQuestionId(qId)
    setStatuses((prev) => ({
      ...prev,
      [qId]: prev[qId] === 'not_visited' || !prev[qId] ? 'not_answered' : prev[qId],
    }))
  }

  function switchSection(sectionId: string) {
    setActiveSectionId(sectionId)
    const first = sectionQuestions(sectionId)[0]
    if (first) openQuestion(first.id)
  }

  function toggleOption(optionIdx: number) {
    if (!activeQuestion) return
    setAnswers((prev) => {
      const current = prev[activeQuestionId] ?? []
      let next: number[]
      if (activeQuestion.type === 'SCQ') {
        next = current.includes(optionIdx) ? [] : [optionIdx]
      } else {
        next = current.includes(optionIdx)
          ? current.filter((i) => i !== optionIdx)
          : [...current, optionIdx]
      }
      return { ...prev, [activeQuestionId]: next }
    })
  }

  function saveAndNext() {
    const current = answers[activeQuestionId] ?? []
    setStatuses((prev) => ({
      ...prev,
      [activeQuestionId]: current.length > 0 ? 'answered' : 'not_answered',
    }))
    goNext()
  }

  function markForReview() {
    setStatuses((prev) => ({ ...prev, [activeQuestionId]: 'review' }))
    goNext()
  }

  function clearAnswer() {
    setAnswers((prev) => ({ ...prev, [activeQuestionId]: [] }))
    setStatuses((prev) => ({ ...prev, [activeQuestionId]: 'not_answered' }))
  }

  function goNext() {
    const qs = sectionQuestions(activeSectionId)
    const idx = qs.findIndex((q) => q.id === activeQuestionId)
    if (idx < qs.length - 1) {
      openQuestion(qs[idx + 1].id)
    } else {
      const sectionIdx = sections.findIndex((s) => s.id === activeSectionId)
      if (sectionIdx < sections.length - 1) {
        switchSection(sections[sectionIdx + 1].id)
      }
    }
  }

  const isAtVeryEnd = (() => {
    const qs = sectionQuestions(activeSectionId)
    const idx = qs.findIndex((q) => q.id === activeQuestionId)
    const sectionIdx = sections.findIndex((s) => s.id === activeSectionId)
    return sectionIdx === sections.length - 1 && idx === qs.length - 1
  })()

  function goPrev() {
    const qs = sectionQuestions(activeSectionId)
    const idx = qs.findIndex((q) => q.id === activeQuestionId)
    if (idx > 0) openQuestion(qs[idx - 1].id)
  }

  async function doSubmit() {
    if (submitRef.current) return
    submitRef.current = true
    setSubmitting(true)
    setShowConfirm(false)

    try {
      const res = await fetch('/api/test/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: test.id, userId, answers }),
      })
      if (!res.ok) throw new Error('Submit failed')
      router.push(`/test/${test.id}/results`)
    } catch {
      submitRef.current = false
      setSubmitting(false)
      alert('Failed to submit. Please try again.')
    }
  }

  function handleAutoSubmit() {
    doSubmit()
  }

  const unansweredCount = questions.filter(
    (q) => (answers[q.id] ?? []).length === 0
  ).length

  const statusColor: Record<QuestionStatus, string> = {
    not_visited: 'bg-[#F8F8F9] border border-[#E0E0E0] text-[#888]',
    not_answered: 'bg-[#FF4444] text-white',
    answered: 'bg-[#00AD33] text-white',
    review: 'bg-[#7B2FBE] text-white',
  }

  return (
    <div className="flex flex-col h-screen bg-[#F8F8F9] overflow-hidden">
      {/* Top bar */}
      <div className="bg-[#2F1238] px-5 py-2.5 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Shiksha" width={24} height={24} />
          <span className="text-white font-bold text-sm">{test.name}</span>
        </div>
        <span
          className={`font-mono text-lg font-bold px-3 py-1 rounded border ${
            secondsLeft <= 300
              ? 'text-red-400 border-red-400/40 bg-red-400/10'
              : 'text-white border-white/20 bg-white/10'
          }`}
        >
          {formatTime(secondsLeft)}
        </span>
        <span className="text-white/60 text-xs hidden sm:block">
          {/* placeholder for user name */}
        </span>
      </div>

      {/* Section tabs */}
      <div className="bg-white border-b border-[#E0E0E0] flex px-4 flex-shrink-0">
        {sections.map((sec) => (
          <button
            key={sec.id}
            onClick={() => switchSection(sec.id)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              sec.id === activeSectionId
                ? 'text-[#2F1238] border-[#00AD33]'
                : 'text-[#888] border-transparent hover:text-[#2F1238]'
            }`}
          >
            {sec.name}
          </button>
        ))}
      </div>

      {/* Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Question panel */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeQuestion ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold bg-[#2F1238]/10 text-[#2F1238] px-2.5 py-1 rounded">
                  Question {activeQuestion.display_order} /{' '}
                  {sectionQuestions(activeSectionId).length}
                </span>
                <span className="text-xs text-[#888] border border-[#E0E0E0] bg-white px-2.5 py-1 rounded">
                  {activeQuestion.type === 'SCQ' ? 'Single Correct' : 'Multiple Correct'}
                </span>
              </div>

              {/* Question text */}
              <div className="bg-white border border-[#E0E0E0] rounded-sm p-4 mb-4 text-sm text-[#1a1a1a] leading-relaxed">
                <MathText text={activeQuestion.text} />
              </div>

              {/* Options */}
              <div className="space-y-2 mb-5">
                {activeQuestion.options.map((opt, idx) => {
                  const isSelected = selectedOptions.includes(idx)
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleOption(idx)}
                      className={`w-full flex items-center gap-3 text-left border rounded-sm px-4 py-3 text-sm transition-colors ${
                        isSelected
                          ? 'border-[#00AD33] bg-[#00AD33]/5'
                          : 'border-[#E0E0E0] bg-white hover:border-[#CACACA]'
                      }`}
                    >
                      {/* Radio/checkbox indicator */}
                      <span
                        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                          isSelected ? 'border-[#00AD33] bg-[#00AD33]' : 'border-[#CACACA]'
                        }`}
                      >
                        {isSelected && (
                          <span className="w-1.5 h-1.5 rounded-full bg-white block" />
                        )}
                      </span>
                      <span className={`font-semibold mr-1 ${isSelected ? 'text-[#00AD33]' : 'text-[#2F1238]'}`}>
                        {String.fromCharCode(65 + idx)}.
                      </span>
                      <MathText text={opt} />
                    </button>
                  )
                })}
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={saveAndNext}
                  className="bg-[#00AD33] text-white text-sm font-semibold rounded-full px-5 py-2 hover:bg-[#009929] transition-colors"
                >
                  Save &amp; Next →
                </button>
                <button
                  onClick={markForReview}
                  className="bg-[#2F1238] text-white text-sm font-semibold rounded-full px-5 py-2 hover:bg-[#3d1a4a] transition-colors"
                >
                  Mark for Review
                </button>
                <button
                  onClick={clearAnswer}
                  className="bg-white text-[#888] text-sm border border-[#CACACA] rounded-full px-5 py-2 hover:border-[#2F1238] transition-colors"
                >
                  Clear
                </button>
                <div className="flex-1" />
                <button
                  onClick={goPrev}
                  className="bg-white text-[#2F1238] text-sm font-semibold border border-[#2F1238] rounded-full px-5 py-2 hover:bg-[#2F1238]/5 transition-colors"
                >
                  ← Prev
                </button>
                <button
                  onClick={goNext}
                  disabled={isAtVeryEnd}
                  className="bg-white text-[#2F1238] text-sm font-semibold border border-[#2F1238] rounded-full px-5 py-2 hover:bg-[#2F1238]/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next →
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-[#888]">No questions in this section.</p>
          )}
        </div>

        {/* Right: navigator */}
        <div className="w-60 border-l border-[#E0E0E0] bg-white flex flex-col p-4 overflow-y-auto flex-shrink-0">
          {/* Scoring */}
          <div className="bg-[#00AD33]/6 border border-[#00AD33]/20 rounded p-2.5 text-xs text-[#555] mb-4">
            ✅ Correct: <strong>+4</strong> &nbsp;·&nbsp; ❌ Wrong: <strong>−1</strong> &nbsp;·&nbsp; ⬜ Skip: <strong>0</strong>
          </div>

          {/* Legend */}
          <div className="space-y-1.5 mb-4">
            {[
              { color: 'bg-[#00AD33]', label: 'Answered' },
              { color: 'bg-[#FF4444]', label: 'Not answered' },
              { color: 'bg-[#7B2FBE]', label: 'Marked for review' },
              { color: 'bg-[#F8F8F9] border border-[#E0E0E0]', label: 'Not visited' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-2 text-xs text-[#666]">
                <span className={`w-3.5 h-3.5 rounded flex-shrink-0 ${color}`} />
                {label}
              </div>
            ))}
          </div>

          {/* Question grid for active section */}
          <p className="text-xs font-bold uppercase tracking-widest text-[#888] mb-2">
            {sections.find((s) => s.id === activeSectionId)?.name}
          </p>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {sectionQuestions(activeSectionId).map((q) => {
              const status = statuses[q.id] ?? 'not_visited'
              const isCurrent = q.id === activeQuestionId
              return (
                <button
                  key={q.id}
                  onClick={() => openQuestion(q.id)}
                  className={`w-8 h-8 rounded text-xs font-semibold transition-all ${statusColor[status]} ${
                    isCurrent ? 'ring-2 ring-offset-1 ring-[#00AD33]' : ''
                  }`}
                >
                  {q.display_order}
                </button>
              )
            })}
          </div>

          {/* Submit */}
          <div className="mt-auto">
            <button
              onClick={() => setShowConfirm(true)}
              disabled={submitting}
              className="w-full bg-[#2F1238] text-white text-sm font-bold rounded-full py-2.5 hover:bg-[#3d1a4a] transition-colors disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit Test'}
            </button>
          </div>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-sm border border-[#E0E0E0] shadow-lg max-w-sm w-full p-6">
            <h3 className="text-base font-bold text-[#2F1238] mb-2">Submit Test?</h3>
            <p className="text-sm text-[#666] mb-4">
              {unansweredCount > 0
                ? `You have ${unansweredCount} unanswered question${unansweredCount > 1 ? 's' : ''}. Once submitted, you cannot change your answers.`
                : 'All questions answered. Once submitted, you cannot change your answers.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={doSubmit}
                className="flex-1 bg-[#00AD33] text-white font-semibold rounded-full py-2 text-sm hover:bg-[#009929] transition-colors"
              >
                Yes, Submit
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 bg-white text-[#2F1238] font-semibold border border-[#2F1238] rounded-full py-2 text-sm hover:bg-[#2F1238]/5 transition-colors"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
