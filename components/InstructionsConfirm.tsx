'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function InstructionsConfirm({ testId }: { testId: string }) {
  const [confirmed, setConfirmed] = useState(false)
  const router = useRouter()

  return (
    <div className="mt-5 space-y-4">
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-[#2F1238] w-4 h-4 flex-shrink-0"
        />
        <span className="text-xs text-[#555]">
          I have read and understood the instructions. I am ready to begin the test.
        </span>
      </label>

      <button
        disabled={!confirmed}
        onClick={() => router.push(`/test/${testId}`)}
        className="w-full bg-[#00AD33] text-white font-semibold rounded-full py-2.5 text-sm hover:bg-[#009929] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Start Test →
      </button>
    </div>
  )
}
