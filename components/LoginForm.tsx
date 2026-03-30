'use client'

import { useActionState } from 'react'
import { sendOtp } from '@/app/actions/auth'

type FormState = { error?: string } | undefined

export default function LoginForm() {
  const [state, action, pending] = useActionState(sendOtp, undefined)

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Your Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="e.g. Rohan Chadha"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Phone Number
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          required
          placeholder="+91 98765 43210"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-xs font-semibold text-[#2F1238] mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="your@email.com"
          className="w-full bg-white text-[#8A8A8A] border border-[#CACACA] rounded px-3 py-2 text-sm focus:outline-none focus:border-[#2F1238]"
        />
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-[#00AD33] text-white font-semibold rounded-full py-2.5 text-sm hover:bg-[#009929] transition-colors disabled:opacity-60 disabled:cursor-not-allowed mt-2"
      >
        {pending ? 'Sending code…' : 'Send Verification Code →'}
      </button>
    </form>
  )
}
