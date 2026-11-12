import { request } from './api.ts'
import { getSession, setSession } from './session.ts'

export interface TermsSection {
  title: string
  paragraphs: string[]
}

export interface TermsDocument {
  version: string
  title: string
  intro: string
  sections: TermsSection[]
  closing: string
}

/** The terms text lives on the server (one source, with its version). Public: no login needed. */
export const getTerms = () => request<TermsDocument>('/legal/terms', { auth: false })

/** The owner accepted the current version: the app stops asking for it. */
export async function acceptTerms(version: string): Promise<void> {
  await request<void>('/auth/accept-terms', { method: 'POST', body: { version } })
  const s = getSession()
  if (s) setSession({ ...s, termsRequired: false })
}
