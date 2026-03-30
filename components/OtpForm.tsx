'use client'

import { useActionState } from 'react'
import { verifyOtp } from '@/app/actions/auth'

type FormState = { error?: string } | undefined

interface Props {
  maskedEmail: string
}

export default function OtpForm({ maskedEmail }: Props) {
  const [state, action, pending] = useActionState(verifyOtp, undefined)

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-[#8A8A8A]">
        We sent a 6-digit code to{' '}
        <span className="font-semibold text-[#2F1238]">{maskedEmail}</span>.
        Enter it below.
      </p>

      <div>
        <label htmlFor="otp" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Verification Code
        </label>
        <input
          id="otp"
          name="otp"
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          placeholder="123456"
          className="w-full bg-white text-[#2F1238] border border-[#CACACA] rounded px-3 py-2 text-sm text-center tracking-[0.5em] font-mono focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#00AD33] text-white font-semibold rounded-full py-2.5 text-sm hover:bg-[#009929] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Verifying…' : 'Verify & Continue →'}
      </button>

      <p className="text-xs text-center text-[#CACACA]">
        Wrong email?{' '}
        <a href="/" className="text-[#2F1238] underline">
          Go back
        </a>
      </p>
    </form>
  )
}
