import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

// Routes accessible without a session
const PUBLIC_PATHS = new Set(['/', '/verify', '/favicon.ico'])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('session')?.value

  if (!token) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  try {
    const secret = process.env.SESSION_SECRET
    if (!secret) throw new Error('SESSION_SECRET not configured')
    const key = new TextEncoder().encode(secret)
    await jwtVerify(token, key, { algorithms: ['HS256'] })
    return NextResponse.next()
  } catch {
    // Invalid/expired token — clear the cookie and redirect to login
    const response = NextResponse.redirect(new URL('/', request.url))
    response.cookies.delete('session')
    return response
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
