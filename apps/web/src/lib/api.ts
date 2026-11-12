import { getSession, setSession } from './session.ts'
import type { Session } from './session.ts'

// Dev: the API runs on another port of the same machine (cookies still work: same site).
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000'

export class ApiError extends Error {
  status: number
  code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** A path the API returned (like /clinic/logo/x.png) -> a full address the browser can load. */
export const assetUrl = (path: string): string => (path.startsWith('/') ? BASE + path : path)

const NETWORK_ERROR = 'تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول مرة أخرى'
const TOO_MANY = 'محاولات كثيرة، انتظر قليلاً ثم حاول مرة أخرى'
const GENERIC = 'حدث خطأ غير متوقع، حاول مرة أخرى'

async function toError(res: Response): Promise<ApiError> {
  if (res.status === 429) return new ApiError(429, TOO_MANY)
  let message = GENERIC
  let code: string | undefined
  try {
    const body = (await res.json()) as { message?: unknown; code?: unknown }
    if (typeof body.message === 'string') message = body.message
    if (typeof body.code === 'string') code = body.code
  } catch {
    // not JSON: keep the generic message
  }
  return new ApiError(res.status, message, code)
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  file?: Blob // sent as the raw body (image upload), with its own content type
  blob?: boolean // the answer is a file (an image), not JSON
  auth?: boolean // send the access token (default true)
  retried?: boolean
}

export async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const auth = opts.auth ?? true
  const headers: Record<string, string> = {}
  if (opts.file) headers['Content-Type'] = opts.file.type
  else if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getSession()?.accessToken
  if (auth && token) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include', // the refresh cookie
      body: opts.file ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    })
  } catch {
    throw new ApiError(0, NETWORK_ERROR)
  }

  // The 15-minute access token expired: get a new one once and repeat the request.
  if (res.status === 401 && auth && !opts.retried) {
    if (await refreshSession()) return request<T>(path, { ...opts, retried: true })
  }
  if (!res.ok) throw await toError(res)
  if (opts.blob) return (await res.blob()) as T
  return (res.status === 204 ? undefined : await res.json()) as T
}

// ------------------------------------------------------------------ session calls

interface SessionBody {
  accessToken: string
  mustChangePassword: boolean
  termsRequired?: boolean
  subscriptionWarning: Session['subscriptionWarning']
  user: Session['user']
  clinic: Session['clinic']
}

const toSession = (b: SessionBody): Session => ({
  accessToken: b.accessToken,
  mustChangePassword: b.mustChangePassword,
  termsRequired: b.termsRequired ?? false,
  subscriptionWarning: b.subscriptionWarning ?? null,
  user: b.user,
  clinic: b.clinic ?? null,
})

let refreshing: Promise<Session | null> | null = null

/**
 * Gets a new access token from the refresh cookie. Refresh tokens rotate, so two refreshes at the
 * same moment would look like a stolen token and log everyone out: all callers share ONE request.
 */
export function refreshSession(): Promise<Session | null> {
  refreshing ??= doRefresh().finally(() => {
    refreshing = null
  })
  return refreshing
}

async function doRefresh(): Promise<Session | null> {
  try {
    const res = await fetch(BASE + '/auth/refresh', { method: 'POST', credentials: 'include' })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) setSession(null)
      return null
    }
    const session = toSession((await res.json()) as SessionBody)
    setSession(session)
    return session
  } catch {
    return null // offline: keep whatever we have
  }
}

export type LoginResult = { kind: 'session' } | { kind: 'challenge'; challengeToken: string }

export async function login(username: string, password: string): Promise<LoginResult> {
  const body = await request<SessionBody | { twoFactorRequired: true; challengeToken: string }>('/auth/login', {
    method: 'POST',
    body: { username: username.trim(), password },
    auth: false,
  })
  if ('twoFactorRequired' in body) return { kind: 'challenge', challengeToken: body.challengeToken }
  setSession(toSession(body))
  return { kind: 'session' }
}

export async function verifyTwoFactor(challengeToken: string, code: string): Promise<void> {
  const body = await request<SessionBody>('/auth/2fa/verify', {
    method: 'POST',
    body: { challengeToken, code: code.trim() },
    auth: false,
  })
  setSession(toSession(body))
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const body = await request<SessionBody>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  })
  setSession(toSession(body))
}

export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST', auth: false })
  } catch {
    // even if the server is unreachable we still forget the session here
  }
  setSession(null)
}
