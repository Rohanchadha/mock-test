'use client'

import { logout } from '@/app/actions/auth'

export default function LogoutButton() {
  return (
    <button
      onClick={() => logout()}
      className="text-white/40 text-xs hover:text-white/70 transition-colors"
    >
      Logout
    </button>
  )
}
