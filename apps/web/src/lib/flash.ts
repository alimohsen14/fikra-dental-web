export type FlashTone = 'success' | 'warning'
export interface Flash {
  message: string
  tone: FlashTone
}

/** What a save leaves for the next page: it shows once as a banner there ("done, and here is the list"). */
export const flashState = (message: string, tone: FlashTone = 'success') => ({ flash: { message, tone } })

/** Reads the banner out of a router location state; anything else is ignored. */
export function flashOf(state: unknown): Flash | null {
  const f = (state as { flash?: Partial<Flash> } | null)?.flash
  if (!f || typeof f.message !== 'string' || f.message === '') return null
  return { message: f.message, tone: f.tone === 'warning' ? 'warning' : 'success' }
}
