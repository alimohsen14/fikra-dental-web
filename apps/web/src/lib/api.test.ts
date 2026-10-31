import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, login, refreshSession, request } from './api.ts'
import { getSession, setSession } from './session.ts'

const sessionBody = (token: string) => ({
  accessToken: token,
  mustChangePassword: false,
  subscriptionWarning: null,
  user: { id: 'u1', fullName: 'Test', role: 'OWNER', clinicId: 'c1' },
  clinic: { id: 'c1', name: 'عيادة', themeColor: '#0b5d57', logoUrl: null },
})

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('api', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    setSession(null)
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('login without 2FA saves the session', async () => {
    fetchMock.mockResolvedValueOnce(json(200, sessionBody('t1')))
    expect(await login(' owner ', 'pw')).toEqual({ kind: 'session' })
    expect(getSession()?.accessToken).toBe('t1')
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ username: 'owner', password: 'pw' })
  })

  it('login with 2FA returns the challenge and saves nothing', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { twoFactorRequired: true, challengeToken: 'ch' }))
    expect(await login('admin', 'pw')).toEqual({ kind: 'challenge', challengeToken: 'ch' })
    expect(getSession()).toBeNull()
  })

  it('shows the server message on errors and a friendly one on 429 / no network', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { message: 'اسم المستخدم أو كلمة المرور غير صحيحة' }))
    await expect(login('a', 'b')).rejects.toMatchObject({ status: 401, message: 'اسم المستخدم أو كلمة المرور غير صحيحة' })
    fetchMock.mockResolvedValueOnce(json(429, {}))
    await expect(login('a', 'b')).rejects.toMatchObject({ status: 429 })
    fetchMock.mockRejectedValueOnce(new TypeError('fail'))
    await expect(login('a', 'b')).rejects.toBeInstanceOf(ApiError)
  })

  it('many refresh calls at once make ONE request (rotation would log everyone out otherwise)', async () => {
    fetchMock.mockResolvedValue(json(200, sessionBody('t2')))
    await Promise.all([refreshSession(), refreshSession(), refreshSession()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getSession()?.accessToken).toBe('t2')
  })

  it('a failed refresh (401) clears the session', async () => {
    setSession({ ...sessionBody('old'), user: sessionBody('x').user } as never)
    fetchMock.mockResolvedValueOnce(json(401, {}))
    expect(await refreshSession()).toBeNull()
    expect(getSession()).toBeNull()
  })

  it('retries once with a new token after a 401', async () => {
    setSession(sessionBody('old') as never)
    fetchMock
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, sessionBody('new')))
      .mockResolvedValueOnce(json(200, { ok: true }))
    expect(await request('/thing')).toEqual({ ok: true })
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer new')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
