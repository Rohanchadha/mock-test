import { getPendingLogin } from '@/lib/session'
import { redirect } from 'next/navigation'
import OtpForm from '@/components/OtpForm'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2)
  return `${visible}***@${domain}`
}

export default async function VerifyPage() {
  const pending = await getPendingLogin()
  if (!pending) redirect('/') // no pending login — restart

  return (
    <main className="min-h-screen bg-[#F8F8F9] flex flex-col items-center justify-center p-4">
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <img src="/logo.svg" alt="Shiksha" width={40} height={40} />
          <h1 className="text-2xl font-bold text-[#2F1238]">Shiksha</h1>
        </div>
        <p className="text-sm text-[#8A8A8A] mt-1">Check your email</p>
      </div>

      <div className="bg-white border border-[#E0E0E0] rounded-sm shadow-sm w-full max-w-sm p-7">
        <h2 className="text-base font-bold text-[#2F1238] mb-5">Enter Verification Code</h2>
        <OtpForm maskedEmail={maskEmail(pending.email)} />
      </div>

      <p className="text-xs text-[#CACACA] mt-4">Code expires in 10 minutes</p>
    </main>
  )
}
